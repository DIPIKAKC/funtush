/**
 * ── Reading an image's width and height from its bytes ───────────────────────
 *
 * Day 1 of the white-label week needs to reject a logo that is not exactly
 * 725 × 145 and a favicon that is not exactly 96 × 96 — **before** the file is
 * pushed to S3, because a rejected upload that still cost a PUT is a rejected
 * upload that still cost money and still leaves a stray object in the bucket.
 *
 * **Why not `sharp` / `image-size` / `probe-image-size`?**
 *
 * `sharp` is a native module: it pulls libvips, adds ~30 MB to the image, and
 * needs a compiler on every machine that runs `pnpm install`. That is a real
 * price to pay, and the thing we actually want from it is four numbers out of a
 * file header. `image-size` is pure JS and much lighter, but it is still a new
 * dependency in a repo that already ships its own `stableStringify` and
 * `httpError` rather than pulling packages for small jobs.
 *
 * So: ~120 lines of header parsing, no dependency, fully unit-tested. If a later
 * day needs real image *processing* (resizing, WebP conversion for the
 * §15 image pipeline) that is the moment to add `sharp` — and this file can be
 * deleted then.
 *
 * **What this is not:** it is not validation that the file is safe. It reads
 * declared dimensions from a header; a malicious file can declare anything. It
 * is paired with the MIME whitelist in `@funtush/storage`'s multer config and a
 * byte-size cap, and the combination is what makes an upload acceptable.
 *
 * Supported: PNG, JPEG, GIF, WebP (all three WebP variants). These are exactly
 * the formats the storage layer accepts, minus PDF.
 */

/** The answer, plus which decoder produced it (useful in error messages/tests). */
export interface ImageDimensions {
  width: number;
  height: number;
  format: "png" | "jpeg" | "gif" | "webp";
}

/* ── PNG ─────────────────────────────────────────────────────────────────── */

/**
 * The 8 magic bytes every PNG starts with. `\x89PNG\r\n\x1a\n` — chosen by the
 * PNG designers so that a file mangled by a text-mode FTP transfer fails the
 * check instead of decoding to garbage.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPng(buffer: Buffer): ImageDimensions | null {
  // 8 signature bytes + 8 chunk header + 8 dimension bytes = 24 minimum.
  if (buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

  // Bytes 12–15 are the chunk type. The first chunk of a valid PNG is always
  // IHDR ("image header"); anything else means the file is malformed or is a
  // different format wearing a PNG signature.
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;

  // IHDR's payload starts at byte 16: width then height, each a 32-bit
  // big-endian unsigned integer. PNG is big-endian throughout — unlike GIF and
  // WebP below, which are little-endian. Getting this backwards turns 725 into
  // 3,489,660,928, which is why the tests assert real byte sequences.
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    format: "png",
  };
}

/* ── GIF ─────────────────────────────────────────────────────────────────── */

function readGif(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 10) return null;

  const header = buffer.toString("ascii", 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return null;

  // The "logical screen descriptor" follows the 6-byte header: width then
  // height as 16-bit *little*-endian integers.
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
    format: "gif",
  };
}

/* ── JPEG ────────────────────────────────────────────────────────────────── */

/**
 * JPEG does not put the size at a fixed offset. A JPEG is a chain of "segments",
 * each introduced by `0xFF` followed by a marker byte; the dimensions live in
 * whichever "Start Of Frame" (SOF) segment the encoder used, and where that sits
 * depends on how much EXIF and colour-profile data the camera bolted on first.
 * So we walk the chain.
 *
 * `0xC0`–`0xCF` are the SOF markers, with three exceptions that share the range
 * but are not frame headers: `0xC4` (Huffman tables), `0xC8` (reserved), `0xCC`
 * (arithmetic coding conditioning). Miss those exclusions and you read a
 * Huffman table as a width.
 */
function isStartOfFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readJpeg(buffer: Buffer): ImageDimensions | null {
  // SOI — "Start Of Image".
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;

  // `- 9` because the smallest thing we ever read at `offset` is a 9-byte SOF
  // header (marker 2 + length 2 + precision 1 + height 2 + width 2). Stopping
  // short of the end is what keeps a truncated file from throwing a
  // RangeError out of `readUInt16BE`.
  while (offset < buffer.length - 9) {
    // Segments are byte-aligned with 0xFF padding. Skip any run of fill bytes.
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1] as number;

    // 0xFF followed by 0xFF is padding, not a marker.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }

    if (isStartOfFrameMarker(marker)) {
      // Layout from `offset`: FF, marker, length(2), precision(1), height(2),
      // width(2). Note height comes *before* width here — the opposite order to
      // every other format in this file. That is genuinely what the spec says.
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        format: "jpeg",
      };
    }

    // Not a frame header — skip the whole segment. Its length (which includes
    // the two length bytes themselves, but not the two marker bytes) sits
    // immediately after the marker.
    const segmentLength = buffer.readUInt16BE(offset + 2);

    // A length below 2 is impossible and would make this loop spin forever.
    if (segmentLength < 2) return null;

    offset += 2 + segmentLength;
  }

  return null;
}

/* ── WebP ────────────────────────────────────────────────────────────────── */

/**
 * WebP is a RIFF container: `RIFF` + file size + `WEBP`, then a chunk whose
 * four-character code tells you which of three encodings is inside. All three
 * store dimensions differently, so all three need their own reader.
 */
function readWebp(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 30) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WEBP") return null;

  const chunkType = buffer.toString("ascii", 12, 16);

  // ── Lossy ("VP8 ", with a trailing space). The VP8 keyframe header has a
  // 3-byte start code at offset 23; width and height are the two 16-bit
  // little-endian values after it. Only the low 14 bits are the dimension —
  // the top 2 bits are a scaling hint — hence the `& 0x3fff` mask.
  if (chunkType === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      format: "webp",
    };
  }

  // ── Lossless ("VP8L"). Dimensions are bit-packed, not byte-aligned: after a
  // 1-byte signature at offset 20, the next 28 bits are (width-1) in 14 bits
  // then (height-1) in 14 bits. We read the 4 bytes as one little-endian
  // 32-bit number and shift the fields out.
  if (chunkType === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      format: "webp",
    };
  }

  // ── Extended ("VP8X" — the variant used when the file has alpha, animation,
  // or metadata). Canvas size is stored as two 24-bit little-endian values,
  // each minus one. Node has no `readUInt24LE`, so `readUIntLE(offset, 3)`
  // does the job.
  if (chunkType === "VP8X") {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
      format: "webp",
    };
  }

  return null;
}

/* ── Entry point ─────────────────────────────────────────────────────────── */

/**
 * Read an image's dimensions from its bytes.
 *
 * Returns `null` — never throws — when the buffer is not a supported image or is
 * too short to read. Callers turn that into a 400 with a message the agency can
 * act on; a thrown parser error would surface as a 500 and read like our bug
 * rather than their bad file.
 */
export function readImageDimensions(buffer: Buffer): ImageDimensions | null {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  // Order matters only for speed, not correctness — the signatures are mutually
  // exclusive. PNG first because it is what almost every logo arrives as.
  return readPng(buffer) ?? readWebp(buffer) ?? readJpeg(buffer) ?? readGif(buffer);
}

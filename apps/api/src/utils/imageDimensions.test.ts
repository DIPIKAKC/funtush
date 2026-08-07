import { describe, it, expect } from "vitest";

/**
 * Unit tests for the header-only image dimension reader (White-label week · Day 1).
 *
 * No fixture files on disk: each test **builds** a minimal but byte-accurate
 * header for the format it covers. That is the whole point — a fixture would
 * prove "this one PNG parses", whereas a constructed header proves the parser
 * reads the fields the spec says are there, at the offsets the spec says they
 * are at, in the endianness the spec says they use.
 *
 * The two failure modes these guard against are both silent-and-wrong rather
 * than loud: reading big-endian bytes as little-endian (725 becomes 53,762) and
 * reading JPEG's width before its height (725 × 145 becomes 145 × 725). Neither
 * throws. Both would let a wrongly-sized logo through, or reject a correct one.
 */

import { readImageDimensions } from "./imageDimensions";

/* ── Builders ───────────────────────────────────────────────────────────── */

/** A PNG that is nothing but a valid signature + IHDR chunk. */
function makePng(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  buffer.writeUInt32BE(13, 8); // IHDR payload length, always 13
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16); // big-endian
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function makeGif(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(13);
  buffer.write("GIF89a", 0, "ascii");
  buffer.writeUInt16LE(width, 6); // little-endian
  buffer.writeUInt16LE(height, 8);
  return buffer;
}

/**
 * A JPEG with one junk segment (a fake APP0/JFIF block) placed *before* the SOF0
 * frame header — because a real photo always has EXIF or JFIF data in front, and
 * a parser that assumes the frame header sits at a fixed offset works on
 * hand-made files and fails on every camera in the world.
 */
function makeJpeg(width: number, height: number): Buffer {
  const junkPayloadLength = 16;
  const junk = Buffer.alloc(2 + junkPayloadLength);
  junk.writeUInt8(0xff, 0);
  junk.writeUInt8(0xe0, 1); // APP0
  junk.writeUInt16BE(junkPayloadLength, 2); // length includes these 2 bytes

  const sof = Buffer.alloc(11);
  sof.writeUInt8(0xff, 0);
  sof.writeUInt8(0xc0, 1); // SOF0 — baseline
  sof.writeUInt16BE(8, 2); // segment length
  sof.writeUInt8(8, 4); // sample precision
  sof.writeUInt16BE(height, 5); // height FIRST — this is the trap
  sof.writeUInt16BE(width, 7);

  // Trailing bytes so the `offset < length - 9` guard does not stop early.
  return Buffer.concat([Buffer.from([0xff, 0xd8]), junk, sof, Buffer.alloc(16)]);
}

/** Lossy WebP: `RIFF … WEBP` + a `VP8 ` chunk. */
function makeLossyWebp(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(40);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(32, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8 ", 12, "ascii");
  buffer.writeUInt16LE(width, 26);
  buffer.writeUInt16LE(height, 28);
  return buffer;
}

/** Lossless WebP: dimensions bit-packed as 14 + 14 bits, each minus one. */
function makeLosslessWebp(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(40);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(32, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8L", 12, "ascii");
  buffer.writeUInt8(0x2f, 20); // VP8L signature byte
  const bits = (width - 1) | ((height - 1) << 14);
  buffer.writeUInt32LE(bits >>> 0, 21);
  return buffer;
}

/** Extended WebP (alpha/animation): 24-bit canvas dimensions, each minus one. */
function makeExtendedWebp(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(40);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(32, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe("readImageDimensions", () => {
  it("reads a PNG at the exact logo size", () => {
    expect(readImageDimensions(makePng(725, 145))).toEqual({
      width: 725,
      height: 145,
      format: "png",
    });
  });

  it("reads a PNG at the exact favicon size", () => {
    expect(readImageDimensions(makePng(96, 96))).toEqual({
      width: 96,
      height: 96,
      format: "png",
    });
  });

  it("reads PNG dimensions as big-endian, not little-endian", () => {
    // 725 little-endian would come back as 53,762. Asserting a non-square image
    // is what makes this test able to fail; a 96 × 96 icon cannot detect a
    // width/height swap.
    const dimensions = readImageDimensions(makePng(725, 145));
    expect(dimensions?.width).toBe(725);
    expect(dimensions?.width).not.toBe(53762);
  });

  it("reads a GIF as little-endian", () => {
    expect(readImageDimensions(makeGif(725, 145))).toEqual({
      width: 725,
      height: 145,
      format: "gif",
    });
  });

  it("reads a JPEG, skipping the segment in front of the frame header", () => {
    expect(readImageDimensions(makeJpeg(725, 145))).toEqual({
      width: 725,
      height: 145,
      format: "jpeg",
    });
  });

  it("does not swap JPEG width and height", () => {
    // The one assertion that catches "height comes first in SOF" being missed.
    const dimensions = readImageDimensions(makeJpeg(725, 145));
    expect(dimensions?.width).toBe(725);
    expect(dimensions?.height).toBe(145);
  });

  it("reads all three WebP variants", () => {
    expect(readImageDimensions(makeLossyWebp(725, 145))).toEqual({
      width: 725,
      height: 145,
      format: "webp",
    });
    expect(readImageDimensions(makeLosslessWebp(725, 145))).toEqual({
      width: 725,
      height: 145,
      format: "webp",
    });
    expect(readImageDimensions(makeExtendedWebp(725, 145))).toEqual({
      width: 725,
      height: 145,
      format: "webp",
    });
  });

  it("handles the WebP off-by-one encodings at size 1", () => {
    // VP8L and VP8X store (dimension - 1). A parser that forgets the `+ 1`
    // returns 0 here, which is the smallest input that can prove it.
    expect(readImageDimensions(makeLosslessWebp(1, 1))?.width).toBe(1);
    expect(readImageDimensions(makeExtendedWebp(1, 1))?.height).toBe(1);
  });

  /* ── Rejections. All return null; none throw. ─────────────────────────── */

  it("returns null for an empty buffer", () => {
    expect(readImageDimensions(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for a text file renamed to .png", () => {
    expect(readImageDimensions(Buffer.from("this is not an image at all"))).toBeNull();
  });

  it("returns null for a truncated PNG rather than throwing", () => {
    const truncated = makePng(725, 145).subarray(0, 18);
    expect(() => readImageDimensions(truncated)).not.toThrow();
    expect(readImageDimensions(truncated)).toBeNull();
  });

  it("returns null for a PDF (the one storage-allowed type that is not an image)", () => {
    expect(readImageDimensions(Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n"))).toBeNull();
  });

  it("returns null for a JPEG whose segment length is impossible, instead of looping forever", () => {
    const buffer = Buffer.alloc(64);
    buffer.writeUInt8(0xff, 0);
    buffer.writeUInt8(0xd8, 1);
    buffer.writeUInt8(0xff, 2);
    buffer.writeUInt8(0xe0, 3);
    buffer.writeUInt16BE(0, 4); // length 0 — would advance the cursor by nothing
    expect(readImageDimensions(buffer)).toBeNull();
  });

  it("returns null for a RIFF file that is not WebP", () => {
    const wav = Buffer.alloc(40);
    wav.write("RIFF", 0, "ascii");
    wav.write("WAVE", 8, "ascii");
    expect(readImageDimensions(wav)).toBeNull();
  });
});

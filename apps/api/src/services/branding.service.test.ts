import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the brand identity service (White-label week · Day 1).
 *
 * Both `@funtush/database` and `@funtush/storage` are replaced with spies, so
 * these run with no Postgres, no S3 and no network.
 *
 * Mocking the *storage* layer as well as the database is not incidental — it is
 * what lets the suite assert the single most important sequencing rule in the
 * file: **a request that a tier or an image spec is going to reject must never
 * reach `uploadFile`.** That is a claim about ordering, and the only way to test
 * ordering is to be able to see whether the later call happened.
 */

const agencyFindUnique = vi.fn();
const brandingFindUnique = vi.fn();
const brandingUpsert = vi.fn();

vi.mock("@funtush/database", () => ({
  db: {
    agency: { findUnique: (...a: unknown[]) => agencyFindUnique(...a) },
    agencyBranding: {
      findUnique: (...a: unknown[]) => brandingFindUnique(...a),
      upsert: (...a: unknown[]) => brandingUpsert(...a),
    },
  },
}));

const uploadFileMock = vi.fn();
const deleteFileMock = vi.fn();

vi.mock("@funtush/storage", () => ({
  uploadFile: (...a: unknown[]) => uploadFileMock(...a),
  deleteFile: (...a: unknown[]) => deleteFileMock(...a),
}));

import {
  assertValidBrandImage,
  brandingCssVariables,
  brandingStyleBlock,
  formatCurrencyExample,
  getAgencyBranding,
  getBrandingOptions,
  getPublicBrandingBySlug,
  readableTextColor,
  resolveBranding,
  resolveColorForTier,
  updateAgencyBranding,
  type BrandingRow,
} from "./branding.service";
import { BRAND_PALETTE, FAVICON_SPEC, LOGO_SPEC } from "../data/brandTheme";

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const AGENCY_ID = "agency-1";
const SAVED_AT = new Date("2026-08-07T09:00:00.000Z");

/** A curated swatch and a colour deliberately *not* in the palette. */
const CURATED_HEX = BRAND_PALETTE[0]!.hex; // "#0F766E"
const CUSTOM_HEX = "#FF00AA";

function agencyOnTier(tier: string) {
  return {
    id: AGENCY_ID,
    name: "Himalayan Trails Pvt. Ltd.",
    slug: "himalayan-trails",
    status: "ACTIVE",
    tier: { name: tier },
  };
}

function brandingRow(overrides: Partial<BrandingRow> = {}): BrandingRow {
  return {
    brandName: null,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    paletteId: null,
    fontFamily: null,
    cardImageRatio: "RATIO_4_3",
    currencyCode: "NPR",
    currencySymbol: null,
    currencyDisplay: "SYMBOL",
    updatedAt: SAVED_AT,
    ...overrides,
  };
}

/** Build a real PNG header at the given size — same builder idea as the util tests. */
function pngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function fileOf(
  width: number,
  height: number,
  mimetype = "image/png",
  size?: number,
): Express.Multer.File {
  const buffer = pngBuffer(width, height);
  return {
    fieldname: "logo",
    originalname: "logo.png",
    encoding: "7bit",
    mimetype,
    size: size ?? buffer.length,
    buffer,
  } as Express.Multer.File;
}

beforeEach(() => {
  vi.clearAllMocks();
  agencyFindUnique.mockResolvedValue(agencyOnTier("MEDIUM"));
  brandingFindUnique.mockResolvedValue(null);
  brandingUpsert.mockImplementation(
    (args: { create?: Record<string, unknown>; update?: Record<string, unknown> }) =>
      Promise.resolve(brandingRow({ ...(args.create ?? {}), ...(args.update ?? {}) })),
  );
  uploadFileMock.mockResolvedValue("https://cdn.funtush.com/uploads/new-file.png");
  deleteFileMock.mockResolvedValue(undefined);
});

/* ── 1. The tier colour rule — the headline requirement of the day ───────── */

describe("resolveColorForTier", () => {
  it("lets MEDIUM and LARGE set any hex", () => {
    for (const tier of ["MEDIUM", "LARGE"]) {
      expect(resolveColorForTier(tier, { primaryColor: CUSTOM_HEX })).toEqual({
        primaryColor: CUSTOM_HEX,
        paletteId: null,
      });
    }
  });

  it("refuses an off-palette hex for SMALL, with a 403", () => {
    expect(() => resolveColorForTier("SMALL", { primaryColor: CUSTOM_HEX })).toThrowError(
      /curated colour palette/i,
    );

    try {
      resolveColorForTier("SMALL", { primaryColor: CUSTOM_HEX });
    } catch (err) {
      // 403, not 400: the request is perfectly well-formed, it is the *plan*
      // that does not permit it. A 400 would read as "you typed it wrong".
      expect((err as { status: number }).status).toBe(403);
    }
  });

  it("treats the trial (FREE) exactly like SMALL", () => {
    // Backend Guide §0.1 — the trial is the full Small feature set, no more.
    expect(() => resolveColorForTier("FREE", { primaryColor: CUSTOM_HEX })).toThrow();
    expect(resolveColorForTier("FREE", { primaryColor: CURATED_HEX })).toEqual({
      primaryColor: CURATED_HEX,
      paletteId: BRAND_PALETTE[0]!.id,
    });
  });

  it("accepts an on-palette hex from SMALL and tags it with the swatch id", () => {
    expect(resolveColorForTier("SMALL", { primaryColor: CURATED_HEX })).toEqual({
      primaryColor: CURATED_HEX,
      paletteId: BRAND_PALETTE[0]!.id,
    });
  });

  it("accepts lowercase hex — normalisation happens before comparison", () => {
    expect(
      resolveColorForTier("SMALL", { primaryColor: CURATED_HEX.toLowerCase() }),
    ).toEqual({ primaryColor: CURATED_HEX, paletteId: BRAND_PALETTE[0]!.id });
  });

  it("ignores a hex sent alongside a paletteId rather than trusting it", () => {
    // The hole this closes: a SMALL client sending {paletteId: "teal",
    // primaryColor: "#FF00AA"} to smuggle a custom colour past the tier check.
    const result = resolveColorForTier("SMALL", {
      paletteId: BRAND_PALETTE[0]!.id,
      primaryColor: CUSTOM_HEX,
    });
    expect(result).toEqual({ primaryColor: CURATED_HEX, paletteId: BRAND_PALETTE[0]!.id });
    expect(result?.primaryColor).not.toBe(CUSTOM_HEX);
  });

  it("tags a free-picked colour that happens to match a swatch", () => {
    expect(resolveColorForTier("LARGE", { primaryColor: CURATED_HEX })).toEqual({
      primaryColor: CURATED_HEX,
      paletteId: BRAND_PALETTE[0]!.id,
    });
  });

  it("returns null when the request mentions no colour at all", () => {
    expect(resolveColorForTier("SMALL", {})).toBeNull();
  });

  it("rejects an unknown palette id even from LARGE", () => {
    expect(() => resolveColorForTier("LARGE", { paletteId: "neon-green" })).toThrowError(
      /Unknown palette id/,
    );
  });
});

/* ── 2. Image specs ─────────────────────────────────────────────────────── */

describe("assertValidBrandImage", () => {
  it("accepts a logo at exactly 725 × 145", () => {
    expect(() => assertValidBrandImage(fileOf(725, 145), LOGO_SPEC)).not.toThrow();
  });

  it("accepts a favicon at exactly 96 × 96", () => {
    expect(() => assertValidBrandImage(fileOf(96, 96), FAVICON_SPEC)).not.toThrow();
  });

  it("rejects a wrong-size logo and says what was received", () => {
    expect(() => assertValidBrandImage(fileOf(800, 160), LOGO_SPEC)).toThrowError(
      /exactly 725 × 145 px \(received 800 × 160 px\)/,
    );
  });

  it("rejects a logo that is right in one dimension only", () => {
    expect(() => assertValidBrandImage(fileOf(725, 200), LOGO_SPEC)).toThrow();
    expect(() => assertValidBrandImage(fileOf(700, 145), LOGO_SPEC)).toThrow();
  });

  it("rejects a transposed logo — 145 × 725 is not 725 × 145", () => {
    expect(() => assertValidBrandImage(fileOf(145, 725), LOGO_SPEC)).toThrow();
  });

  it("rejects a PDF even though the shared multer filter allows PDFs", () => {
    expect(() =>
      assertValidBrandImage(fileOf(725, 145, "application/pdf"), LOGO_SPEC),
    ).toThrowError(/must be one of/);
  });

  it("rejects JPEG for a favicon (no lossy artefacts on a 96px icon)", () => {
    expect(() => assertValidBrandImage(fileOf(96, 96, "image/jpeg"), FAVICON_SPEC)).toThrow();
  });

  it("rejects an oversized file before it parses a single byte", () => {
    expect(() =>
      assertValidBrandImage(fileOf(725, 145, "image/png", LOGO_SPEC.maxBytes + 1), LOGO_SPEC),
    ).toThrowError(/at most 2048 KB/);
  });

  it("rejects bytes that are not an image despite a correct MIME header", () => {
    const notAnImage = {
      ...fileOf(725, 145),
      buffer: Buffer.from("PK\x03\x04 this is a zip"),
    } as Express.Multer.File;
    expect(() => assertValidBrandImage(notAnImage, LOGO_SPEC)).toThrowError(/not a readable/);
  });

  it("returns a 400 for every image failure — none of these are server errors", () => {
    try {
      assertValidBrandImage(fileOf(800, 160), LOGO_SPEC);
    } catch (err) {
      expect((err as { status: number }).status).toBe(400);
    }
  });
});

/* ── 3. Resolution: nullable row → renderable theme ─────────────────────── */

describe("resolveBranding", () => {
  it("produces a complete theme for an agency with no branding row at all", () => {
    // The trial account on day one. Nothing here may be null except the images.
    const theme = resolveBranding({ name: "Sherpa Treks", tier: "FREE" }, null);

    expect(theme.brandName).toBe("Sherpa Treks"); // falls back to the legal name
    expect(theme.primaryColor).toBe("#0F766E");
    expect(theme.fontStack).toContain("Inter");
    expect(theme.cardImageRatioValue).toBe("4 / 3");
    expect(theme.currencySymbol).toBe("Rs");
    expect(theme.logoUrl).toBeNull();
    expect(theme.faviconUrl).toBeNull();
  });

  it("never leaves a renderable field null", () => {
    const theme = resolveBranding({ name: "Sherpa Treks", tier: "FREE" }, null);
    const mustBeSet = [
      "brandName",
      "primaryColor",
      "onPrimaryColor",
      "fontFamily",
      "fontStack",
      "cardImageRatio",
      "cardImageRatioValue",
      "currencyCode",
      "currencySymbol",
      "currencyDisplay",
    ] as const;

    // A null here becomes the literal string "null" inside a CSS variable —
    // which renders, silently, as a broken site rather than an error.
    for (const key of mustBeSet) {
      expect(theme[key], `${key} must not be null/undefined`).toBeTruthy();
    }
  });

  it("prefers the brand name over the registered legal name", () => {
    const theme = resolveBranding(
      { name: "Himalayan Trails Pvt. Ltd.", tier: "MEDIUM" },
      brandingRow({ brandName: "Himalayan Trails" }),
    );
    expect(theme.brandName).toBe("Himalayan Trails");
  });

  it("uses the swatch's hand-checked text colour when the colour is curated", () => {
    const theme = resolveBranding(
      { name: "A", tier: "SMALL" },
      brandingRow({ primaryColor: CURATED_HEX, paletteId: BRAND_PALETTE[0]!.id }),
    );
    expect(theme.onPrimaryColor).toBe(BRAND_PALETTE[0]!.onColor);
  });

  it("computes a readable text colour for a custom colour nobody has checked", () => {
    const onYellow = resolveBranding(
      { name: "A", tier: "LARGE" },
      brandingRow({ primaryColor: "#FFFF00" }),
    );
    const onNavy = resolveBranding(
      { name: "A", tier: "LARGE" },
      brandingRow({ primaryColor: "#001F3F" }),
    );
    expect(onYellow.onPrimaryColor).toBe("#111827"); // dark text on yellow
    expect(onNavy.onPrimaryColor).toBe("#FFFFFF"); // light text on navy
  });

  it("keeps the 'Powered by Funtush' badge on every tier except LARGE", () => {
    // Backend Guide §6: complete white-label is a LARGE-tier capability, and the
    // agency side cannot switch the badge off.
    for (const tier of ["FREE", "SMALL", "MEDIUM"]) {
      expect(resolveBranding({ name: "A", tier }, null).poweredByFuntush).toBe(true);
    }
    expect(resolveBranding({ name: "A", tier: "LARGE" }, null).poweredByFuntush).toBe(false);
  });

  it("reports which colour picker the tier is entitled to", () => {
    expect(resolveBranding({ name: "A", tier: "SMALL" }, null).colorPickerMode).toBe("curated");
    expect(resolveBranding({ name: "A", tier: "LARGE" }, null).colorPickerMode).toBe("free");
  });

  it("keeps rendering a site whose stored font was retired from the whitelist", () => {
    const theme = resolveBranding(
      { name: "A", tier: "MEDIUM" },
      brandingRow({ fontFamily: "comic-sans-2019" }),
    );
    expect(theme.fontFamily).toBe("inter");
    expect(theme.fontStack).toContain("Inter");
  });

  it("prefers an explicit currency symbol override over the table's", () => {
    const theme = resolveBranding(
      { name: "A", tier: "MEDIUM" },
      brandingRow({ currencyCode: "NPR", currencySymbol: "रु" }),
    );
    expect(theme.currencySymbol).toBe("रु");
    expect(theme.currencyExample).toBe("रु 1,200");
  });

  it("maps each ratio to its CSS aspect-ratio value", () => {
    const cases = {
      RATIO_1_1: "1 / 1",
      RATIO_4_3: "4 / 3",
      RATIO_16_9: "16 / 9",
    };
    for (const [stored, css] of Object.entries(cases)) {
      const theme = resolveBranding(
        { name: "A", tier: "MEDIUM" },
        brandingRow({ cardImageRatio: stored }),
      );
      expect(theme.cardImageRatioValue).toBe(css);
    }
  });
});

describe("formatCurrencyExample", () => {
  it("writes a price the three ways the setting allows", () => {
    expect(formatCurrencyExample("Rs", "NPR", "SYMBOL")).toBe("Rs 1,200");
    expect(formatCurrencyExample("Rs", "NPR", "CODE")).toBe("NPR 1,200");
    expect(formatCurrencyExample("Rs", "NPR", "SYMBOL_CODE")).toBe("Rs 1,200 NPR");
  });
});

describe("readableTextColor", () => {
  it("picks dark text on light backgrounds and light text on dark ones", () => {
    expect(readableTextColor("#FFFFFF")).toBe("#111827");
    expect(readableTextColor("#000000")).toBe("#FFFFFF");
  });

  it("agrees with every hand-checked swatch in the curated palette", () => {
    // If the maths and the hand-picked `onColor` ever disagree, one of them is
    // wrong and a real button becomes unreadable.
    for (const swatch of BRAND_PALETTE) {
      expect(readableTextColor(swatch.hex), swatch.id).toBe(swatch.onColor);
    }
  });
});

/* ── 4. The CSS the site actually renders with — the day's deliverable ──── */

describe("brandingCssVariables", () => {
  it("emits the four variables the white-label stylesheet is written against", () => {
    const theme = resolveBranding(
      { name: "A", tier: "LARGE" },
      brandingRow({ primaryColor: "#B91C1C", fontFamily: "lora", cardImageRatio: "RATIO_16_9" }),
    );
    expect(brandingCssVariables(theme)).toEqual({
      "--brand-primary": "#B91C1C",
      "--brand-on-primary": "#FFFFFF",
      "--brand-font": "'Lora', Georgia, 'Times New Roman', serif",
      "--brand-card-ratio": "16 / 9",
    });
  });

  it("never emits the string 'null' or 'undefined' into a stylesheet", () => {
    const block = brandingStyleBlock(resolveBranding({ name: "A", tier: "FREE" }, null));
    expect(block).not.toMatch(/null|undefined/);
    expect(block.startsWith(":root {")).toBe(true);
  });
});

/* ── 5. The write path ──────────────────────────────────────────────────── */

describe("updateAgencyBranding", () => {
  it("saves fields and uploads both images", async () => {
    await updateAgencyBranding(
      AGENCY_ID,
      { brandName: "Himalayan Trails", fontFamily: "poppins" },
      { logo: [fileOf(725, 145)], favicon: [fileOf(96, 96)] },
    );

    expect(uploadFileMock).toHaveBeenCalledTimes(2);
    const { create } = brandingUpsert.mock.calls[0]![0];
    expect(create.brandName).toBe("Himalayan Trails");
    expect(create.fontFamily).toBe("poppins");
    expect(create.logoUrl).toBeTruthy();
    expect(create.faviconUrl).toBeTruthy();
  });

  it("upserts, so an agency saving branding for the first time does not 404", async () => {
    brandingFindUnique.mockResolvedValue(null);
    await updateAgencyBranding(AGENCY_ID, { brandName: "First Save" });
    expect(brandingUpsert).toHaveBeenCalledTimes(1);
    expect(brandingUpsert.mock.calls[0]![0].where).toEqual({ agencyId: AGENCY_ID });
  });

  it("never uploads a file when the tier rule is going to reject the colour", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));

    await expect(
      updateAgencyBranding(
        AGENCY_ID,
        { primaryColor: CUSTOM_HEX },
        { logo: [fileOf(725, 145)] },
      ),
    ).rejects.toThrowError(/curated colour palette/i);

    // The point of the test: a rejected save costs zero S3 writes and zero rows.
    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(brandingUpsert).not.toHaveBeenCalled();
  });

  it("never uploads a file when a wrongly-sized image is going to be rejected", async () => {
    await expect(
      updateAgencyBranding(AGENCY_ID, {}, { logo: [fileOf(800, 160)] }),
    ).rejects.toThrowError(/exactly 725 × 145/);

    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(brandingUpsert).not.toHaveBeenCalled();
  });

  it("validates the favicon before uploading the logo that came with it", async () => {
    // Both files are checked before either upload, so one bad file in a
    // two-file request leaves nothing behind in the bucket.
    await expect(
      updateAgencyBranding(
        AGENCY_ID,
        {},
        { logo: [fileOf(725, 145)], favicon: [fileOf(64, 64)] },
      ),
    ).rejects.toThrowError(/Favicon/);

    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("takes the colour from the server-resolved swatch, not from the request body", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));
    await updateAgencyBranding(AGENCY_ID, {
      paletteId: BRAND_PALETTE[2]!.id,
      primaryColor: CUSTOM_HEX,
    });

    const { create } = brandingUpsert.mock.calls[0]![0];
    expect(create.primaryColor).toBe(BRAND_PALETTE[2]!.hex);
    expect(create.paletteId).toBe(BRAND_PALETTE[2]!.id);
  });

  it("deletes the replaced logo, but only after the row is written", async () => {
    brandingFindUnique.mockResolvedValue(
      brandingRow({ logoUrl: "https://cdn.funtush.com/uploads/old-logo.png" }),
    );

    await updateAgencyBranding(AGENCY_ID, {}, { logo: [fileOf(725, 145)] });

    expect(deleteFileMock).toHaveBeenCalledWith("https://cdn.funtush.com/uploads/old-logo.png");
    // Ordering matters: deleting first would leave a live site pointing at a
    // file that no longer exists if the upsert then failed.
    const upsertOrder = brandingUpsert.mock.invocationCallOrder[0]!;
    const deleteOrder = deleteFileMock.mock.invocationCallOrder[0]!;
    expect(deleteOrder).toBeGreaterThan(upsertOrder);
  });

  it("does not fail the save when deleting the replaced file fails", async () => {
    brandingFindUnique.mockResolvedValue(brandingRow({ logoUrl: "https://cdn/old.png" }));
    deleteFileMock.mockRejectedValue(new Error("S3 is having a day"));

    await expect(
      updateAgencyBranding(AGENCY_ID, {}, { logo: [fileOf(725, 145)] }),
    ).resolves.toBeTruthy();
  });

  it("does not delete anything when no new file was uploaded", async () => {
    brandingFindUnique.mockResolvedValue(brandingRow({ logoUrl: "https://cdn/keep-me.png" }));
    await updateAgencyBranding(AGENCY_ID, { brandName: "Name only" });
    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  it("treats a null currencySymbol as 'clear my override', not as 'no change'", async () => {
    await updateAgencyBranding(AGENCY_ID, { currencySymbol: null });
    expect(brandingUpsert.mock.calls[0]![0].update).toHaveProperty("currencySymbol", null);
  });

  it("rejects an entirely empty request instead of writing a no-op row", async () => {
    await expect(updateAgencyBranding(AGENCY_ID, {})).rejects.toThrowError(/No branding fields/);
    expect(brandingUpsert).not.toHaveBeenCalled();
  });

  it("404s for an agency id that does not exist", async () => {
    agencyFindUnique.mockResolvedValue(null);
    await expect(updateAgencyBranding("nope", { brandName: "X" })).rejects.toThrowError(
      /Agency not found/,
    );
  });
});

/* ── 6. Reads ───────────────────────────────────────────────────────────── */

describe("getAgencyBranding", () => {
  it("scopes the lookup to the caller's own agency id", async () => {
    await getAgencyBranding(AGENCY_ID);
    // Tenant isolation is a data-layer property (Backend Guide §4): the id used
    // here comes from the session, and this asserts nothing else can widen it.
    expect(brandingFindUnique).toHaveBeenCalledWith({ where: { agencyId: AGENCY_ID } });
  });
});

describe("getPublicBrandingBySlug", () => {
  function agencyWithBranding(status: string, tier = "MEDIUM") {
    return {
      name: "Himalayan Trails Pvt. Ltd.",
      slug: "himalayan-trails",
      status,
      tier: { name: tier },
      branding: brandingRow({ brandName: "Himalayan Trails" }),
    };
  }

  it("returns a renderable theme for an ACTIVE agency", async () => {
    agencyFindUnique.mockResolvedValue(agencyWithBranding("ACTIVE"));
    const theme = await getPublicBrandingBySlug("himalayan-trails");
    expect(theme.brandName).toBe("Himalayan Trails");
    expect(theme.agencySlug).toBe("himalayan-trails");
  });

  it("renders a TRIAL agency's site — the trial gets a *.funtush.io subdomain", async () => {
    agencyFindUnique.mockResolvedValue(agencyWithBranding("TRIAL", "FREE"));
    await expect(getPublicBrandingBySlug("himalayan-trails")).resolves.toBeTruthy();
  });

  it("404s a LOCKED or SUSPENDED agency rather than 403ing it", async () => {
    // 403 would confirm "this agency exists but is not paying" to any anonymous
    // visitor who guessed the slug. 404 leaks nothing.
    for (const status of ["LOCKED", "SUSPENDED"]) {
      agencyFindUnique.mockResolvedValue(agencyWithBranding(status));
      try {
        await getPublicBrandingBySlug("himalayan-trails");
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as { status: number }).status).toBe(404);
        expect((err as Error).message).toBe("Site not found");
      }
    }
  });

  it("404s an unknown slug with the same message as a locked one", async () => {
    agencyFindUnique.mockResolvedValue(null);
    await expect(getPublicBrandingBySlug("does-not-exist")).rejects.toThrowError("Site not found");
  });
});

describe("getBrandingOptions", () => {
  it("offers the free picker to MEDIUM and the curated list to SMALL", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("MEDIUM"));
    expect((await getBrandingOptions(AGENCY_ID)).colorPickerMode).toBe("free");

    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));
    expect((await getBrandingOptions(AGENCY_ID)).colorPickerMode).toBe("curated");
  });

  it("still sends the palette to free-picker tiers, as presets", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("LARGE"));
    const options = await getBrandingOptions(AGENCY_ID);
    expect(options.palette.length).toBe(BRAND_PALETTE.length);
  });

  it("publishes the exact pixel sizes the UI must tell the user about", async () => {
    const options = await getBrandingOptions(AGENCY_ID);
    expect(options.imageSpecs.logo).toMatchObject({ width: 725, height: 145 });
    expect(options.imageSpecs.favicon).toMatchObject({ width: 96, height: 96 });
  });

  it("lists exactly the three ratios the spec names", async () => {
    const options = await getBrandingOptions(AGENCY_ID);
    expect(options.cardImageRatios.map((r) => r.id)).toEqual([
      "RATIO_1_1",
      "RATIO_4_3",
      "RATIO_16_9",
    ]);
  });
});

import { describe, it, expect } from "vitest";

/**
 * Unit tests for the branding request schema (White-label week · Day 1).
 *
 * These cover the layer that runs *before* any database call: shape, types,
 * whitelist membership, normalisation. The tier rule and the image rules are
 * tested in `services/branding.service.test.ts` — deliberately not here, because
 * they need context this layer does not have.
 */

import { brandingUpdateSchema } from "./branding.validation";
import { BRAND_PALETTE, BRAND_FONTS, MAX_CURRENCY_SYMBOL_LENGTH } from "../data/brandTheme";

/** Parse and return data, failing the test loudly if the schema rejected it. */
function parse(input: unknown) {
  const result = brandingUpdateSchema.safeParse(input);
  if (!result.success) throw new Error(JSON.stringify(result.error.flatten()));
  return result.data;
}

/** `true` when the schema rejected the input. */
function rejects(input: unknown): boolean {
  return !brandingUpdateSchema.safeParse(input).success;
}

describe("brandingUpdateSchema", () => {
  it("accepts an empty object — every field is optional on a PATCH", () => {
    // The "did you send anything at all?" check lives in the service, because it
    // also has to consider uploaded files, which the schema cannot see.
    expect(parse({})).toEqual({});
  });

  it("accepts a full, valid payload", () => {
    const data = parse({
      brandName: "Himalayan Trails",
      primaryColor: "#0f766e",
      paletteId: BRAND_PALETTE[0]!.id,
      fontFamily: BRAND_FONTS[0]!.id,
      cardImageRatio: "RATIO_16_9",
      currencyCode: "usd",
      currencySymbol: "$",
      currencyDisplay: "SYMBOL_CODE",
    });
    expect(data.brandName).toBe("Himalayan Trails");
  });

  /* ── Normalisation ─────────────────────────────────────────────────────── */

  it("uppercases the hex colour so every later comparison is a plain ===", () => {
    expect(parse({ primaryColor: "#0f766e" }).primaryColor).toBe("#0F766E");
  });

  it("uppercases the currency code", () => {
    expect(parse({ currencyCode: "npr" }).currencyCode).toBe("NPR");
  });

  it("trims a brand name before measuring its length", () => {
    expect(parse({ brandName: "  Himalayan Trails  " }).brandName).toBe("Himalayan Trails");
    // Three spaces trims to empty, which is shorter than the 2-character
    // minimum — so a whitespace-only name is caught rather than stored and
    // rendered as a blank header.
    expect(rejects({ brandName: "   " })).toBe(true);
  });

  /* ── Colour ────────────────────────────────────────────────────────────── */

  it("rejects colours that are not 6-digit hex", () => {
    expect(rejects({ primaryColor: "#0F7" })).toBe(true); // shorthand
    expect(rejects({ primaryColor: "0F766E" })).toBe(true); // no hash
    expect(rejects({ primaryColor: "teal" })).toBe(true); // css keyword
    expect(rejects({ primaryColor: "rgb(15,118,110)" })).toBe(true);
    expect(rejects({ primaryColor: "#GGGGGG" })).toBe(true);
    expect(rejects({ primaryColor: "#0F766E80" })).toBe(true); // 8-digit alpha
  });

  it("rejects a palette id that is not one of ours", () => {
    expect(rejects({ paletteId: "neon-green" })).toBe(true);
  });

  /* ── Whitelists ────────────────────────────────────────────────────────── */

  it("rejects a font that is not on the whitelist", () => {
    // The whitelist is a security boundary, not a style guide: the stack it maps
    // to is emitted into a <style> block, so free text there is an injection
    // hole. See the `stack` comment in data/brandTheme.ts.
    expect(rejects({ fontFamily: "Comic Sans MS" })).toBe(true);
    expect(rejects({ fontFamily: "Arial; } body { display: none } .x {" })).toBe(true);
  });

  it("rejects an image ratio outside the three the task names", () => {
    expect(rejects({ cardImageRatio: "RATIO_3_2" })).toBe(true);
    expect(rejects({ cardImageRatio: "16:9" })).toBe(true); // right idea, wrong key
  });

  it("rejects an unsupported currency", () => {
    expect(rejects({ currencyCode: "XYZ" })).toBe(true);
  });

  it("rejects a currency display mode it does not know", () => {
    expect(rejects({ currencyDisplay: "BOTH" })).toBe(true);
  });

  /* ── Currency symbol ───────────────────────────────────────────────────── */

  it("accepts null as 'clear my override' but rejects empty string", () => {
    expect(parse({ currencySymbol: null }).currencySymbol).toBeNull();
    expect(rejects({ currencySymbol: "" })).toBe(true);
  });

  it("caps the symbol length", () => {
    expect(rejects({ currencySymbol: "A".repeat(MAX_CURRENCY_SYMBOL_LENGTH + 1) })).toBe(true);
  });

  it("rejects markup characters in a symbol — it is printed inside a price label", () => {
    for (const symbol of ["<b>", '"', "'", "&", "`", "\\"]) {
      expect(rejects({ currencySymbol: symbol }), symbol).toBe(true);
    }
  });

  it("accepts real non-ASCII symbols", () => {
    expect(parse({ currencySymbol: "रु" }).currencySymbol).toBe("रु");
    expect(parse({ currencySymbol: "€" }).currencySymbol).toBe("€");
  });

  /* ── Strictness ────────────────────────────────────────────────────────── */

  it("rejects an unknown key instead of silently ignoring it", () => {
    // A misspelled field that returns 200 and changes nothing is the worst
    // possible outcome — the agency believes it saved.
    expect(rejects({ primaryColour: "#FF0000" })).toBe(true);
    expect(rejects({ logoUrl: "https://evil.example/logo.png" })).toBe(true);
  });

  it("does not let the client set the logo URL directly", () => {
    // Image URLs are produced by the upload step, never accepted from a body —
    // otherwise an agency could point its logo at any URL on the internet.
    expect(rejects({ faviconUrl: "https://evil.example/f.png" })).toBe(true);
  });

  it("rejects wrong types rather than coercing them", () => {
    expect(rejects({ brandName: 12345 })).toBe(true);
    expect(rejects({ primaryColor: null })).toBe(true);
    expect(rejects({ cardImageRatio: true })).toBe(true);
  });
});

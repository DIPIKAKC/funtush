import { describe, it, expect } from "vitest";
import {
  BOOK_NOW_CUSTOMIZATION_TIERS,
  CUSTOM_NAVIGATION_TIERS,
  DEFAULT_BOOK_NOW_LABEL,
  DEFAULT_NAVIGATION_ITEMS,
  MAX_DROPDOWN_ITEMS,
  MAX_INTERNAL_PATH_LENGTH,
  MAX_TOP_LEVEL_ITEMS,
  allowsBookNowCustomization,
  allowsCustomNavigation,
  isSafeInternalPath,
} from "./navigation";

/**
 * Unit tests for the navigation-builder option tables (White-label week · Day 3).
 *
 * Mirrors the shape of `siteConfig.test.ts` / `brandTheme`'s implicit coverage:
 * pure functions of a tier name or a string, no database, no fixtures.
 */

describe("allowsCustomNavigation", () => {
  it("is true for Medium and Large", () => {
    expect(allowsCustomNavigation("MEDIUM")).toBe(true);
    expect(allowsCustomNavigation("LARGE")).toBe(true);
  });

  it("is false for Small and the trial (FREE)", () => {
    expect(allowsCustomNavigation("SMALL")).toBe(false);
    expect(allowsCustomNavigation("FREE")).toBe(false);
  });

  it("is false for an unrecognised tier string", () => {
    // A corrupt fixture or a future tier that has not been wired up yet must
    // fail closed, not open — same posture as Day 1/2's tier gates.
    expect(allowsCustomNavigation("WHATEVER")).toBe(false);
  });
});

describe("allowsBookNowCustomization", () => {
  it("matches CUSTOM_NAVIGATION_TIERS today, but is a distinct constant", () => {
    // The two lists happen to hold the same values. They must not be the same
    // *reference* — that would silently reunite two independent product
    // decisions the day one of them changes.
    expect(BOOK_NOW_CUSTOMIZATION_TIERS).not.toBe(CUSTOM_NAVIGATION_TIERS);
    expect([...BOOK_NOW_CUSTOMIZATION_TIERS]).toEqual([...CUSTOM_NAVIGATION_TIERS]);
  });

  it("is true for Medium and Large, false for Small and FREE", () => {
    expect(allowsBookNowCustomization("MEDIUM")).toBe(true);
    expect(allowsBookNowCustomization("LARGE")).toBe(true);
    expect(allowsBookNowCustomization("SMALL")).toBe(false);
    expect(allowsBookNowCustomization("FREE")).toBe(false);
  });
});

describe("isSafeInternalPath", () => {
  it("accepts an ordinary site path", () => {
    expect(isSafeInternalPath("/packages")).toBe(true);
    expect(isSafeInternalPath("/")).toBe(true);
    expect(isSafeInternalPath("/packages?season=autumn#departures")).toBe(true);
  });

  it("rejects a path with no leading slash", () => {
    expect(isSafeInternalPath("packages")).toBe(false);
    expect(isSafeInternalPath("")).toBe(false);
  });

  it("rejects a protocol-relative URL disguised as a path", () => {
    // `//evil.com` has no scheme, so a naive "starts with /" check would let it
    // through — but a browser resolves a leading `//` as a hostname, not a path.
    expect(isSafeInternalPath("//evil.com")).toBe(false);
    expect(isSafeInternalPath("//evil.com/phish")).toBe(false);
  });

  it("rejects an absolute URL and a javascript: scheme", () => {
    expect(isSafeInternalPath("https://evil.com")).toBe(false);
    expect(isSafeInternalPath("javascript:alert(1)")).toBe(false);
  });

  it("rejects a space and an angle bracket", () => {
    expect(isSafeInternalPath("/hello world")).toBe(false);
    expect(isSafeInternalPath("/<script>")).toBe(false);
  });

  it("rejects a path over the length ceiling", () => {
    const long = "/" + "a".repeat(MAX_INTERNAL_PATH_LENGTH);
    expect(isSafeInternalPath(long)).toBe(false);
  });
});

describe("DEFAULT_NAVIGATION_ITEMS", () => {
  it("is within the top-level item limit", () => {
    expect(DEFAULT_NAVIGATION_ITEMS.length).toBeLessThanOrEqual(MAX_TOP_LEVEL_ITEMS);
  });

  it("every item is an internal, safe path", () => {
    for (const item of DEFAULT_NAVIGATION_ITEMS) {
      expect(item.linkType).toBe("INTERNAL");
      expect(isSafeInternalPath(item.url)).toBe(true);
    }
  });

  it("has no duplicate labels", () => {
    const labels = DEFAULT_NAVIGATION_ITEMS.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("constants", () => {
  it("DEFAULT_BOOK_NOW_LABEL is non-empty", () => {
    expect(DEFAULT_BOOK_NOW_LABEL.length).toBeGreaterThan(0);
  });

  it("MAX_DROPDOWN_ITEMS is a sane positive ceiling", () => {
    expect(MAX_DROPDOWN_ITEMS).toBeGreaterThan(0);
    expect(MAX_DROPDOWN_ITEMS).toBeLessThan(100);
  });
});

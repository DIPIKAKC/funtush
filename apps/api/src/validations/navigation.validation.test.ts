import { describe, it, expect } from "vitest";
import { navigationUpdateSchema } from "./navigation.validation";
import { MAX_DROPDOWN_ITEMS, MAX_TOP_LEVEL_ITEMS } from "../data/navigation";

/**
 * Unit tests for the navigation request schema (White-label week · Day 3).
 *
 * Organised around the things that can actually go wrong on this endpoint:
 *
 *   1. Well-formed items pass, in shape and by count.
 *   2. `url` must match `linkType` — the one per-item cross-field rule zod
 *      is allowed to own, because it needs no database and no other field.
 *   3. Depth is unrepresentable past level two, not merely checked.
 *   4. Unknown keys are rejected (`.strict()`), same as Day 1 and Day 2.
 *   5. `null` vs absent on `bookNowLabel` behaves like every other white-label
 *      "clear it back to default" field.
 */

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    label: "Destinations",
    linkType: "INTERNAL",
    url: "/destinations",
    ...overrides,
  };
}

describe("navigationUpdateSchema — items shape", () => {
  it("accepts a well-formed top-level item with no children", () => {
    const result = navigationUpdateSchema.safeParse({ items: [baseItem()] });
    expect(result.success).toBe(true);
  });

  it("accepts a two-level menu: a top-level item with dropdown children", () => {
    const result = navigationUpdateSchema.safeParse({
      items: [
        baseItem({
          children: [
            baseItem({ label: "Everest Region", url: "/destinations/everest" }),
            baseItem({ label: "Annapurna Region", url: "/destinations/annapurna" }),
          ],
        }),
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a third level of nesting as an unrecognised key", () => {
    // A child item's schema has no `children` field at all — this is not a
    // depth counter rejecting "too deep", it is "there is nowhere to put it".
    const result = navigationUpdateSchema.safeParse({
      items: [
        baseItem({
          children: [baseItem({ children: [baseItem()] })],
        }),
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than the top-level item limit", () => {
    const items = Array.from({ length: MAX_TOP_LEVEL_ITEMS + 1 }, (_, i) =>
      baseItem({ label: `Item ${i}`, url: `/item-${i}` }),
    );
    const result = navigationUpdateSchema.safeParse({ items });
    expect(result.success).toBe(false);
  });

  it("accepts exactly the top-level item limit", () => {
    const items = Array.from({ length: MAX_TOP_LEVEL_ITEMS }, (_, i) =>
      baseItem({ label: `Item ${i}`, url: `/item-${i}` }),
    );
    expect(navigationUpdateSchema.safeParse({ items }).success).toBe(true);
  });

  it("rejects more dropdown children than the limit", () => {
    const children = Array.from({ length: MAX_DROPDOWN_ITEMS + 1 }, (_, i) =>
      baseItem({ label: `Child ${i}`, url: `/child-${i}` }),
    );
    const result = navigationUpdateSchema.safeParse({ items: [baseItem({ children })] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty label", () => {
    const result = navigationUpdateSchema.safeParse({ items: [baseItem({ label: "" })] });
    expect(result.success).toBe(false);
  });

  it("rejects a label containing < or >", () => {
    const result = navigationUpdateSchema.safeParse({
      items: [baseItem({ label: "<script>alert(1)</script>" })],
    });
    expect(result.success).toBe(false);
  });

  it("trims a label with surrounding whitespace", () => {
    const result = navigationUpdateSchema.safeParse({ items: [baseItem({ label: "  Treks  " })] });
    expect(result.success).toBe(true);
    expect(result.success && result.data.items?.[0]?.label).toBe("Treks");
  });
});

describe("navigationUpdateSchema — url must match linkType", () => {
  it("accepts an internal path for an INTERNAL item", () => {
    const result = navigationUpdateSchema.safeParse({
      items: [baseItem({ linkType: "INTERNAL", url: "/about" })],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a full URL on an INTERNAL item", () => {
    const result = navigationUpdateSchema.safeParse({
      items: [baseItem({ linkType: "INTERNAL", url: "https://example.com" })],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a protocol-relative URL on an INTERNAL item", () => {
    const result = navigationUpdateSchema.safeParse({
      items: [baseItem({ linkType: "INTERNAL", url: "//evil.com" })],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a full https:// URL for an EXTERNAL item", () => {
    const result = navigationUpdateSchema.safeParse({
      items: [baseItem({ linkType: "EXTERNAL", url: "https://partner-trekking.example.com" })],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an internal path on an EXTERNAL item", () => {
    const result = navigationUpdateSchema.safeParse({
      items: [baseItem({ linkType: "EXTERNAL", url: "/packages" })],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a javascript: URL for an EXTERNAL item", () => {
    const result = navigationUpdateSchema.safeParse({
      items: [baseItem({ linkType: "EXTERNAL", url: "javascript:alert(document.cookie)" })],
    });
    expect(result.success).toBe(false);
  });

  it("attaches the error to the url field, not the whole item", () => {
    const result = navigationUpdateSchema.safeParse({
      items: [baseItem({ linkType: "EXTERNAL", url: "/packages" })],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0]!;
      expect(issue.path).toContain("url");
    }
  });

  it("validates the url/linkType pairing on dropdown children too", () => {
    const result = navigationUpdateSchema.safeParse({
      items: [baseItem({ children: [baseItem({ linkType: "EXTERNAL", url: "/oops" })] })],
    });
    expect(result.success).toBe(false);
  });
});

describe("navigationUpdateSchema — unknown keys and top-level fields", () => {
  it("rejects an unrecognised top-level key", () => {
    const result = navigationUpdateSchema.safeParse({ itemss: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognised key inside an item", () => {
    const result = navigationUpdateSchema.safeParse({ items: [baseItem({ icon: "star" })] });
    expect(result.success).toBe(false);
  });

  it("accepts an empty items array — clearing the whole menu", () => {
    const result = navigationUpdateSchema.safeParse({ items: [] });
    expect(result.success).toBe(true);
  });

  it("accepts a body with only bookNowLabel", () => {
    const result = navigationUpdateSchema.safeParse({ bookNowLabel: "Reserve Now" });
    expect(result.success).toBe(true);
  });

  it("accepts bookNowLabel: null to clear it back to the default", () => {
    const result = navigationUpdateSchema.safeParse({ bookNowLabel: null });
    expect(result.success).toBe(true);
  });

  it("accepts a body with only bookNowHidden", () => {
    expect(navigationUpdateSchema.safeParse({ bookNowHidden: true }).success).toBe(true);
  });

  it("rejects an empty bookNowLabel", () => {
    expect(navigationUpdateSchema.safeParse({ bookNowLabel: "" }).success).toBe(false);
  });

  it("rejects a bookNowLabel containing < or >", () => {
    expect(navigationUpdateSchema.safeParse({ bookNowLabel: "<b>Book</b>" }).success).toBe(false);
  });

  it("accepts an entirely empty object — the service, not zod, rejects a no-op patch", () => {
    expect(navigationUpdateSchema.safeParse({}).success).toBe(true);
  });
});

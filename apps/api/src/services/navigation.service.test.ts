import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the navigation builder service (White-label week · Day 3).
 *
 * `@funtush/database` is replaced with spies, so these run with no Postgres and
 * no network — same approach as `siteConfig.service.test.ts`.
 *
 * The suite is organised around what can actually go wrong on this endpoint:
 *
 *   1. **Tree building** — a flat list of rows must become the right shape,
 *      sorted, with children under the right parent.
 *   2. **Tier rules on the write path** — 403s for the menu builder and the
 *      Book Now button, independently.
 *   3. **Tier rules on the read path** — the downgrade case: a Large agency's
 *      saved menu must stop rendering the instant it drops to Small, without
 *      the data being deleted.
 *   4. **The write itself** — full replace, in a transaction, children created
 *      after their parent so `parentId` can be a real id.
 */

const agencyFindUnique = vi.fn();
const navigationFindUnique = vi.fn();
const navigationUpsert = vi.fn();
const itemDeleteMany = vi.fn();
const itemCreate = vi.fn();

vi.mock("@funtush/database", () => ({
  db: {
    agency: { findUnique: (...a: unknown[]) => agencyFindUnique(...a) },
    agencyNavigation: {
      findUnique: (...a: unknown[]) => navigationFindUnique(...a),
      upsert: (...a: unknown[]) => navigationUpsert(...a),
    },
    agencyNavigationItem: {
      deleteMany: (...a: unknown[]) => itemDeleteMany(...a),
      create: (...a: unknown[]) => itemCreate(...a),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        agencyNavigation: { upsert: (...a: unknown[]) => navigationUpsert(...a) },
        agencyNavigationItem: {
          deleteMany: (...a: unknown[]) => itemDeleteMany(...a),
          create: (...a: unknown[]) => itemCreate(...a),
        },
      }),
  },
}));

import {
  assertBookNowChangeAllowed,
  assertCustomNavigationAllowed,
  buildItemTree,
  defaultNavigationItems,
  getNavigation,
  getPublicNavigationBySlug,
  resolveBookNow,
  resolveNavigation,
  updateNavigation,
  type NavigationItemRow,
  type NavigationRecordRow,
} from "./navigation.service";
import { DEFAULT_BOOK_NOW_LABEL, DEFAULT_NAVIGATION_ITEMS } from "../data/navigation";
import type { NavigationUpdateInput } from "../validations/navigation.validation";

const AGENCY_ID = "agency-1";
const SAVED_AT = new Date("2026-08-09T09:00:00.000Z");

function agencyOnTier(tier: string) {
  return {
    id: AGENCY_ID,
    name: "Himalayan Trails Pvt. Ltd.",
    slug: "himalayan-trails",
    status: "ACTIVE",
    tier: { name: tier },
  };
}

function row(overrides: Partial<NavigationItemRow>): NavigationItemRow {
  return {
    id: "item-1",
    parentId: null,
    label: "Item",
    linkType: "INTERNAL",
    url: "/item",
    openInNewTab: false,
    position: 0,
    ...overrides,
  };
}

function statusOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { status?: number }).status;
  }
  return undefined;
}

async function statusOfAsync(fn: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { status?: number }).status;
  }
  return undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  let idCounter = 0;
  itemCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `created-${++idCounter}`,
    ...data,
  }));
  navigationUpsert.mockResolvedValue({ id: "nav-1" });
});

/* ── buildItemTree ─────────────────────────────────────────────────────── */

describe("buildItemTree", () => {
  it("returns top-level items sorted by position, ignoring input order", () => {
    const rows = [
      row({ id: "b", label: "Second", position: 1 }),
      row({ id: "a", label: "First", position: 0 }),
    ];
    const tree = buildItemTree(rows);
    expect(tree.map((item) => item.label)).toEqual(["First", "Second"]);
  });

  it("nests children under their parent, sorted by their own position", () => {
    const rows = [
      row({ id: "parent", label: "Destinations", position: 0 }),
      row({ id: "c2", parentId: "parent", label: "Annapurna", position: 1 }),
      row({ id: "c1", parentId: "parent", label: "Everest", position: 0 }),
    ];
    const tree = buildItemTree(rows);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children.map((c) => c.label)).toEqual(["Everest", "Annapurna"]);
  });

  it("does not attach a child to a top-level item that isn't its parent", () => {
    const rows = [
      row({ id: "p1", label: "Destinations", position: 0 }),
      row({ id: "p2", label: "About", position: 1 }),
      row({ id: "c1", parentId: "p1", label: "Everest", position: 0 }),
    ];
    const tree = buildItemTree(rows);
    const about = tree.find((item) => item.label === "About")!;
    expect(about.children).toEqual([]);
  });

  it("an item with no children resolves to an empty array, not undefined", () => {
    const tree = buildItemTree([row({ id: "solo" })]);
    expect(tree[0]!.children).toEqual([]);
  });
});

describe("defaultNavigationItems", () => {
  it("mirrors DEFAULT_NAVIGATION_ITEMS with an empty children array on each", () => {
    const items = defaultNavigationItems();
    expect(items).toHaveLength(DEFAULT_NAVIGATION_ITEMS.length);
    expect(items.every((item) => Array.isArray(item.children) && item.children.length === 0)).toBe(true);
  });
});

/* ── resolveBookNow / resolveNavigation ───────────────────────────────────── */

describe("resolveBookNow", () => {
  it("forces the default label and visible for a tier without the feature", () => {
    const stored: NavigationRecordRow = {
      bookNowLabel: "Reserve Your Trek",
      bookNowHidden: true,
      items: [],
      updatedAt: SAVED_AT,
    };
    expect(resolveBookNow("SMALL", stored)).toEqual({ label: DEFAULT_BOOK_NOW_LABEL, hidden: false });
  });

  it("returns the stored label and visibility for an allowed tier", () => {
    const stored: NavigationRecordRow = {
      bookNowLabel: "Reserve Your Trek",
      bookNowHidden: true,
      items: [],
      updatedAt: SAVED_AT,
    };
    expect(resolveBookNow("LARGE", stored)).toEqual({ label: "Reserve Your Trek", hidden: true });
  });

  it("falls back to the default label when the stored one is blank", () => {
    const stored: NavigationRecordRow = {
      bookNowLabel: "   ",
      bookNowHidden: false,
      items: [],
      updatedAt: SAVED_AT,
    };
    expect(resolveBookNow("LARGE", stored).label).toBe(DEFAULT_BOOK_NOW_LABEL);
  });

  it("uses the platform default with no row at all", () => {
    expect(resolveBookNow("LARGE", null)).toEqual({ label: DEFAULT_BOOK_NOW_LABEL, hidden: false });
  });
});

describe("resolveNavigation", () => {
  it("gives Small the fixed default nav even with a (hypothetical) row", () => {
    const stored: NavigationRecordRow = {
      bookNowLabel: null,
      bookNowHidden: false,
      items: [row({})],
      updatedAt: SAVED_AT,
    };
    const resolved = resolveNavigation("SMALL", stored);
    expect(resolved.isCustom).toBe(false);
    expect(resolved.items).toEqual(defaultNavigationItems());
  });

  it("gives an allowed tier with no row the fixed default nav", () => {
    const resolved = resolveNavigation("LARGE", null);
    expect(resolved.isCustom).toBe(false);
    expect(resolved.items).toEqual(defaultNavigationItems());
  });

  it("gives an allowed tier with zero saved items the fixed default nav", () => {
    const stored: NavigationRecordRow = {
      bookNowLabel: null,
      bookNowHidden: false,
      items: [],
      updatedAt: SAVED_AT,
    };
    const resolved = resolveNavigation("MEDIUM", stored);
    expect(resolved.isCustom).toBe(false);
  });

  it("renders the agency's own menu for an allowed tier with saved items", () => {
    const stored: NavigationRecordRow = {
      bookNowLabel: null,
      bookNowHidden: false,
      items: [row({ label: "Destinations", url: "/destinations" })],
      updatedAt: SAVED_AT,
    };
    const resolved = resolveNavigation("LARGE", stored);
    expect(resolved.isCustom).toBe(true);
    expect(resolved.items.map((i) => i.label)).toEqual(["Destinations"]);
  });

  it("the downgrade case: a saved custom menu stops rendering once the tier drops", () => {
    // The row is never touched by a downgrade — only what resolveNavigation
    // decides to show changes.
    const stored: NavigationRecordRow = {
      bookNowLabel: "Reserve Now",
      bookNowHidden: false,
      items: [row({ label: "Destinations", url: "/destinations" })],
      updatedAt: SAVED_AT,
    };
    const asLarge = resolveNavigation("LARGE", stored);
    const asSmall = resolveNavigation("SMALL", stored);

    expect(asLarge.isCustom).toBe(true);
    expect(asSmall.isCustom).toBe(false);
    expect(asSmall.bookNow.label).toBe(DEFAULT_BOOK_NOW_LABEL);

    // Upgrading back renders the same saved data intact.
    expect(resolveNavigation("LARGE", stored)).toEqual(asLarge);
  });
});

/* ── Tier assertions ───────────────────────────────────────────────────── */

describe("assertCustomNavigationAllowed", () => {
  it("throws 403 when a disallowed tier sends items", () => {
    const input = { items: [] } as unknown as NavigationUpdateInput;
    expect(statusOf(() => assertCustomNavigationAllowed("SMALL", input))).toBe(403);
  });

  it("does not throw when items is absent, regardless of tier", () => {
    const input = { bookNowLabel: "X" } as unknown as NavigationUpdateInput;
    expect(() => assertCustomNavigationAllowed("SMALL", input)).not.toThrow();
  });

  it("does not throw for an allowed tier sending items", () => {
    const input = { items: [] } as unknown as NavigationUpdateInput;
    expect(() => assertCustomNavigationAllowed("MEDIUM", input)).not.toThrow();
  });
});

describe("assertBookNowChangeAllowed", () => {
  it("throws 403 when a disallowed tier sets a custom label", () => {
    const input = { bookNowLabel: "Reserve Now" } as unknown as NavigationUpdateInput;
    expect(statusOf(() => assertBookNowChangeAllowed("SMALL", input))).toBe(403);
  });

  it("throws 403 when a disallowed tier tries to hide the button", () => {
    const input = { bookNowHidden: true } as unknown as NavigationUpdateInput;
    expect(statusOf(() => assertBookNowChangeAllowed("FREE", input))).toBe(403);
  });

  it("allows a disallowed tier to send the value that already matches the forced state", () => {
    // A "save the whole form" client sends every field every time.
    const input = {
      bookNowLabel: DEFAULT_BOOK_NOW_LABEL,
      bookNowHidden: false,
    } as unknown as NavigationUpdateInput;
    expect(() => assertBookNowChangeAllowed("SMALL", input)).not.toThrow();
  });

  it("allows clearing the label with null on a disallowed tier", () => {
    const input = { bookNowLabel: null } as unknown as NavigationUpdateInput;
    expect(() => assertBookNowChangeAllowed("SMALL", input)).not.toThrow();
  });

  it("allows any change at all for an allowed tier", () => {
    const input = { bookNowLabel: "Reserve Now", bookNowHidden: true } as unknown as NavigationUpdateInput;
    expect(() => assertBookNowChangeAllowed("LARGE", input)).not.toThrow();
  });
});

/* ── getNavigation (dashboard read) ───────────────────────────────────────── */

describe("getNavigation", () => {
  it("reports capabilities matching the agency's tier", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));
    navigationFindUnique.mockResolvedValue(null);

    const result = await getNavigation(AGENCY_ID);
    expect(result.capabilities).toEqual({ customNavigation: false, bookNowCustomization: false });
    expect(result.effectiveNavigation.isCustom).toBe(false);
  });

  it("still returns the raw saved menu for a downgraded tier", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));
    navigationFindUnique.mockResolvedValue({
      bookNowLabel: "Reserve Now",
      bookNowHidden: false,
      items: [row({ label: "Destinations", url: "/destinations" })],
      updatedAt: SAVED_AT,
    });

    const result = await getNavigation(AGENCY_ID);
    // The settings screen must still show what was saved...
    expect(result.items.map((i) => i.label)).toEqual(["Destinations"]);
    // ...while the live site renders the standard nav.
    expect(result.effectiveNavigation.isCustom).toBe(false);
  });
});

/* ── updateNavigation (the write) ─────────────────────────────────────────── */

describe("updateNavigation", () => {
  beforeEach(() => {
    navigationFindUnique.mockResolvedValue(null);
  });

  it("rejects an empty patch with 400", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("LARGE"));
    const status = await statusOfAsync(() => updateNavigation(AGENCY_ID, {} as NavigationUpdateInput));
    expect(status).toBe(400);
  });

  it("rejects items from a Small-tier agency with 403, before writing anything", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));
    const input = { items: [{ label: "X", linkType: "INTERNAL", url: "/x" }] } as unknown as NavigationUpdateInput;

    const status = await statusOfAsync(() => updateNavigation(AGENCY_ID, input));
    expect(status).toBe(403);
    expect(navigationUpsert).not.toHaveBeenCalled();
    expect(itemDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects a Book Now rename from a Small-tier agency with 403", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));
    const status = await statusOfAsync(() =>
      updateNavigation(AGENCY_ID, { bookNowLabel: "Reserve Now" } as unknown as NavigationUpdateInput),
    );
    expect(status).toBe(403);
    expect(navigationUpsert).not.toHaveBeenCalled();
  });

  it("saving only bookNowHidden does not touch the items table", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("LARGE"));
    navigationFindUnique.mockResolvedValue({
      bookNowLabel: null,
      bookNowHidden: false,
      items: [],
      updatedAt: SAVED_AT,
    });

    await updateNavigation(AGENCY_ID, { bookNowHidden: true } as unknown as NavigationUpdateInput);

    expect(navigationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { bookNowHidden: true } }),
    );
    expect(itemDeleteMany).not.toHaveBeenCalled();
    expect(itemCreate).not.toHaveBeenCalled();
  });

  it("replaces the whole menu: deletes existing items, then recreates top-level and children", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("LARGE"));
    navigationFindUnique.mockResolvedValue({
      bookNowLabel: null,
      bookNowHidden: false,
      items: [row({ id: "old", label: "Old" })],
      updatedAt: SAVED_AT,
    });

    const input = {
      items: [
        {
          label: "Destinations",
          linkType: "INTERNAL",
          url: "/destinations",
          children: [
            { label: "Everest", linkType: "INTERNAL", url: "/destinations/everest" },
            { label: "Annapurna", linkType: "INTERNAL", url: "/destinations/annapurna" },
          ],
        },
        { label: "About", linkType: "INTERNAL", url: "/about" },
      ],
    } as unknown as NavigationUpdateInput;

    await updateNavigation(AGENCY_ID, input);

    expect(itemDeleteMany).toHaveBeenCalledWith({ where: { navigationId: "nav-1" } });
    // Deletion happens before any recreation.
    const deleteOrder = itemDeleteMany.mock.invocationCallOrder[0]!;
    const firstCreateOrder = itemCreate.mock.invocationCallOrder[0]!;
    expect(deleteOrder).toBeLessThan(firstCreateOrder);

    // Two top-level creates (Destinations, About) + two children of Destinations.
    expect(itemCreate).toHaveBeenCalledTimes(4);

    const destinationsCall = itemCreate.mock.calls[0]![0].data;
    expect(destinationsCall).toMatchObject({ label: "Destinations", position: 0 });
    expect(destinationsCall.parentId).toBeUndefined();

    const everestCall = itemCreate.mock.calls[1]![0].data;
    expect(everestCall).toMatchObject({ label: "Everest", position: 0, parentId: "created-1" });

    const aboutCall = itemCreate.mock.calls[3]![0].data;
    expect(aboutCall).toMatchObject({ label: "About", position: 1 });
  });

  it("an allowed tier may clear its entire menu by sending an empty items array", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("LARGE"));
    navigationFindUnique.mockResolvedValue({
      bookNowLabel: null,
      bookNowHidden: false,
      items: [row({})],
      updatedAt: SAVED_AT,
    });

    await updateNavigation(AGENCY_ID, { items: [] } as unknown as NavigationUpdateInput);

    expect(itemDeleteMany).toHaveBeenCalledTimes(1);
    expect(itemCreate).not.toHaveBeenCalled();
  });
});

/* ── getPublicNavigationBySlug ─────────────────────────────────────────── */

describe("getPublicNavigationBySlug", () => {
  it("404s an unknown slug", async () => {
    agencyFindUnique.mockResolvedValue(null);
    const status = await statusOfAsync(() => getPublicNavigationBySlug("nope"));
    expect(status).toBe(404);
  });

  it.each(["SUSPENDED", "LOCKED"])("404s a %s agency rather than exposing 403", async (status) => {
    agencyFindUnique.mockResolvedValue({ ...agencyOnTier("LARGE"), status });
    const code = await statusOfAsync(() => getPublicNavigationBySlug("himalayan-trails"));
    expect(code).toBe(404);
  });

  it("resolves the fixed nav for a Small-tier agency", async () => {
    agencyFindUnique.mockResolvedValue({ ...agencyOnTier("SMALL"), navigation: null });
    const result = await getPublicNavigationBySlug("himalayan-trails");
    expect(result.isCustom).toBe(false);
    expect(result.agencySlug).toBe("himalayan-trails");
  });

  it("resolves the agency's own menu for a Large-tier agency with saved items", async () => {
    agencyFindUnique.mockResolvedValue({
      ...agencyOnTier("LARGE"),
      navigation: {
        bookNowLabel: "Reserve Now",
        bookNowHidden: false,
        updatedAt: SAVED_AT,
        items: [row({ label: "Destinations", url: "/destinations" })],
      },
    });

    const result = await getPublicNavigationBySlug("himalayan-trails");
    expect(result.isCustom).toBe(true);
    expect(result.bookNow.label).toBe("Reserve Now");
  });
});

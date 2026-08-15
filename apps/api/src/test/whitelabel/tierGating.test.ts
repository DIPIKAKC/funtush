import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ── Tier gating across the white-label feature set (White-label week · Day 5) ─
 *
 * Days 1–4 each shipped their own unit tests, and each of those files proves its
 * own day's rule in isolation: `branding.service.test.ts` knows about the colour
 * rule, `navigation.service.test.ts` knows about the menu rule, and neither
 * knows the other exists.
 *
 * This file asks the question none of them can, because it is a question *about*
 * them collectively:
 *
 *   > For each of the four tiers a real agency can be on, which white-label
 *   > controls may it actually use — and does the API tell the truth about that
 *   > before the agency clicks Save?
 *
 * Three properties are pinned here, and each one catches a different bug:
 *
 *   1. **The complete matrix.** Every gate is exercised for all four tier names,
 *      including the two that are usually assumed rather than tested (`FREE`
 *      behaves like `SMALL`; `MEDIUM` behaves like `LARGE`). A rule written as
 *      `tier !== "LARGE"` passes a two-tier test and fails three real customers.
 *
 *   2. **Advertised capability == enforced capability.** Every settings screen
 *      asks the API "what may I do?" (`capabilities`, `colorPickerMode`) and
 *      disables its controls accordingly. If that answer ever disagrees with what
 *      the write path enforces, the agency sees an enabled control that 403s, or
 *      a greyed-out control for something it is paying for. Section 5 drives both
 *      halves for all four tiers and compares them.
 *
 *   3. **What is deliberately *not* gated.** The font picker has no tier rule at
 *      all — see section 3. Asserting the absence of a gate is not padding: it is
 *      the only thing that turns "we chose not to gate fonts" into a decision a
 *      future change has to argue with, rather than something someone quietly
 *      adds on a Tuesday.
 *
 * ── How this file talks to the database ──────────────────────────────────────
 *
 * It does not. `@funtush/database` is replaced with spies, so "an agency on the
 * Small tier" is one line (`agencyFindUnique.mockResolvedValue(...)`) rather than
 * a seeded Postgres row. Tier rules are pure policy — they read a string and
 * either throw or do not — so a real database would add minutes of setup and
 * prove nothing extra.
 *
 * The regeneration hook is stubbed for the same reason: Day 4's pipeline has its
 * own suites, and a tier test that also fired background HTTP calls would be
 * slower and flakier for no gain.
 */

/* ── Test doubles ────────────────────────────────────────────────────────── */

const agencyFindUnique = vi.fn();
const brandingFindUnique = vi.fn();
const brandingUpsert = vi.fn();
const siteConfigFindUnique = vi.fn();
const siteConfigUpsert = vi.fn();
const navigationFindUnique = vi.fn();
const navigationUpsert = vi.fn();
const itemDeleteMany = vi.fn();
const itemCreate = vi.fn();

vi.mock("@funtush/database", () => ({
  db: {
    agency: { findUnique: (...a: unknown[]) => agencyFindUnique(...a) },
    agencyBranding: {
      findUnique: (...a: unknown[]) => brandingFindUnique(...a),
      upsert: (...a: unknown[]) => brandingUpsert(...a),
    },
    agencySiteConfig: {
      findUnique: (...a: unknown[]) => siteConfigFindUnique(...a),
      upsert: (...a: unknown[]) => siteConfigUpsert(...a),
    },
    agencyNavigation: {
      findUnique: (...a: unknown[]) => navigationFindUnique(...a),
      upsert: (...a: unknown[]) => navigationUpsert(...a),
    },
    agencyNavigationItem: {
      deleteMany: (...a: unknown[]) => itemDeleteMany(...a),
      create: (...a: unknown[]) => itemCreate(...a),
    },
    // The navigation write runs inside a transaction. The fake hands the
    // callback a `tx` with the same two models on it, so the code under test
    // takes its real path rather than a special "in a test" path.
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

/** Importing the branding service pulls in the storage client; stub it away. */
vi.mock("@funtush/storage", () => ({
  uploadFile: vi.fn(async () => "https://cdn.funtush.com/uploads/x.png"),
  deleteFile: vi.fn(async () => undefined),
}));

/** Day 4's hook. Whether it fires is `regenerationTriggers.test.ts`'s subject. */
vi.mock("../../services/regeneration.service", () => ({
  queueRegeneration: vi.fn(() => ({ id: "receipt-1", status: "queued" })),
}));

import {
  BRAND_FONTS,
  BRAND_PALETTE,
  allowsFreeColorPicker,
  type TierName,
} from "../../data/brandTheme";
import {
  DEFAULT_BOOK_NOW_LABEL,
  DEFAULT_NAVIGATION_ITEMS,
  allowsBookNowCustomization,
  allowsCustomNavigation,
} from "../../data/navigation";
import { allowsPopupModal } from "../../data/siteConfig";
import {
  getBrandingOptions,
  resolveColorForTier,
  updateAgencyBranding,
} from "../../services/branding.service";
import {
  getNavigation,
  getNavigationOptions,
  resolveNavigation,
  updateNavigation,
} from "../../services/navigation.service";
import {
  assertTopBarColorAllowed,
  getSiteConfig,
  updateSiteConfig,
} from "../../services/siteConfig.service";
import { brandingUpdateSchema } from "../../validations/branding.validation";

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const AGENCY_ID = "agency-1";
const SLUG = "himalayan-trails";
const SAVED_AT = new Date("2026-08-14T09:30:00.000Z");

/**
 * Every tier a live agency can be on.
 *
 * `FREE` is the row the 30-day trial sits on (Backend Guide §0.1 — it is a
 * *trial*, not a free tier). It is listed first because it is the one most
 * likely to be forgotten in a hand-written test, and the one every agency starts
 * on.
 */
const ALL_TIERS: readonly TierName[] = ["FREE", "SMALL", "MEDIUM", "LARGE"];

/** A hex that is deliberately not in `BRAND_PALETTE` — the free-picker probe. */
const OFF_PALETTE_HEX = "#123456";

/** A hex that *is* a curated swatch, so every tier is allowed to choose it. */
const CURATED_HEX = BRAND_PALETTE[0]!.hex;

function agencyOnTier(tier: string) {
  return {
    id: AGENCY_ID,
    name: "Himalayan Trails",
    slug: SLUG,
    status: "ACTIVE",
    customDomain: null,
    tier: { name: tier },
  };
}

/** Point every read at an agency sitting on `tier`. */
function onTier(tier: string): void {
  agencyFindUnique.mockResolvedValue(agencyOnTier(tier));
}

/**
 * Run an async call and report only whether it was *allowed*.
 *
 * The capability matrix cares about one bit — did the platform let this tier do
 * this? — so collapsing "resolved" to `true` and "threw a 403" to `false` is what
 * makes the matrix readable. A non-403 error is re-thrown rather than swallowed,
 * because a 400 or a 500 arriving here means the probe itself is wrong and
 * silently reading it as "denied" would turn a broken test into a passing one.
 */
async function isAllowed(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 403) return false;
    throw err;
  }
}

/** The status code a thrown `httpError` carries, or `undefined` if it resolved. */
async function statusOf(run: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await run();
    return undefined;
  } catch (err) {
    return (err as { status?: number }).status;
  }
}

beforeEach(() => {
  vi.clearAllMocks();

  onTier("MEDIUM");

  brandingFindUnique.mockResolvedValue(null);
  brandingUpsert.mockResolvedValue({
    brandName: "Himalayan Trails",
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
  });

  siteConfigFindUnique.mockResolvedValue({ updatedAt: SAVED_AT });
  siteConfigUpsert.mockResolvedValue({});

  navigationFindUnique.mockResolvedValue({
    bookNowLabel: null,
    bookNowHidden: false,
    items: [],
    updatedAt: SAVED_AT,
  });
  navigationUpsert.mockResolvedValue({ id: "nav-1" });
  itemDeleteMany.mockResolvedValue({ count: 0 });
  itemCreate.mockResolvedValue({ id: "item-1" });
});

/* ── 1. The colour picker ────────────────────────────────────────────────── */

describe("colour picker — the tier gate", () => {
  /**
   * The rule in one table, so the four rows can be read side by side rather than
   * inferred from four separate `it` blocks. `free` means "may type any hex";
   * `curated` means "must choose one of the twelve swatches".
   */
  const EXPECTED_MODE: Record<TierName, "curated" | "free"> = {
    FREE: "curated",
    SMALL: "curated",
    MEDIUM: "free",
    LARGE: "free",
  };

  it("gives exactly Medium and Large the free hex picker", () => {
    for (const tier of ALL_TIERS) {
      expect(allowsFreeColorPicker(tier), tier).toBe(EXPECTED_MODE[tier] === "free");
    }
  });

  it("refuses an off-palette hex on the curated tiers and accepts it on the free ones", async () => {
    for (const tier of ALL_TIERS) {
      onTier(tier);

      const allowed = await isAllowed(() =>
        updateAgencyBranding(AGENCY_ID, { primaryColor: OFF_PALETTE_HEX }),
      );

      expect(allowed, `${tier} + off-palette hex`).toBe(EXPECTED_MODE[tier] === "free");
    }
  });

  it("lets every tier — including the trial — choose any of the twelve curated swatches", async () => {
    // The curated palette is not a *reduced* palette that costs money to escape;
    // it is the whole palette, available to everybody, and the paid tiers merely
    // gain the right to ignore it. A gate that accidentally blocked a swatch for
    // Small would make the trial site unbrandable, which is the opposite of the
    // product's intent (Backend Guide §0.1: the trial gets the full Small set).
    for (const tier of ALL_TIERS) {
      for (const swatch of BRAND_PALETTE) {
        const resolved = resolveColorForTier(tier, { paletteId: swatch.id });
        expect(resolved, `${tier} + ${swatch.id}`).toEqual({
          primaryColor: swatch.hex,
          paletteId: swatch.id,
        });
      }
    }
  });

  it("accepts a curated hex typed by hand on every tier, swatch id included", () => {
    // An agency on Small that types the exact hex of a swatch instead of clicking
    // it is doing something legal. Rejecting that would be a rule about *how* the
    // colour was chosen rather than *which* colour it is.
    for (const tier of ALL_TIERS) {
      const resolved = resolveColorForTier(tier, { primaryColor: CURATED_HEX });
      expect(resolved?.primaryColor, tier).toBe(CURATED_HEX);
      expect(resolved?.paletteId, tier).toBe(BRAND_PALETTE[0]!.id);
    }
  });

  it("refuses with 403, never 400 — this is a plan limit, not a typo", async () => {
    // The distinction is the whole user experience of a paywall. 400 invites the
    // agency to try a different spelling of the same colour; 403 tells it the
    // truth and points at the upgrade page.
    for (const tier of ["FREE", "SMALL"] as const) {
      onTier(tier);
      expect(
        await statusOf(() => updateAgencyBranding(AGENCY_ID, { primaryColor: OFF_PALETTE_HEX })),
        tier,
      ).toBe(403);
    }
  });

  it("closes the smuggling hole: a paletteId alongside a custom hex uses the swatch", () => {
    // Without this precedence rule a Small-tier client could send
    // `{ paletteId: "teal", primaryColor: "#FF0000" }` and hope the server
    // believed the second field because the first one looked legitimate.
    for (const tier of ALL_TIERS) {
      const resolved = resolveColorForTier(tier, {
        paletteId: "teal",
        primaryColor: OFF_PALETTE_HEX,
      });
      expect(resolved?.primaryColor, tier).toBe(BRAND_PALETTE[0]!.hex);
    }
  });

  it("never reaches the database when the colour is refused", async () => {
    // The 403 has to happen before the write for a reason beyond tidiness: the
    // same ordering is what keeps a refused save from uploading a file and from
    // purging a CDN cache (Day 4). Asserting it here pins the cheapest, most
    // visible consequence.
    onTier("SMALL");
    await statusOf(() => updateAgencyBranding(AGENCY_ID, { primaryColor: OFF_PALETTE_HEX }));

    expect(brandingUpsert).not.toHaveBeenCalled();
  });
});

/* ── 2. The top bar colour reuses the same policy ────────────────────────── */

describe("colour picker — the top bar uses the same gate, not a copy of it", () => {
  it("agrees with the branding gate on every tier", () => {
    // Day 2's top-bar colour calls Day 1's `allowsFreeColorPicker` rather than
    // re-listing the tiers. This test is what makes that reuse observable: if
    // someone ever pastes the tier list into `siteConfig.service.ts`, the two
    // gates can drift, and the first person to notice would be an agency whose
    // brand colour is free-picked but whose top bar is not.
    // Both gates refuse by *throwing*, so both probes have to catch. Written as
    // one helper rather than two try/catch blocks so the two sides cannot be
    // compared under different rules by accident.
    const permits = (attempt: () => unknown): boolean => {
      try {
        attempt();
        return true;
      } catch {
        return false;
      }
    };

    for (const tier of ALL_TIERS) {
      const brandingAllows = permits(() =>
        resolveColorForTier(tier, { primaryColor: OFF_PALETTE_HEX }),
      );
      const topBarAllows = permits(() =>
        assertTopBarColorAllowed(tier, { topBarBackgroundColor: OFF_PALETTE_HEX }),
      );

      expect(topBarAllows, tier).toBe(brandingAllows);
      // And they agree with the policy both of them delegate to, so a matching
      // pair of *wrong* answers still fails.
      expect(topBarAllows, tier).toBe(allowsFreeColorPicker(tier));
    }
  });

  it("lets any tier clear the override, because going back is never a paid feature", () => {
    for (const tier of ALL_TIERS) {
      expect(() => assertTopBarColorAllowed(tier, { topBarBackgroundColor: null })).not.toThrow();
      expect(() => assertTopBarColorAllowed(tier, {})).not.toThrow();
    }
  });
});

/* ── 3. The font picker — deliberately ungated ───────────────────────────── */

describe("font picker — no tier gate, by design", () => {
  /**
   * This section documents an absence, so it is worth stating the decision it is
   * documenting rather than leaving a reader to infer it from passing tests.
   *
   * **The six fonts are available on every tier, including the trial.** The font
   * picker is gated by a *whitelist*, not by a *plan*: an agency may choose any
   * `id` in `BRAND_FONTS` and nothing else, whoever it is. Two reasons:
   *
   *   - Typography is legibility before it is decoration. A site that cannot pick
   *     a readable font is not a cheaper site, it is a worse one, and the trial
   *     exists to show the product at its best.
   *   - The whitelist is a security boundary, not a price boundary (see
   *     `BrandFont.stack` in `data/brandTheme.ts`): the agency stores an *id* and
   *     the server looks up the CSS `font-family` string. That protection has to
   *     apply to a Large-tier agency exactly as strictly as to a trial one —
   *     which is the last test in this block.
   *
   * If the platform ever decides fonts should be a paid feature, these tests fail
   * loudly and force the decision to be made on purpose.
   */
  it("lets all four tiers choose all six fonts", async () => {
    for (const tier of ALL_TIERS) {
      onTier(tier);

      for (const font of BRAND_FONTS) {
        const allowed = await isAllowed(() =>
          updateAgencyBranding(AGENCY_ID, { fontFamily: font.id }),
        );
        expect(allowed, `${tier} + ${font.id}`).toBe(true);
      }
    }
  });

  it("offers the identical font list to every tier", async () => {
    const listPerTier: string[][] = [];

    for (const tier of ALL_TIERS) {
      onTier(tier);
      const options = await getBrandingOptions(AGENCY_ID);
      listPerTier.push(options.fonts.map((font) => font.id));
    }

    // Every tier's list is the same list, and it is the whole whitelist.
    const expected = BRAND_FONTS.map((font) => font.id);
    for (const [index, list] of listPerTier.entries()) {
      expect(list, ALL_TIERS[index]).toEqual(expected);
    }
  });

  it("never lets any tier — including Large — supply a raw font-family string", () => {
    // The payload below is the reason the indirection exists at all: a stored
    // `font-family` is emitted into a `<style>` block, so a raw string could
    // close the rule and append CSS of its own. A paid plan does not buy that.
    const injection = "Arial; } body { display:none } .x {";

    for (const candidate of [injection, "Comic Sans MS", "'Inter'", ""]) {
      const result = brandingUpdateSchema.safeParse({ fontFamily: candidate });
      expect(result.success, candidate).toBe(false);
    }

    // …and the whitelist still admits a legitimate id, so the check above is
    // rejecting the payload rather than rejecting everything.
    expect(brandingUpdateSchema.safeParse({ fontFamily: "inter" }).success).toBe(true);
  });
});

/* ── 4. The navigation builder ───────────────────────────────────────────── */

describe("navigation builder — the tier gate", () => {
  const EXPECTED_CUSTOM_NAV: Record<TierName, boolean> = {
    FREE: false,
    SMALL: false,
    MEDIUM: true,
    LARGE: true,
  };

  const SAMPLE_MENU = [{ label: "Treks", linkType: "INTERNAL", url: "/packages" }];

  it("gives exactly Medium and Large the menu builder", () => {
    for (const tier of ALL_TIERS) {
      expect(allowsCustomNavigation(tier), tier).toBe(EXPECTED_CUSTOM_NAV[tier]);
      // Today the Book Now gate matches the menu gate. They are separate
      // constants so that the day one moves, the other does not follow it by
      // accident — but while they agree, that agreement is worth asserting.
      expect(allowsBookNowCustomization(tier), tier).toBe(EXPECTED_CUSTOM_NAV[tier]);
    }
  });

  it("refuses a menu save from the locked tiers and accepts it from the others", async () => {
    for (const tier of ALL_TIERS) {
      onTier(tier);

      const allowed = await isAllowed(() => updateNavigation(AGENCY_ID, { items: SAMPLE_MENU }));

      expect(allowed, `${tier} + custom menu`).toBe(EXPECTED_CUSTOM_NAV[tier]);
    }
  });

  it("writes nothing to the items table when the menu is refused", async () => {
    // A 403 that still deleted the stored rows would be the worst possible
    // outcome: the agency is told "no" *and* loses the menu it already had.
    for (const tier of ["FREE", "SMALL"] as const) {
      vi.clearAllMocks();
      onTier(tier);

      await statusOf(() => updateNavigation(AGENCY_ID, { items: SAMPLE_MENU }));

      expect(itemDeleteMany, tier).not.toHaveBeenCalled();
      expect(itemCreate, tier).not.toHaveBeenCalled();
      expect(navigationUpsert, tier).not.toHaveBeenCalled();
    }
  });

  it("renders the platform's fixed navigation for the locked tiers, whatever is stored", () => {
    // The read path re-checks the tier, so a Medium agency that built a menu and
    // then downgraded stops rendering it immediately — with no cleanup job, and
    // with the menu preserved for an upgrade. This is the property a write-only
    // check misses silently for months.
    const storedMenu = {
      bookNowLabel: "Reserve Now",
      bookNowHidden: true,
      items: [
        {
          id: "i1",
          parentId: null,
          label: "Custom",
          linkType: "INTERNAL" as const,
          url: "/custom",
          openInNewTab: false,
          position: 0,
        },
      ],
      updatedAt: SAVED_AT,
    };

    for (const tier of ALL_TIERS) {
      const resolved = resolveNavigation(tier, storedMenu);

      if (EXPECTED_CUSTOM_NAV[tier]) {
        expect(resolved.isCustom, tier).toBe(true);
        expect(resolved.items.map((i) => i.label), tier).toEqual(["Custom"]);
        expect(resolved.bookNow, tier).toEqual({ label: "Reserve Now", hidden: true });
      } else {
        expect(resolved.isCustom, tier).toBe(false);
        expect(resolved.items.map((i) => i.label), tier).toEqual(
          DEFAULT_NAVIGATION_ITEMS.map((i) => i.label),
        );
        // The button reverts too — and specifically it reverts to *visible*, so a
        // downgrade can never leave a site with no way to book.
        expect(resolved.bookNow, tier).toEqual({
          label: DEFAULT_BOOK_NOW_LABEL,
          hidden: false,
        });
      }
    }
  });

  it("keeps the stored menu visible in the dashboard after a downgrade", async () => {
    // Rendering the fixed nav is correct; *deleting* the agency's work would not
    // be. The settings screen still shows what was built, so an upgrade restores
    // it with one click rather than an afternoon of retyping.
    onTier("SMALL");
    navigationFindUnique.mockResolvedValue({
      bookNowLabel: "Reserve Now",
      bookNowHidden: true,
      items: [
        {
          id: "i1",
          parentId: null,
          label: "Custom",
          linkType: "INTERNAL",
          url: "/custom",
          openInNewTab: false,
          position: 0,
        },
      ],
      updatedAt: SAVED_AT,
    });

    const view = await getNavigation(AGENCY_ID);

    expect(view.items.map((i) => i.label)).toEqual(["Custom"]);
    expect(view.bookNowLabel).toBe("Reserve Now");
    expect(view.capabilities.customNavigation).toBe(false);
    expect(view.effectiveNavigation.isCustom).toBe(false);
  });

  it("refuses a Book Now rename on the locked tiers but accepts the forced value", async () => {
    for (const tier of ALL_TIERS) {
      onTier(tier);

      const renamed = await isAllowed(() =>
        updateNavigation(AGENCY_ID, { bookNowLabel: "Reserve Now" }),
      );
      expect(renamed, `${tier} + rename`).toBe(EXPECTED_CUSTOM_NAV[tier]);

      const hidden = await isAllowed(() => updateNavigation(AGENCY_ID, { bookNowHidden: true }));
      expect(hidden, `${tier} + hide`).toBe(EXPECTED_CUSTOM_NAV[tier]);

      // Re-sending the value that is already forced is allowed on every tier —
      // a "save the whole form" client sends every field every time and must not
      // be punished for it.
      const resubmitted = await isAllowed(() =>
        updateNavigation(AGENCY_ID, {
          bookNowLabel: DEFAULT_BOOK_NOW_LABEL,
          bookNowHidden: false,
        }),
      );
      expect(resubmitted, `${tier} + resubmitting the default`).toBe(true);
    }
  });
});

/* ── 5. Advertised capability == enforced capability ─────────────────────── */

describe("what the API advertises matches what it enforces", () => {
  /**
   * The bug this catches is quiet and expensive. The settings screen never
   * guesses which controls to enable — it asks the API. If the *answer* and the
   * *enforcement* are computed by two different expressions, they can disagree,
   * and the agency meets that disagreement as either a control that fails when
   * clicked, or a feature it is paying for that appears switched off.
   *
   * Each probe below drives both halves for one tier and compares them. The
   * probes are written to be legal in every other respect, so the only thing that
   * can make one fail is the tier rule itself.
   */
  const PROBES = [
    {
      name: "free colour picker",
      advertised: async () => (await getBrandingOptions(AGENCY_ID)).colorPickerMode === "free",
      enforced: () => updateAgencyBranding(AGENCY_ID, { primaryColor: OFF_PALETTE_HEX }),
    },
    {
      name: "custom navigation",
      advertised: async () =>
        (await getNavigationOptions(AGENCY_ID)).capabilities.customNavigation,
      enforced: () =>
        updateNavigation(AGENCY_ID, {
          items: [{ label: "Treks", linkType: "INTERNAL", url: "/packages" }],
        }),
    },
    {
      name: "Book Now customization",
      advertised: async () =>
        (await getNavigationOptions(AGENCY_ID)).capabilities.bookNowCustomization,
      enforced: () => updateNavigation(AGENCY_ID, { bookNowLabel: "Reserve Now" }),
    },
    {
      name: "popup modal",
      advertised: async () => (await getSiteConfig(AGENCY_ID)).capabilities.popupModal,
      // A *coherent* popup, so the only thing that can refuse it is the tier
      // rule — an incomplete one would 400 on the allowed tiers and make this
      // probe measure the wrong thing.
      enforced: () =>
        updateSiteConfig(AGENCY_ID, {
          popupEnabled: true,
          popupTitle: "Autumn offer",
          popupBody: "10% off every Annapurna departure in October.",
        }),
    },
    {
      name: "free top-bar colour",
      advertised: async () =>
        (await getSiteConfig(AGENCY_ID)).capabilities.topBarColorMode === "free",
      enforced: () => updateSiteConfig(AGENCY_ID, { topBarBackgroundColor: OFF_PALETTE_HEX }),
    },
  ] as const;

  for (const probe of PROBES) {
    it(`agrees on "${probe.name}" for all four tiers`, async () => {
      for (const tier of ALL_TIERS) {
        onTier(tier);

        const advertised = await probe.advertised();
        const enforced = await isAllowed(probe.enforced);

        expect(enforced, `${tier} — ${probe.name}`).toBe(advertised);
      }
    });
  }

  it("the whole matrix, written out — a change to any tier rule shows up here", async () => {
    /**
     * A snapshot of the platform's gating in one readable block. It duplicates
     * the probes above on purpose: those prove the two halves *agree*, this one
     * proves they agree on the *right answer*. A rule inverted in both places at
     * once would pass every test above and fail this one.
     */
    const matrix: Record<string, Record<string, boolean>> = {};

    for (const tier of ALL_TIERS) {
      onTier(tier);
      const branding = await getBrandingOptions(AGENCY_ID);
      const navigation = await getNavigationOptions(AGENCY_ID);
      const config = await getSiteConfig(AGENCY_ID);

      matrix[tier] = {
        freeColorPicker: branding.colorPickerMode === "free",
        customNavigation: navigation.capabilities.customNavigation,
        bookNowCustomization: navigation.capabilities.bookNowCustomization,
        popupModal: config.capabilities.popupModal,
        freeTopBarColor: config.capabilities.topBarColorMode === "free",
        // Fonts are ungated — see section 3. Included so the matrix is the whole
        // picture rather than only the parts that happen to be gated.
        fontPicker: branding.fonts.length === BRAND_FONTS.length,
      };
    }

    expect(matrix).toEqual({
      FREE: {
        freeColorPicker: false,
        customNavigation: false,
        bookNowCustomization: false,
        popupModal: false,
        freeTopBarColor: false,
        fontPicker: true,
      },
      SMALL: {
        freeColorPicker: false,
        customNavigation: false,
        bookNowCustomization: false,
        popupModal: false,
        freeTopBarColor: false,
        fontPicker: true,
      },
      MEDIUM: {
        freeColorPicker: true,
        customNavigation: true,
        bookNowCustomization: true,
        popupModal: true,
        freeTopBarColor: true,
        fontPicker: true,
      },
      LARGE: {
        freeColorPicker: true,
        customNavigation: true,
        bookNowCustomization: true,
        popupModal: true,
        freeTopBarColor: true,
        fontPicker: true,
      },
    });
  });

  it("the trial is treated as Small everywhere, not as a fourth set of rules", () => {
    // Backend Guide §0.1: the 30-day trial gets the full Small feature set. One
    // assertion per gate, so a future rule that special-cases `FREE` has to
    // change this line and explain itself.
    for (const gate of [allowsFreeColorPicker, allowsCustomNavigation, allowsBookNowCustomization, allowsPopupModal]) {
      expect(gate("FREE"), gate.name).toBe(gate("SMALL"));
    }
  });

  it("an unrecognised tier name is treated as the most restricted tier", () => {
    // Defence in depth for a corrupt or renamed tier row: every gate is a
    // whitelist membership test, so an unknown string falls out as "not allowed"
    // rather than "allowed". The failure mode of a bad deploy is then a
    // temporarily under-featured site, never a leaked paid feature.
    for (const gate of [allowsFreeColorPicker, allowsCustomNavigation, allowsBookNowCustomization, allowsPopupModal]) {
      expect(gate("PLATINUM"), gate.name).toBe(false);
      expect(gate(""), gate.name).toBe(false);
      expect(gate("large"), gate.name).toBe(false); // case-sensitive, like the seed
    }
  });
});

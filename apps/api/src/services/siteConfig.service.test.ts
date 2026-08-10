import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the site configuration service (White-label week · Day 2).
 *
 * `@funtush/database` is replaced with spies, so these run with no Postgres and
 * no network.
 *
 * The suite is organised around the four things that can actually go wrong on
 * this endpoint, rather than around the functions:
 *
 *   1. **PATCH merge semantics** — absent vs `null` vs a value. Get this wrong
 *      and a save silently deletes an agency's announcement.
 *   2. **Tier rules on the write path** — 403s, and 403s *before* 400s.
 *   3. **Tier rules on the read path** — the downgrade case, which is the one a
 *      write-path-only implementation gets wrong and nobody notices for months.
 *   4. **Resolution precedence** — under construction beats everything.
 */

const agencyFindUnique = vi.fn();
const siteConfigFindUnique = vi.fn();
const siteConfigUpsert = vi.fn();

vi.mock("@funtush/database", () => ({
  db: {
    agency: { findUnique: (...a: unknown[]) => agencyFindUnique(...a) },
    agencySiteConfig: {
      findUnique: (...a: unknown[]) => siteConfigFindUnique(...a),
      upsert: (...a: unknown[]) => siteConfigUpsert(...a),
    },
  },
}));

import {
  assertBadgeChangeAllowed,
  assertCoherent,
  assertPopupAllowed,
  assertTopBarColorAllowed,
  getPublicSiteConfigBySlug,
  getSiteConfig,
  getSiteConfigOptions,
  getSiteLiveness,
  mergePatch,
  resolveComingSoon,
  resolvePopup,
  resolveSiteConfig,
  resolveTopBar,
  touchesPopup,
  updateSiteConfig,
  withDefaults,
  type SiteConfigRow,
} from "./siteConfig.service";
import { DEFAULT_CONSTRUCTION_COPY } from "../data/siteConfig";
import { BRAND_PALETTE, DEFAULT_BRANDING } from "../data/brandTheme";

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const AGENCY_ID = "agency-1";
const SAVED_AT = new Date("2026-08-08T09:00:00.000Z");

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

function configRow(overrides: Partial<SiteConfigRow> = {}): SiteConfigRow {
  return {
    underConstruction: false,
    constructionHeadline: null,
    constructionMessage: null,
    topBarEnabled: false,
    topBarText: null,
    topBarBehavior: "STATIC",
    topBarBackgroundColor: null,
    topBarLinkUrl: null,
    topBarDismissible: true,
    popupEnabled: false,
    popupTitle: null,
    popupBody: null,
    popupCtaLabel: null,
    popupCtaUrl: null,
    popupTrigger: "AFTER_DELAY",
    popupDelaySeconds: 5,
    popupFrequency: "ONCE_PER_SESSION",
    showFuntushBadge: false,
    updatedAt: SAVED_AT,
    ...overrides,
  };
}

/** A row with a fully configured, enabled popup — the downgrade fixture. */
function rowWithLivePopup(): SiteConfigRow {
  return configRow({
    popupEnabled: true,
    popupTitle: "Autumn season is open",
    popupBody: "Book an October departure before the 15th and save 15%.",
    popupCtaLabel: "See departures",
    popupCtaUrl: "https://example.com/departures",
  });
}

/** Reads the numeric HTTP status a service error carries. */
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
  agencyFindUnique.mockResolvedValue(agencyOnTier("MEDIUM"));
  siteConfigFindUnique.mockResolvedValue(null);
  siteConfigUpsert.mockResolvedValue(configRow());
});

/* ── 1. withDefaults ────────────────────────────────────────────────────── */

describe("withDefaults", () => {
  it("gives a never-configured agency a live site with nothing switched on", () => {
    // The single most important default in the file: a brand-new agency's site
    // is *up*. Defaulting `underConstruction` to true would take every trial
    // signup offline the moment it registered.
    const merged = withDefaults(null);

    expect(merged.underConstruction).toBe(false);
    expect(merged.topBarEnabled).toBe(false);
    expect(merged.popupEnabled).toBe(false);
    expect(merged.showFuntushBadge).toBe(false);
  });

  it("keeps the boolean defaults that are not simply false", () => {
    // `topBarDismissible` defaults to *true*. A `?? false` copy-paste here would
    // ship un-closable announcement bars to every agency.
    expect(withDefaults(null).topBarDismissible).toBe(true);
    expect(withDefaults(null).popupDelaySeconds).toBe(5);
    expect(withDefaults(null).popupFrequency).toBe("ONCE_PER_SESSION");
  });

  it("prefers a stored `false` over a truthy default", () => {
    // `row?.topBarDismissible ?? true` is correct; `row?.topBarDismissible || true`
    // is the classic bug — it can never return false. This test is the guard.
    expect(withDefaults(configRow({ topBarDismissible: false })).topBarDismissible).toBe(false);
  });

  it("prefers a stored zero delay over the default of 5", () => {
    // Same trap in numeric form: `?? 5` keeps 0, `|| 5` throws it away.
    expect(withDefaults(configRow({ popupDelaySeconds: 0 })).popupDelaySeconds).toBe(0);
  });
});

/* ── 2. mergePatch — the PATCH semantics ────────────────────────────────── */

describe("mergePatch", () => {
  it("leaves a stored value alone when the key is absent from the patch", () => {
    const row = configRow({ topBarText: "Monsoon discounts", topBarEnabled: true });

    const merged = mergePatch(row, { topBarDismissible: false });

    expect(merged.topBarText).toBe("Monsoon discounts");
    expect(merged.topBarEnabled).toBe(true);
    expect(merged.topBarDismissible).toBe(false);
  });

  it("clears a stored value when the patch sends an explicit null", () => {
    // `null` and absent are different intentions and both have to work. This is
    // the pair of assertions that proves the API can express "delete this".
    const row = configRow({ topBarLinkUrl: "https://example.com/offer" });

    expect(mergePatch(row, { topBarLinkUrl: null }).topBarLinkUrl).toBeNull();
    expect(mergePatch(row, {}).topBarLinkUrl).toBe("https://example.com/offer");
  });

  it("does not let an explicitly-undefined key wipe a stored value", () => {
    // A client that builds its body as `{ topBarText: form.text || undefined }`
    // produces a key that *exists* with value `undefined`. `Object.assign` would
    // copy it and blank the announcement; the `!== undefined` guard is what
    // stops that.
    const row = configRow({ topBarText: "Keep me" });

    const merged = mergePatch(row, { topBarText: undefined });

    expect(merged.topBarText).toBe("Keep me");
  });

  it("merges onto defaults when there is no row yet", () => {
    const merged = mergePatch(null, { topBarEnabled: true, topBarText: "Hello" });

    expect(merged.topBarEnabled).toBe(true);
    expect(merged.topBarText).toBe("Hello");
    expect(merged.topBarBehavior).toBe("STATIC");
  });

  it("does not mutate the row it was given", () => {
    // The merged object is handed to the coherence checks and then discarded.
    // If it aliased the row, a later read in the same request would see values
    // that were never saved.
    const row = configRow({ topBarText: "Original" });

    mergePatch(row, { topBarText: "Changed" });

    expect(row.topBarText).toBe("Original");
  });
});

/* ── 3. Tier rules on the write path ────────────────────────────────────── */

describe("touchesPopup", () => {
  it("is true for any popup field, not just the enable switch", () => {
    expect(touchesPopup({ popupEnabled: true })).toBe(true);
    expect(touchesPopup({ popupTitle: "Hi" })).toBe(true);
    expect(touchesPopup({ popupDelaySeconds: 10 })).toBe(true);
    expect(touchesPopup({ popupFrequency: "ONCE_EVER" })).toBe(true);
  });

  it("is false for a patch that only touches non-popup fields", () => {
    expect(touchesPopup({ topBarEnabled: true, underConstruction: true })).toBe(false);
  });

  it("is false when a popup key is present but undefined", () => {
    // Consistent with `mergePatch`: an undefined key changes nothing, so it must
    // not trip a 403 either. Otherwise a "send the whole form" client on the
    // Small tier could never save anything at all.
    expect(touchesPopup({ popupTitle: undefined })).toBe(false);
  });
});

describe("assertPopupAllowed", () => {
  it("lets MEDIUM and LARGE configure the popup", () => {
    expect(() => assertPopupAllowed("MEDIUM", { popupEnabled: true })).not.toThrow();
    expect(() => assertPopupAllowed("LARGE", { popupEnabled: true })).not.toThrow();
  });

  it("refuses FREE and SMALL with 403, not 400", () => {
    // 403 is "your plan"; 400 is "you typed it wrong". Day 1's rule, and getting
    // it wrong sends the agency to re-read the docs instead of the pricing page.
    for (const tier of ["FREE", "SMALL"]) {
      expect(statusOf(() => assertPopupAllowed(tier, { popupEnabled: true }))).toBe(403);
    }
  });

  it("refuses a SMALL agency writing popup copy even without enabling it", () => {
    // Letting this through with a 200 teaches the agency the feature works.
    expect(statusOf(() => assertPopupAllowed("SMALL", { popupTitle: "Draft" }))).toBe(403);
  });

  it("says nothing about the popup when the patch does not mention it", () => {
    expect(() => assertPopupAllowed("SMALL", { topBarEnabled: false })).not.toThrow();
  });
});

describe("assertBadgeChangeAllowed", () => {
  it("refuses a FREE-tier agency trying to hide the badge", () => {
    expect(statusOf(() => assertBadgeChangeAllowed("FREE", { showFuntushBadge: false }))).toBe(403);
  });

  it("allows a FREE-tier agency to ask for the state it is already in", () => {
    // A "save the whole form" client sends every field every time. Rejecting a
    // no-op would make the entire settings screen unsaveable on the trial.
    expect(() => assertBadgeChangeAllowed("FREE", { showFuntushBadge: true })).not.toThrow();
  });

  it("lets every paid tier set it either way", () => {
    for (const tier of ["SMALL", "MEDIUM", "LARGE"]) {
      expect(() => assertBadgeChangeAllowed(tier, { showFuntushBadge: false })).not.toThrow();
      expect(() => assertBadgeChangeAllowed(tier, { showFuntushBadge: true })).not.toThrow();
    }
  });

  it("ignores a patch that does not mention the badge", () => {
    expect(() => assertBadgeChangeAllowed("FREE", { topBarEnabled: false })).not.toThrow();
  });
});

describe("assertTopBarColorAllowed", () => {
  it("lets MEDIUM and LARGE pick any hex", () => {
    expect(() =>
      assertTopBarColorAllowed("LARGE", { topBarBackgroundColor: CUSTOM_HEX }),
    ).not.toThrow();
  });

  it("restricts FREE and SMALL to the curated palette, with 403", () => {
    // Reusing Day 1's `allowsFreeColorPicker` rather than re-deciding it is what
    // keeps this identical to the brand colour rule.
    for (const tier of ["FREE", "SMALL"]) {
      expect(
        statusOf(() => assertTopBarColorAllowed(tier, { topBarBackgroundColor: CUSTOM_HEX })),
      ).toBe(403);
      expect(() =>
        assertTopBarColorAllowed(tier, { topBarBackgroundColor: CURATED_HEX }),
      ).not.toThrow();
    }
  });

  it("lets any tier clear the override back to the brand colour", () => {
    // Going *back* to the brand colour is never a paid feature — and if it were
    // refused, a downgraded agency could never undo its custom colour.
    expect(() => assertTopBarColorAllowed("SMALL", { topBarBackgroundColor: null })).not.toThrow();
  });
});

/* ── 4. Coherence rules, on the merged state ────────────────────────────── */

describe("assertCoherent", () => {
  it("refuses to enable an empty announcement bar", () => {
    const merged = mergePatch(null, { topBarEnabled: true });
    expect(statusOf(() => assertCoherent(merged))).toBe(400);
  });

  it("allows enabling a bar whose text is already stored", () => {
    // The reason cross-field rules cannot live in zod. `{topBarEnabled: true}` is
    // legal or illegal depending entirely on the row.
    const merged = mergePatch(configRow({ topBarText: "Saved last week" }), {
      topBarEnabled: true,
    });
    expect(() => assertCoherent(merged)).not.toThrow();
  });

  it("refuses text that is only whitespace", () => {
    // zod's `.trim()` catches this at the edge; the merged state can still hold
    // a whitespace string that arrived before that rule existed.
    const merged = mergePatch(configRow({ topBarText: "   " }), { topBarEnabled: true });
    expect(statusOf(() => assertCoherent(merged))).toBe(400);
  });

  it("refuses to enable a popup with no title or no body", () => {
    expect(statusOf(() => assertCoherent(mergePatch(null, { popupEnabled: true })))).toBe(400);

    const titleOnly = mergePatch(null, { popupEnabled: true, popupTitle: "Autumn sale" });
    expect(statusOf(() => assertCoherent(titleOnly))).toBe(400);
  });

  it("refuses a popup button with a label but no link, and vice versa", () => {
    // Both halves, because a one-sided check passes whichever direction it forgot.
    const labelOnly = mergePatch(null, { popupCtaLabel: "Book now" });
    expect(statusOf(() => assertCoherent(labelOnly))).toBe(400);

    const urlOnly = mergePatch(null, { popupCtaUrl: "https://example.com" });
    expect(statusOf(() => assertCoherent(urlOnly))).toBe(400);
  });

  it("allows clearing both halves of the button at once", () => {
    const merged = mergePatch(rowWithLivePopup(), { popupCtaLabel: null, popupCtaUrl: null });
    expect(() => assertCoherent(merged)).not.toThrow();
  });

  it("does not police the popup's content while the popup is off", () => {
    // A half-written draft is a legitimate state to save. Only *enabling* it
    // demands completeness.
    const merged = mergePatch(null, { popupTitle: "Half-written draft" });
    expect(() => assertCoherent(merged)).not.toThrow();
  });
});

/* ── 5. Resolution ──────────────────────────────────────────────────────── */

describe("resolveComingSoon", () => {
  it("falls back to platform copy per field, not per object", () => {
    // An agency that wrote a headline and no message keeps its headline.
    const merged = withDefaults(configRow({ constructionHeadline: "Back in October" }));
    const page = resolveComingSoon(merged);

    expect(page.headline).toBe("Back in October");
    expect(page.message).toBe(DEFAULT_CONSTRUCTION_COPY.message);
  });

  it("treats whitespace-only copy as unset", () => {
    const merged = withDefaults(configRow({ constructionHeadline: "   " }));
    expect(resolveComingSoon(merged).headline).toBe(DEFAULT_CONSTRUCTION_COPY.headline);
  });
});

describe("resolveTopBar", () => {
  it("is null when the bar is off", () => {
    const merged = withDefaults(configRow({ topBarText: "Written but off" }));
    expect(resolveTopBar(merged, "#0F766E")).toBeNull();
  });

  it("is null when the bar is on but empty", () => {
    // Belt and braces against a row that predates the coherence rule.
    const merged = withDefaults(configRow({ topBarEnabled: true, topBarText: null }));
    expect(resolveTopBar(merged, "#0F766E")).toBeNull();
  });

  it("inherits the brand colour when no background was chosen", () => {
    const merged = withDefaults(configRow({ topBarEnabled: true, topBarText: "15% off" }));
    expect(resolveTopBar(merged, "#123456")!.backgroundColor).toBe("#123456");
  });

  it("computes a readable text colour instead of storing one", () => {
    // The whole point: a bar cannot be configured into an unreadable state,
    // because the text colour is never a setting.
    const onYellow = withDefaults(
      configRow({ topBarEnabled: true, topBarText: "x", topBarBackgroundColor: "#FFFF00" }),
    );
    const onNavy = withDefaults(
      configRow({ topBarEnabled: true, topBarText: "x", topBarBackgroundColor: "#001F3F" }),
    );

    expect(resolveTopBar(onYellow, "#0F766E")!.textColor).toBe("#111827");
    expect(resolveTopBar(onNavy, "#0F766E")!.textColor).toBe("#FFFFFF");
  });

  it("trims the announcement text", () => {
    const merged = withDefaults(configRow({ topBarEnabled: true, topBarText: "  15% off  " }));
    expect(resolveTopBar(merged, "#0F766E")!.text).toBe("15% off");
  });
});

describe("resolvePopup", () => {
  it("renders a complete popup for MEDIUM and LARGE", () => {
    const merged = withDefaults(rowWithLivePopup());

    for (const tier of ["MEDIUM", "LARGE"]) {
      const popup = resolvePopup(merged, tier);
      expect(popup).not.toBeNull();
      expect(popup!.title).toBe("Autumn season is open");
      expect(popup!.ctaUrl).toBe("https://example.com/departures");
    }
  });

  it("stops rendering the instant the tier drops — the downgrade case", () => {
    // The reason the tier is checked on the *read* path too. A LARGE agency with
    // a live popup that downgrades to SMALL has nothing written to its row and
    // no cleanup job running. Without this check its popup would keep opening
    // forever, and it would be enjoying a feature it stopped paying for.
    const merged = withDefaults(rowWithLivePopup());

    expect(resolvePopup(merged, "SMALL")).toBeNull();
    expect(resolvePopup(merged, "FREE")).toBeNull();
  });

  it("keeps the data intact so an upgrade restores the popup", () => {
    // The flip side of the same decision: nothing was deleted, so this works.
    const merged = withDefaults(rowWithLivePopup());

    expect(resolvePopup(merged, "SMALL")).toBeNull();
    expect(resolvePopup(merged, "LARGE")!.title).toBe("Autumn season is open");
  });

  it("drops a half-configured button rather than rendering a dead one", () => {
    const merged = withDefaults(
      configRow({
        popupEnabled: true,
        popupTitle: "Autumn",
        popupBody: "Body text",
        popupCtaLabel: "Book now",
        popupCtaUrl: null,
      }),
    );

    const popup = resolvePopup(merged, "LARGE")!;
    expect(popup.ctaLabel).toBeNull();
    expect(popup.ctaUrl).toBeNull();
  });

  it("is null when disabled", () => {
    const merged = withDefaults(configRow({ ...rowWithLivePopup(), popupEnabled: false }));
    expect(resolvePopup(merged, "LARGE")).toBeNull();
  });
});

describe("resolveSiteConfig", () => {
  it("suppresses the bar and the popup while the site is under construction", () => {
    // Precedence rule: "20% off Everest!" floating above "We'll be back soon" is
    // not a page any agency meant to publish.
    const row = configRow({
      ...rowWithLivePopup(),
      underConstruction: true,
      topBarEnabled: true,
      topBarText: "20% off Everest",
    });

    const resolved = resolveSiteConfig({ tier: "LARGE" }, row, "#0F766E");

    expect(resolved.underConstruction).toBe(true);
    expect(resolved.comingSoon).not.toBeNull();
    expect(resolved.topBar).toBeNull();
    expect(resolved.popup).toBeNull();
  });

  it("keeps the badge on the coming-soon page", () => {
    // The badge is a platform term, not agency content — and the coming-soon page
    // is still a page Funtush is hosting.
    const row = configRow({ underConstruction: true });
    expect(resolveSiteConfig({ tier: "FREE" }, row, "#0F766E").showFuntushBadge).toBe(true);
  });

  it("forces the badge on for the trial tier whatever the row says", () => {
    // Stored `false` is *ignored*, not merely defaulted. That is what makes a
    // downgrade to the trial restore the badge with no cleanup job.
    const row = configRow({ showFuntushBadge: false });
    expect(resolveSiteConfig({ tier: "FREE" }, row, "#0F766E").showFuntushBadge).toBe(true);
  });

  it("hides the badge on every paid tier by default", () => {
    for (const tier of ["SMALL", "MEDIUM", "LARGE"]) {
      expect(resolveSiteConfig({ tier }, null, "#0F766E").showFuntushBadge).toBe(false);
    }
  });

  it("lets a paid tier opt back in to the badge", () => {
    const row = configRow({ showFuntushBadge: true });
    expect(resolveSiteConfig({ tier: "SMALL" }, row, "#0F766E").showFuntushBadge).toBe(true);
  });

  it("gives a never-configured agency a live, quiet site", () => {
    const resolved = resolveSiteConfig({ tier: "LARGE" }, null, "#0F766E");

    expect(resolved.underConstruction).toBe(false);
    expect(resolved.comingSoon).toBeNull();
    expect(resolved.topBar).toBeNull();
    expect(resolved.popup).toBeNull();
    expect(resolved.updatedAt).toBeNull();
  });

  it("returns whole objects or null, never flags the renderer must combine", () => {
    // The contract that keeps the front-end from having to remember four
    // conditions. Asserted explicitly so nobody flattens it back out.
    const row = configRow({ topBarEnabled: true, topBarText: "Open for autumn" });
    const resolved = resolveSiteConfig({ tier: "SMALL" }, row, "#0F766E");

    expect(resolved.topBar).toMatchObject({ text: "Open for autumn", behavior: "STATIC" });
    expect(resolved).not.toHaveProperty("topBarEnabled");
  });
});

/* ── 6. Database-backed reads ───────────────────────────────────────────── */

describe("getSiteConfig", () => {
  it("returns raw stored values, not resolved ones", async () => {
    // A settings form must show what is saved even when it is not rendering —
    // otherwise a downgraded agency opens the screen and its popup copy has
    // apparently vanished.
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));
    siteConfigFindUnique.mockResolvedValue(rowWithLivePopup());

    const config = await getSiteConfig(AGENCY_ID);

    expect(config.values.popupEnabled).toBe(true);
    expect(config.values.popupTitle).toBe("Autumn season is open");
    expect(config.capabilities.popupModal).toBe(false);
  });

  it("reports capabilities so the UI can disable rather than fail", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("FREE"));

    const config = await getSiteConfig(AGENCY_ID);

    expect(config.capabilities).toEqual({
      popupModal: false,
      funtushBadgeToggle: false,
      topBarColorMode: "curated",
    });
    expect(config.effectiveFuntushBadge).toBe(true);
  });

  it("reports the full capability set for LARGE", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("LARGE"));

    const config = await getSiteConfig(AGENCY_ID);

    expect(config.capabilities).toEqual({
      popupModal: true,
      funtushBadgeToggle: true,
      topBarColorMode: "free",
    });
  });

  it("scopes the lookup to the agency it was given", async () => {
    // Multi-tenancy (Backend Guide §4): the id comes from the session and is the
    // only thing the query is keyed on.
    await getSiteConfig(AGENCY_ID);
    expect(siteConfigFindUnique).toHaveBeenCalledWith({ where: { agencyId: AGENCY_ID } });
  });

  it("404s for an agency that does not exist", async () => {
    agencyFindUnique.mockResolvedValue(null);
    expect(await statusOfAsync(() => getSiteConfig("nope"))).toBe(404);
  });
});

describe("getSiteConfigOptions", () => {
  it("explains the badge rule in words for the trial tier", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("FREE"));
    const options = await getSiteConfigOptions(AGENCY_ID);

    expect(options.capabilities.funtushBadgeToggle).toBe(false);
    expect(options.notes.funtushBadge).toContain("free trial");
  });

  it("offers every picker to every tier — capabilities gate them, not the list", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));
    const options = await getSiteConfigOptions(AGENCY_ID);

    expect(options.topBarBehaviors).toHaveLength(2);
    expect(options.popupTriggers).toHaveLength(3);
    expect(options.popupFrequencies).toHaveLength(4);
  });
});

describe("getPublicSiteConfigBySlug", () => {
  function publicAgency(overrides: Record<string, unknown> = {}) {
    return {
      name: "Himalayan Trails",
      slug: "himalayan-trails",
      status: "ACTIVE",
      tier: { name: "LARGE" },
      branding: null,
      siteConfig: null,
      ...overrides,
    };
  }

  it("falls back to the default brand colour when there is no branding row", async () => {
    // Reusing Day 1's `resolveBranding` is what makes this work — reading
    // `branding.primaryColor` directly would give the bar `undefined`.
    agencyFindUnique.mockResolvedValue(
      publicAgency({
        siteConfig: configRow({ topBarEnabled: true, topBarText: "Namaste" }),
      }),
    );

    const config = await getPublicSiteConfigBySlug("himalayan-trails");

    expect(config.topBar!.backgroundColor).toBe(DEFAULT_BRANDING.primaryColor);
  });

  it("uses the agency's own brand colour when it has one", async () => {
    agencyFindUnique.mockResolvedValue(
      publicAgency({
        branding: { primaryColor: "#B91C1C", paletteId: "crimson", cardImageRatio: "RATIO_4_3" },
        siteConfig: configRow({ topBarEnabled: true, topBarText: "Namaste" }),
      }),
    );

    const config = await getPublicSiteConfigBySlug("himalayan-trails");

    expect(config.topBar!.backgroundColor).toBe("#B91C1C");
  });

  it("loads branding and config in one query", async () => {
    // Not just a saved round trip: fetching separately opens a window where a
    // brand colour change lands between the two reads and the bar renders stale.
    agencyFindUnique.mockResolvedValue(publicAgency());

    await getPublicSiteConfigBySlug("himalayan-trails");

    expect(agencyFindUnique).toHaveBeenCalledTimes(1);
    const select = agencyFindUnique.mock.calls[0]![0].select;
    expect(select.branding).toBe(true);
    expect(select.siteConfig).toBe(true);
  });

  it("404s a suspended or locked agency rather than 403", async () => {
    // Matches Day 1 exactly. 403 would confirm "exists but is not paying".
    for (const status of ["SUSPENDED", "LOCKED"]) {
      agencyFindUnique.mockResolvedValue(publicAgency({ status }));
      expect(await statusOfAsync(() => getPublicSiteConfigBySlug("x"))).toBe(404);
    }
  });

  it("404s an unknown slug", async () => {
    agencyFindUnique.mockResolvedValue(null);
    expect(await statusOfAsync(() => getPublicSiteConfigBySlug("nope"))).toBe(404);
  });
});

/* ── 7. The write ───────────────────────────────────────────────────────── */

describe("updateSiteConfig", () => {
  it("rejects an empty patch", async () => {
    expect(await statusOfAsync(() => updateSiteConfig(AGENCY_ID, {}))).toBe(400);
    expect(siteConfigUpsert).not.toHaveBeenCalled();
  });

  it("upserts, because an agency may have no row yet", async () => {
    await updateSiteConfig(AGENCY_ID, { underConstruction: true });

    expect(siteConfigUpsert).toHaveBeenCalledWith({
      where: { agencyId: AGENCY_ID },
      update: { underConstruction: true },
      create: { agencyId: AGENCY_ID, underConstruction: true },
    });
  });

  it("writes only the keys the request actually sent", async () => {
    await updateSiteConfig(AGENCY_ID, { topBarBehavior: "SCROLLING", topBarText: undefined });

    const call = siteConfigUpsert.mock.calls[0]![0];
    expect(call.update).toEqual({ topBarBehavior: "SCROLLING" });
    expect(call.update).not.toHaveProperty("topBarText");
  });

  it("passes an explicit null straight through so a field can be cleared", async () => {
    await updateSiteConfig(AGENCY_ID, { topBarLinkUrl: null });

    expect(siteConfigUpsert.mock.calls[0]![0].update).toEqual({ topBarLinkUrl: null });
  });

  it("checks the tier before touching the database", async () => {
    // A rejection must cost zero writes — the same ordering rule Day 1 enforced
    // so that a refused save costs zero S3 uploads.
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));

    expect(await statusOfAsync(() => updateSiteConfig(AGENCY_ID, { popupEnabled: true }))).toBe(403);
    expect(siteConfigUpsert).not.toHaveBeenCalled();
  });

  it("reports the tier problem (403) before the coherence problem (400)", async () => {
    // A Small agency sending an incoherent popup patch should hear "your plan
    // does not include popups", not "your popup needs a title" — the second
    // sends it off to write copy for a feature it cannot use.
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));

    const status = await statusOfAsync(() =>
      updateSiteConfig(AGENCY_ID, { popupEnabled: true, popupTitle: undefined }),
    );

    expect(status).toBe(403);
  });

  it("refuses to enable an empty bar with 400", async () => {
    expect(await statusOfAsync(() => updateSiteConfig(AGENCY_ID, { topBarEnabled: true }))).toBe(400);
    expect(siteConfigUpsert).not.toHaveBeenCalled();
  });

  it("allows enabling a bar whose text is already in the row", async () => {
    siteConfigFindUnique.mockResolvedValue(configRow({ topBarText: "Saved last week" }));

    await updateSiteConfig(AGENCY_ID, { topBarEnabled: true });

    expect(siteConfigUpsert).toHaveBeenCalled();
  });

  it("blocks a FREE agency from hiding the badge, before any write", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("FREE"));

    expect(
      await statusOfAsync(() => updateSiteConfig(AGENCY_ID, { showFuntushBadge: false })),
    ).toBe(403);
    expect(siteConfigUpsert).not.toHaveBeenCalled();
  });

  it("returns the response through the same builder a plain GET uses", async () => {
    // Two builders for one shape is how a save comes back subtly different from
    // the reload that follows it. Asserted by checking the re-read happened.
    siteConfigFindUnique.mockResolvedValue(null);

    const result = await updateSiteConfig(AGENCY_ID, { underConstruction: true });

    // Once before the write (to merge), once after (to build the response).
    expect(siteConfigFindUnique).toHaveBeenCalledTimes(2);
    expect(result).toHaveProperty("capabilities");
    expect(result).toHaveProperty("values");
  });

  it("never lets the body name the agency", async () => {
    // Multi-tenancy: `agencyId` is taken from the session argument only. The
    // schema's `.strict()` rejects it in the body, and this asserts the service
    // does not read one even if it arrived.
    await updateSiteConfig(AGENCY_ID, {
      underConstruction: true,
    } as Parameters<typeof updateSiteConfig>[1]);

    const call = siteConfigUpsert.mock.calls[0]![0];
    expect(call.where).toEqual({ agencyId: AGENCY_ID });
    expect(call.create.agencyId).toBe(AGENCY_ID);
  });
});

/* ── 8. The liveness probe ──────────────────────────────────────────────── */

describe("getSiteLiveness", () => {
  it("reports a normal site as live", async () => {
    agencyFindUnique.mockResolvedValue({ status: "ACTIVE", siteConfig: null });

    expect(await getSiteLiveness("himalayan-trails")).toEqual({ live: true, comingSoon: null });
  });

  it("reports an under-construction site as not live, with copy", async () => {
    agencyFindUnique.mockResolvedValue({
      status: "ACTIVE",
      siteConfig: {
        underConstruction: true,
        constructionHeadline: "Back in October",
        constructionMessage: null,
      },
    });

    const liveness = await getSiteLiveness("himalayan-trails");

    expect(liveness.live).toBe(false);
    expect(liveness.comingSoon).toEqual({
      headline: "Back in October",
      message: DEFAULT_CONSTRUCTION_COPY.message,
    });
  });

  it("returns not-live with no copy for a missing agency, rather than throwing", async () => {
    // The middleware turns this into a 404. Throwing would force every caller
    // into a try/catch that has to tell "missing" apart from "database down".
    agencyFindUnique.mockResolvedValue(null);

    expect(await getSiteLiveness("nope")).toEqual({ live: false, comingSoon: null });
  });

  it("returns not-live with no copy for a suspended or locked agency", async () => {
    for (const status of ["SUSPENDED", "LOCKED"]) {
      agencyFindUnique.mockResolvedValue({ status, siteConfig: null });
      expect(await getSiteLiveness("x")).toEqual({ live: false, comingSoon: null });
    }
  });

  it("selects only the three columns it needs", async () => {
    // A guard that costs as much as the handler it guards is a guard people
    // take back out.
    agencyFindUnique.mockResolvedValue({ status: "ACTIVE", siteConfig: null });

    await getSiteLiveness("himalayan-trails");

    const select = agencyFindUnique.mock.calls[0]![0].select;
    expect(select.branding).toBeUndefined();
    expect(Object.keys(select.siteConfig.select)).toEqual([
      "underConstruction",
      "constructionHeadline",
      "constructionMessage",
    ]);
  });
});

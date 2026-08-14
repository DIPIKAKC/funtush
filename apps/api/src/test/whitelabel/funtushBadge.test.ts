import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ── "Powered by Funtush" badge visibility (White-label week · Day 5) ─────────
 *
 * The badge is a one-line feature with an outsized failure surface, which is why
 * it gets a whole test file of its own.
 *
 * **What it is.** On the 30-day trial, the platform is not being paid in money,
 * so it is paid in attribution: every trial site carries a small "Powered by
 * Funtush" credit. On any paid plan the site is unbranded by default, and the
 * agency may switch the credit back on if it wants to.
 *
 * **Why it is delicate.** The rule is not symmetric, and asymmetric rules are the
 * ones implementations get half-right:
 *
 *   - On the trial the stored preference is **ignored**, not defaulted. An agency
 *     that unticked the box while on Large and then dropped to the trial gets the
 *     badge back *immediately*, with no cleanup job and no migration — because
 *     nothing about the badge is read from the row on that tier.
 *   - On a paid plan the stored preference is **respected**, including a stored
 *     `false`, and including the "I actually like the credit" case.
 *
 * The bug this file exists to prevent is a paying customer's site displaying an
 * advertisement for its supplier — or, in the other direction, the platform
 * giving away 30 days of hosting with its name quietly removed.
 *
 * **The four-tier requirement.** Day 2's note records that the first attempt at
 * this rule was `tier !== "LARGE"`, which is right for two tiers out of four and
 * puts the badge on the sites of every paying Small and Medium agency. Every test
 * below therefore drives all four tier names rather than a representative pair.
 */

/* ── Test doubles ────────────────────────────────────────────────────────── */

const agencyFindUnique = vi.fn();
const siteConfigFindUnique = vi.fn();
const siteConfigUpsert = vi.fn();
const brandingFindUnique = vi.fn();
const brandingUpsert = vi.fn();

vi.mock("@funtush/database", () => ({
  db: {
    agency: { findUnique: (...a: unknown[]) => agencyFindUnique(...a) },
    agencySiteConfig: {
      findUnique: (...a: unknown[]) => siteConfigFindUnique(...a),
      upsert: (...a: unknown[]) => siteConfigUpsert(...a),
    },
    agencyBranding: {
      findUnique: (...a: unknown[]) => brandingFindUnique(...a),
      upsert: (...a: unknown[]) => brandingUpsert(...a),
    },
  },
}));

vi.mock("@funtush/storage", () => ({
  uploadFile: vi.fn(async () => "https://cdn.funtush.com/uploads/x.png"),
  deleteFile: vi.fn(async () => undefined),
}));

vi.mock("../../services/regeneration.service", () => ({
  queueRegeneration: vi.fn(() => ({ id: "receipt-1", status: "queued" })),
}));

import {
  DEFAULT_SITE_CONFIG,
  canToggleFuntushBadge,
  isTrialTier,
  resolveFuntushBadge,
} from "../../data/siteConfig";
import { DEFAULT_BRANDING, type TierName } from "../../data/brandTheme";
import {
  assertBadgeChangeAllowed,
  getPublicSiteConfigBySlug,
  getSiteConfig,
  getSiteConfigOptions,
  resolveSiteConfig,
  updateSiteConfig,
  type SiteConfigRow,
} from "../../services/siteConfig.service";
import { getPublicBrandingBySlug } from "../../services/branding.service";

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const AGENCY_ID = "agency-1";
const SLUG = "himalayan-trails";
const SAVED_AT = new Date("2026-08-14T09:00:00.000Z");

const ALL_TIERS: readonly TierName[] = ["FREE", "SMALL", "MEDIUM", "LARGE"];
const PAID_TIERS: readonly TierName[] = ["SMALL", "MEDIUM", "LARGE"];

/**
 * The three states a stored preference can be in.
 *
 * `null` and `undefined` are not the same thing to a reader, even though this
 * rule collapses them: `null` is a column that exists and holds nothing,
 * `undefined` is an agency with no config row at all. Both are real — the first
 * is a saved form that never touched the badge, the second is an agency on its
 * first day — so both are driven everywhere below.
 */
const STORED_VALUES: readonly (boolean | null | undefined)[] = [true, false, null, undefined];

function agencyOnTier(tier: string) {
  return {
    id: AGENCY_ID,
    name: "Himalayan Trails Pvt. Ltd.",
    slug: SLUG,
    status: "ACTIVE",
    customDomain: null,
    tier: { name: tier },
  };
}

function onTier(tier: string): void {
  agencyFindUnique.mockResolvedValue(agencyOnTier(tier));
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

/**
 * A row for a given stored preference, or `null` for "this agency has never
 * opened the Site Configuration screen".
 */
function rowFor(stored: boolean | null | undefined): SiteConfigRow | null {
  if (stored === undefined) return null;
  return configRow({ showFuntushBadge: stored as boolean });
}

/**
 * What the badge *should* be, expressed once, in English.
 *
 * Every test below compares an implementation against this function rather than
 * against a literal, so the rule is stated exactly once in the suite and each
 * test says which code path it is checking that rule through.
 */
function expectedBadge(tier: string, stored: boolean | null | undefined): boolean {
  if (tier === "FREE") return true; // a term of the trial, not a setting
  return stored ?? false; // paid: hidden unless the agency asked for it
}

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
  onTier("LARGE");
  siteConfigFindUnique.mockResolvedValue(null);
  siteConfigUpsert.mockResolvedValue(configRow());
  brandingFindUnique.mockResolvedValue(null);
});

/* ── 1. The rule itself, as a truth table ────────────────────────────────── */

describe("resolveFuntushBadge — the full 4 × 4 truth table", () => {
  it("answers every tier and every stored value the way the product says", () => {
    // Sixteen rows. Written as a loop over a computed expectation rather than
    // sixteen literals so that the *rule* is what is asserted; a table of
    // hand-written booleans is just the implementation typed twice.
    for (const tier of ALL_TIERS) {
      for (const stored of STORED_VALUES) {
        expect(resolveFuntushBadge(tier, stored), `${tier} + stored=${String(stored)}`).toBe(
          expectedBadge(tier, stored),
        );
      }
    }
  });

  it("ignores the stored value on the trial rather than merely defaulting it", () => {
    // This is *the* distinction of the whole feature. A default would mean
    // `stored ?? true`, which reads identically in a code review and behaves
    // completely differently: an agency that once stored `false` would keep a
    // badge-free site after downgrading to the trial, forever, and the only fix
    // would be a data migration.
    expect(resolveFuntushBadge("FREE", false)).toBe(true);
    expect(resolveFuntushBadge("FREE", null)).toBe(true);
    expect(resolveFuntushBadge("FREE", true)).toBe(true);
  });

  it("respects a stored false on every paid tier — including Small and Medium", () => {
    // The tier list matters here. `tier !== "LARGE"` — Day 1's first guess —
    // passes for LARGE and fails for the two tiers in the middle, which between
    // them are most of the paying customers.
    for (const tier of PAID_TIERS) {
      expect(resolveFuntushBadge(tier, false), tier).toBe(false);
      expect(resolveFuntushBadge(tier, null), tier).toBe(false);
      expect(resolveFuntushBadge(tier, true), tier).toBe(true);
    }
  });

  it("ships hidden by default, so a paid site is never branded by accident", () => {
    expect(DEFAULT_SITE_CONFIG.showFuntushBadge).toBe(false);
  });

  it("treats an unrecognised tier as paid — the platform never brands a site it cannot identify", () => {
    // Documented deliberately, because it is the one place this rule fails
    // *open* rather than closed. The reasoning: the only way a tier name goes
    // missing is a corrupt or renamed row, and `getAgencyBrandContext` already
    // defaults a missing tier to `FREE` (the strictest), so what reaches this
    // function is a name somebody chose. Putting the platform's own advert on a
    // site because of a bad deploy is worse than briefly omitting it.
    expect(resolveFuntushBadge("PLATINUM", null)).toBe(false);
    expect(resolveFuntushBadge("", null)).toBe(false);
    // …and the safety net that makes it moot: a missing tier reads as FREE.
    expect(isTrialTier("FREE")).toBe(true);
    expect(isTrialTier("free")).toBe(false); // case-sensitive, like the seeded row
  });
});

/* ── 2. May this tier change it? ─────────────────────────────────────────── */

describe("canToggleFuntushBadge — the write permission", () => {
  it("is false only for the trial", () => {
    expect(canToggleFuntushBadge("FREE")).toBe(false);
    for (const tier of PAID_TIERS) {
      expect(canToggleFuntushBadge(tier), tier).toBe(true);
    }
  });

  it("stays a separate question from what renders", () => {
    // Two functions, deliberately. One answers "what does the visitor see?", the
    // other "may this request write?". A single function that returns a boolean
    // *and* throws is how a read path starts rejecting requests: the public
    // renderer would call it on every page view.
    expect(resolveFuntushBadge("LARGE", true)).toBe(true);
    expect(canToggleFuntushBadge("LARGE")).toBe(true);
    // A trial site shows the badge and may not change it — same tier, opposite
    // answers, which only two functions can express.
    expect(resolveFuntushBadge("FREE", true)).toBe(true);
    expect(canToggleFuntushBadge("FREE")).toBe(false);
  });
});

/* ── 3. The write path ───────────────────────────────────────────────────── */

describe("the write path across all four tiers", () => {
  it("refuses a trial agency hiding the badge, with 403", async () => {
    onTier("FREE");

    // 403, not 400: the request is perfectly well-formed. What is missing is
    // entitlement, and saying so is what makes the message actionable
    // ("upgrade") rather than confusing ("try a different value").
    expect(await statusOf(() => updateSiteConfig(AGENCY_ID, { showFuntushBadge: false }))).toBe(
      403,
    );
  });

  it("does not write to the database when it refuses", async () => {
    onTier("FREE");
    await statusOf(() => updateSiteConfig(AGENCY_ID, { showFuntushBadge: false }));

    expect(siteConfigUpsert).not.toHaveBeenCalled();
  });

  it("lets a trial agency ask for the state it is already in", async () => {
    // A settings screen that saves the whole form sends `showFuntushBadge: true`
    // on every save. Refusing that would break the Save button for every other
    // setting on the page, for a request that changes nothing.
    onTier("FREE");
    await expect(updateSiteConfig(AGENCY_ID, { showFuntushBadge: true })).resolves.toBeDefined();
  });

  it("ignores the badge entirely when the patch does not mention it", async () => {
    onTier("FREE");
    await expect(updateSiteConfig(AGENCY_ID, { underConstruction: true })).resolves.toBeDefined();
  });

  it("lets every paid tier set it either way", async () => {
    for (const tier of PAID_TIERS) {
      onTier(tier);

      await expect(
        updateSiteConfig(AGENCY_ID, { showFuntushBadge: false }),
        `${tier} → hide`,
      ).resolves.toBeDefined();
      await expect(
        updateSiteConfig(AGENCY_ID, { showFuntushBadge: true }),
        `${tier} → show`,
      ).resolves.toBeDefined();
    }
  });

  it("the pure guard agrees with the endpoint, for all four tiers and both values", () => {
    // `assertBadgeChangeAllowed` is the unit the endpoint delegates to. Driving
    // it directly covers the same matrix without sixteen database round trips,
    // and pins that the guard — not the endpoint — is where the rule lives.
    for (const tier of ALL_TIERS) {
      const hiding = (): void => assertBadgeChangeAllowed(tier, { showFuntushBadge: false });
      const showing = (): void => assertBadgeChangeAllowed(tier, { showFuntushBadge: true });
      const silent = (): void => assertBadgeChangeAllowed(tier, {});

      if (tier === "FREE") {
        expect(hiding, tier).toThrow();
      } else {
        expect(hiding, tier).not.toThrow();
      }
      expect(showing, tier).not.toThrow();
      expect(silent, tier).not.toThrow();
    }
  });
});

/* ── 4. The read paths ───────────────────────────────────────────────────── */

describe("what the public renderer is told", () => {
  it("resolves the same 4 × 4 matrix as the rule, through the real resolver", () => {
    // `resolveSiteConfig` is what the white-label site actually calls. Driving
    // the matrix through it as well as through `resolveFuntushBadge` is what
    // catches the badge being recomputed, defaulted, or dropped somewhere in
    // between the rule and the response.
    for (const tier of ALL_TIERS) {
      for (const stored of STORED_VALUES) {
        const resolved = resolveSiteConfig(
          { tier },
          rowFor(stored),
          DEFAULT_BRANDING.primaryColor,
        );

        expect(resolved.showFuntushBadge, `${tier} + stored=${String(stored)}`).toBe(
          expectedBadge(tier, stored),
        );
      }
    }
  });

  it("keeps the badge on the coming-soon page, on every tier", () => {
    // Under construction switches the site to a completely different page and
    // suppresses the agency's own announcements — but the badge is a platform
    // term, not agency content, and a coming-soon page is still a page Funtush is
    // hosting. Asserted for all four tiers because "the rule still applies in
    // this other mode" is exactly the kind of thing an early return skips.
    for (const tier of ALL_TIERS) {
      const resolved = resolveSiteConfig(
        { tier },
        configRow({ underConstruction: true }),
        DEFAULT_BRANDING.primaryColor,
      );

      expect(resolved.underConstruction, tier).toBe(true);
      expect(resolved.comingSoon, tier).not.toBeNull();
      expect(resolved.showFuntushBadge, tier).toBe(expectedBadge(tier, false));
    }
  });

  it("serves the badge over the public endpoint the renderer calls", async () => {
    for (const tier of ALL_TIERS) {
      agencyFindUnique.mockResolvedValue({
        name: "Himalayan Trails",
        slug: SLUG,
        status: "ACTIVE",
        tier: { name: tier },
        branding: null,
        siteConfig: configRow({ showFuntushBadge: false }),
      });

      const config = await getPublicSiteConfigBySlug(SLUG);

      // Stored `false` on every tier — so this asserts precisely the thing the
      // trial rule is for: the row says "hidden" and the trial site shows it
      // anyway.
      expect(config.showFuntushBadge, tier).toBe(expectedBadge(tier, false));
    }
  });

  it("tells the dashboard both the raw value and the effective one", async () => {
    // The settings form binds to the raw value (so a downgraded agency still
    // sees its own preference), while the preview and the copy next to the
    // control need the effective one. Returning only one of the two forces the
    // front-end to re-derive the tier rule, which is how a browser ends up
    // holding a second, divergent copy of a business rule.
    onTier("FREE");
    siteConfigFindUnique.mockResolvedValue(configRow({ showFuntushBadge: false }));

    const view = await getSiteConfig(AGENCY_ID);

    expect(view.values.showFuntushBadge).toBe(false); // what is stored
    expect(view.effectiveFuntushBadge).toBe(true); // what renders
    expect(view.capabilities.funtushBadgeToggle).toBe(false); // and it is locked
  });

  it("reports the capability and the effective value consistently on every tier", async () => {
    for (const tier of ALL_TIERS) {
      onTier(tier);
      siteConfigFindUnique.mockResolvedValue(configRow({ showFuntushBadge: false }));

      const view = await getSiteConfig(AGENCY_ID);

      expect(view.capabilities.funtushBadgeToggle, tier).toBe(canToggleFuntushBadge(tier));
      expect(view.effectiveFuntushBadge, tier).toBe(expectedBadge(tier, false));
      // The advertised capability must match what the write path enforces —
      // otherwise the UI offers a switch the server refuses.
      const writeAllowed =
        (await statusOf(() => updateSiteConfig(AGENCY_ID, { showFuntushBadge: false }))) !== 403;
      expect(writeAllowed, tier).toBe(view.capabilities.funtushBadgeToggle);
    }
  });

  it("explains the lock in words instead of leaving a dead switch", async () => {
    // "Why can't I turn this off?" is a support ticket. A sentence next to the
    // control is not — so the options endpoint carries different copy for the
    // trial, and this pins that the two branches cannot collapse into one.
    onTier("FREE");
    const trial = await getSiteConfigOptions(AGENCY_ID);

    onTier("LARGE");
    const paid = await getSiteConfigOptions(AGENCY_ID);

    expect(trial.notes.funtushBadge).not.toBe(paid.notes.funtushBadge);
    expect(trial.notes.funtushBadge.toLowerCase()).toContain("trial");
    expect(trial.capabilities.funtushBadgeToggle).toBe(false);
    expect(paid.capabilities.funtushBadgeToggle).toBe(true);
  });
});

/* ── 5. Downgrade and upgrade ────────────────────────────────────────────── */

describe("downgrade and upgrade need no cleanup job", () => {
  /**
   * The scenario, in order: a Large agency turns the badge off, its subscription
   * lapses to the trial, and later it pays again.
   *
   * The property being proved is that *nothing writes to the database* at any
   * point in that story. The badge changes twice, and both times it changes
   * because the tier changed — not because a job ran, a webhook fired, or a
   * column was rewritten. Anything that has to run to make the rule true is
   * something that can fail to run.
   */
  const storedPreference = configRow({ showFuntushBadge: false });

  it("restores the badge the moment a paid agency drops to the trial", () => {
    expect(
      resolveSiteConfig({ tier: "LARGE" }, storedPreference, DEFAULT_BRANDING.primaryColor)
        .showFuntushBadge,
    ).toBe(false);

    expect(
      resolveSiteConfig({ tier: "FREE" }, storedPreference, DEFAULT_BRANDING.primaryColor)
        .showFuntushBadge,
    ).toBe(true);
  });

  it("keeps the agency's own preference intact while the trial overrides it", async () => {
    onTier("FREE");
    siteConfigFindUnique.mockResolvedValue(storedPreference);

    const view = await getSiteConfig(AGENCY_ID);

    // The stored `false` is still there, untouched…
    expect(view.values.showFuntushBadge).toBe(false);
    // …and reading it wrote nothing. A read that "fixes up" a row is a read that
    // cannot be cached, cannot run on a replica, and rewrites customer data
    // without being asked.
    expect(siteConfigUpsert).not.toHaveBeenCalled();
  });

  it("hides the badge again on upgrade, with no second save", () => {
    // Same untouched row, back on a paid tier: the preference the agency set
    // months ago is honoured immediately.
    expect(
      resolveSiteConfig({ tier: "MEDIUM" }, storedPreference, DEFAULT_BRANDING.primaryColor)
        .showFuntushBadge,
    ).toBe(false);
  });
});

/* ── 6. One implementation, not two ──────────────────────────────────────── */

describe("the badge is decided in exactly one place", () => {
  it("is absent from the branding payload — it moved to site config on Day 2", async () => {
    // Day 1 computed the badge inside `resolveBranding` as `tier !== "LARGE"`.
    // Day 2 removed it: the badge has a stored preference, which makes it site
    // *configuration* rather than *theme*. If it ever grows back, two functions
    // answer one boolean and the badge renders on one page and not the next.
    for (const tier of ALL_TIERS) {
      agencyFindUnique.mockResolvedValue({
        name: "Himalayan Trails",
        slug: SLUG,
        status: "ACTIVE",
        tier: { name: tier },
        branding: null,
      });

      // Through `unknown` because the two types deliberately do not overlap —
      // which is the point: `ResolvedBranding` has no badge field, and this test
      // inspects the runtime keys to prove one has not been added back.
      const branding = (await getPublicBrandingBySlug(SLUG)) as unknown as Record<
        string,
        unknown
      >;

      expect(Object.keys(branding), tier).not.toContain("poweredByFuntush");
      expect(Object.keys(branding), tier).not.toContain("showFuntushBadge");
    }
  });

  it("is served by the config endpoint, which is the one the renderer asks", async () => {
    agencyFindUnique.mockResolvedValue({
      name: "Himalayan Trails",
      slug: SLUG,
      status: "ACTIVE",
      tier: { name: "FREE" },
      branding: null,
      siteConfig: null,
    });

    const config = await getPublicSiteConfigBySlug(SLUG);

    // A trial agency that has never opened the settings screen at all — no row —
    // still gets a defined `true`, not `undefined`. A renderer doing
    // `{config.showFuntushBadge && <Badge/>}` renders nothing for `undefined`,
    // and the badge would silently vanish for exactly the accounts it is for.
    expect(config.showFuntushBadge).toBe(true);
    expect(typeof config.showFuntushBadge).toBe("boolean");
  });
});

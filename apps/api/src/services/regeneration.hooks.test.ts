import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Wiring tests for the regeneration hook (White-label week · Day 4).
 *
 * `regeneration.service.test.ts` proves the pipeline is correct in isolation.
 * This file proves it is *connected* — that Day 1's, Day 2's and Day 3's write
 * paths actually call it, with the right scope, and (the half that is easy to
 * forget) that a **rejected** save does not.
 *
 * It is a separate file rather than three additions to the existing service
 * suites because it asserts one property that spans all three, and because
 * mocking `./regeneration.service` inside those suites would weaken tests that
 * currently exercise the real thing.
 *
 * Why "a rejected save must not purge" deserves its own tests: a purge forces a
 * rebuild of pages that did not change. Firing one on invalid input means any
 * client can make the platform rebuild a site by sending a request it knows will
 * be refused — an origin stampede triggered by a 403, which is the shape of a
 * denial-of-service bug rather than merely wasted work.
 */

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

/** No file is uploaded in these tests; the module is stubbed so importing the
 * branding service does not construct an S3 client. */
vi.mock("@funtush/storage", () => ({
  uploadFile: vi.fn(async () => "https://cdn.funtush.com/uploads/x.png"),
  deleteFile: vi.fn(async () => undefined),
}));

/**
 * The hook is stubbed rather than executed. This file is about *whether and how*
 * it is called; what it then does to a CDN has its own suite.
 */
const queueRegenerationMock = vi.fn((..._args: unknown[]) => ({
  id: "receipt-1",
  status: "queued",
}));

vi.mock("./regeneration.service", () => ({
  queueRegeneration: (...args: unknown[]) => queueRegenerationMock(...args),
}));

import { updateAgencyBranding } from "./branding.service";
import { updateSiteConfig } from "./siteConfig.service";
import { updateNavigation } from "./navigation.service";

const AGENCY_ID = "agency-1";
const SLUG = "himalayan-trails";
const SAVED_AT = new Date("2026-08-10T09:30:00.000Z");

/** The agency row every write path loads first, via `getAgencyBrandContext`. */
function agencyOnTier(tier: string, customDomain: string | null = "everest-treks.com") {
  return {
    id: AGENCY_ID,
    name: "Himalayan Trails",
    slug: SLUG,
    status: "ACTIVE",
    customDomain,
    tier: { name: tier },
  };
}

/** The status code a thrown `httpError` carries, or `undefined` if it resolved. */
async function statusOfAsync(run: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await run();
    return undefined;
  } catch (err) {
    return (err as { status?: number }).status;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  queueRegenerationMock.mockReturnValue({ id: "receipt-1", status: "queued" });

  agencyFindUnique.mockResolvedValue(agencyOnTier("MEDIUM"));

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

/* ── 1. A successful save publishes ──────────────────────────────────────── */

describe("the hook fires on a successful save", () => {
  it("branding", async () => {
    await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });

    expect(queueRegenerationMock).toHaveBeenCalledTimes(1);
    expect(queueRegenerationMock.mock.calls[0]![0]).toEqual({
      agencyId: AGENCY_ID,
      slug: SLUG,
      // A mapped domain is a second live cache; the hook cannot know about it
      // unless the write path passes it through.
      customDomain: "everest-treks.com",
      scopes: ["branding"],
      // The saved row's own timestamp, not "now" — the version published is the
      // version the database actually holds.
      version: SAVED_AT,
    });
  });

  it("site configuration", async () => {
    await updateSiteConfig(AGENCY_ID, { underConstruction: false });

    expect(queueRegenerationMock).toHaveBeenCalledTimes(1);
    expect(queueRegenerationMock.mock.calls[0]![0]).toMatchObject({
      agencyId: AGENCY_ID,
      slug: SLUG,
      scopes: ["siteConfig"],
    });
  });

  it("navigation", async () => {
    await updateNavigation(AGENCY_ID, { bookNowHidden: true });

    expect(queueRegenerationMock).toHaveBeenCalledTimes(1);
    expect(queueRegenerationMock.mock.calls[0]![0]).toMatchObject({
      agencyId: AGENCY_ID,
      slug: SLUG,
      scopes: ["navigation"],
    });
  });

  it("hands the receipt back so the response can carry it", async () => {
    const result = await updateAgencyBranding(AGENCY_ID, { brandName: "Himalaya Co" });

    // This is what turns "did my change go live?" from a support question into
    // a value the settings screen renders next to the save button.
    expect(result.regeneration).toMatchObject({ id: "receipt-1", status: "queued" });
  });
});

/* ── 2. A rejected save publishes nothing ────────────────────────────────── */

describe("the hook does NOT fire when the save was refused", () => {
  it("branding — a tier colour rule (403)", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));

    expect(
      await statusOfAsync(() => updateAgencyBranding(AGENCY_ID, { primaryColor: "#123456" })),
    ).toBe(403);
    expect(queueRegenerationMock).not.toHaveBeenCalled();
  });

  it("site configuration — a popup on a tier without popups (403)", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));

    expect(
      await statusOfAsync(() => updateSiteConfig(AGENCY_ID, { popupEnabled: true })),
    ).toBe(403);
    expect(queueRegenerationMock).not.toHaveBeenCalled();
  });

  it("site configuration — an incoherent patch (400)", async () => {
    siteConfigFindUnique.mockResolvedValue({ updatedAt: SAVED_AT, topBarText: null });

    expect(
      await statusOfAsync(() => updateSiteConfig(AGENCY_ID, { topBarEnabled: true })),
    ).toBe(400);
    expect(queueRegenerationMock).not.toHaveBeenCalled();
  });

  it("navigation — a custom menu on a tier without one (403)", async () => {
    agencyFindUnique.mockResolvedValue(agencyOnTier("SMALL"));

    expect(
      await statusOfAsync(() =>
        updateNavigation(AGENCY_ID, {
          items: [{ label: "Treks", linkType: "INTERNAL", url: "/packages" }],
        }),
      ),
    ).toBe(403);
    expect(queueRegenerationMock).not.toHaveBeenCalled();
  });

  it("any screen — an empty patch (400)", async () => {
    expect(await statusOfAsync(() => updateSiteConfig(AGENCY_ID, {}))).toBe(400);
    expect(await statusOfAsync(() => updateNavigation(AGENCY_ID, {}))).toBe(400);
    expect(await statusOfAsync(() => updateAgencyBranding(AGENCY_ID, {}))).toBe(400);

    expect(queueRegenerationMock).not.toHaveBeenCalled();
  });

  it("any screen — an agency that does not exist (404)", async () => {
    agencyFindUnique.mockResolvedValue(null);

    expect(
      await statusOfAsync(() => updateAgencyBranding(AGENCY_ID, { brandName: "X" })),
    ).toBe(404);
    expect(queueRegenerationMock).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the offline package service.
 *
 * `@funtush/database` is replaced with hand-written spies, so these run with no
 * Postgres and no network. What they assert is the behaviour the mobile app
 * actually depends on: that the version only moves when content moves, that the
 * bundle is complete, and that nobody can read a booking that is not theirs.
 */

const bookingFindUnique = vi.fn();
const bookingUpdate = vi.fn();
const trekkerFindUnique = vi.fn();
const guideProfileFindFirst = vi.fn();
const agencyUserFindFirst = vi.fn();

vi.mock("@funtush/database", () => ({
  db: {
    booking: {
      findUnique: (...a: unknown[]) => bookingFindUnique(...a),
      update: (...a: unknown[]) => bookingUpdate(...a),
    },
    trekker: { findUnique: (...a: unknown[]) => trekkerFindUnique(...a) },
    guideProfile: { findFirst: (...a: unknown[]) => guideProfileFindFirst(...a) },
    agencyUser: { findFirst: (...a: unknown[]) => agencyUserFindFirst(...a) },
  },
}));

import {
  stableStringify,
  contentHash,
  toStringList,
  resolveVersion,
  assertOfflinePackageAccess,
  loadGuideContact,
  mapOfflinePackage,
  buildOfflinePackage,
  getOfflinePackageVersion,
  httpError,
  OFFLINE_PACKAGE_STATUSES,
  DEFAULT_COUNTRY_CODE,
  type OfflineBookingRow,
  type OfflinePackage,
} from "./offlinePackage.service";

/** A fixed "now" so every date and timestamp assertion is deterministic. */
const NOW = new Date("2026-07-28T09:30:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  bookingUpdate.mockResolvedValue({ offlinePackageVersion: 2 });
  guideProfileFindFirst.mockResolvedValue(null);
  agencyUserFindFirst.mockResolvedValue(null);
  trekkerFindUnique.mockResolvedValue(null);
});

/* ── fixtures ────────────────────────────────────────────────────────────── */

/** A fully-populated booking row, with per-test overrides. */
function makeRow(overrides: Partial<OfflineBookingRow> = {}): OfflineBookingRow {
  return {
    id: "booking-1",
    agencyId: "agency-1",
    trekkerId: "trekker-1",
    packageId: "package-1",
    status: "PAID",
    groupSize: 4,
    totalPrice: "1200.50",
    trekkerName: "Asha Rai",
    trekkerEmail: "asha@example.com",
    trekkerPhone: "+9779800000001",
    specialRequests: "Vegetarian meals",
    assignedGuideId: "guide-ref-1",
    offlinePackageVersion: 1,
    offlinePackageHash: null,
    offlinePackageUpdatedAt: null,
    departureDate: { startDate: new Date("2026-08-01T00:00:00.000Z") },
    branch: { name: "Pokhara Branch", phone: "+97761000000" },
    trekker: { emergencyContactName: "Bina Rai", emergencyContactPhone: "+9779800000002" },
    package: {
      id: "package-1",
      title: "Everest Base Camp",
      slug: "everest-base-camp",
      description: "Classic EBC trek.",
      difficulty: "CHALLENGING",
      durationDays: 3,
      countryCode: "NP",
      itineraries: [
        {
          dayNumber: 1,
          location: "Lukla",
          altitudeM: 2860,
          description: "L".repeat(400),
          photos: ["https://cdn.example.com/lukla.webp"],
        },
        { dayNumber: 2, location: "Namche", altitudeM: 3440, description: "Acclimatise.", photos: [] },
        { dayNumber: 3, location: "Tengboche", altitudeM: 3860, description: null, photos: [] },
      ],
      packingItems: [
        { category: "Clothing", item: "Down jacket", quantity: "1", isEssential: true, sortOrder: 0 },
        { category: "Gear", item: "Headtorch", quantity: "1", isEssential: false, sortOrder: 1 },
      ],
    },
    agency: {
      id: "agency-1",
      name: "Himalaya Treks",
      profile: { phone: ["+97714000000"], email: "ops@himalaya.example", address: "Thamel" },
      emergencyContacts: [
        {
          label: "Ops desk (24/7)",
          phone: "+97714000001",
          altPhone: null,
          type: "AGENCY_DESK",
          notes: null,
        },
      ],
    },
    ...overrides,
  };
}

const TREKKER_ACTOR = { userId: "user-1", role: "TREKKER" };
const ADMIN_ACTOR = { userId: "user-2", role: "AGENCY_ADMIN", agencyId: "agency-1" };
const GUIDE_ACTOR = { userId: "user-3", role: "GUIDE", agencyId: "agency-1" };

/* ── stableStringify ─────────────────────────────────────────────────────── */

describe("stableStringify", () => {
  it("produces the same string regardless of object key order", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it("keeps array order, because an itinerary is ordered data", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("sorts keys inside nested objects too", () => {
    expect(stableStringify({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it("handles null and primitives", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify("x")).toBe('"x"');
    expect(stableStringify(7)).toBe("7");
  });
});

/* ── contentHash ─────────────────────────────────────────────────────────── */

describe("contentHash", () => {
  const base = mapOfflinePackage(makeRow(), null, NOW);

  it("ignores version, generatedAt and contentUpdatedAt", () => {
    const later: OfflinePackage = {
      ...base,
      version: 99,
      generatedAt: "2030-01-01T00:00:00.000Z",
      contentUpdatedAt: "2030-01-01T00:00:00.000Z",
    };
    expect(contentHash(later)).toBe(contentHash(base));
  });

  it("changes when any real content changes", () => {
    const edited: OfflinePackage = { ...base, trek: { ...base.trek, title: "Annapurna Circuit" } };
    expect(contentHash(edited)).not.toBe(contentHash(base));
  });

  it("notices a single edited packing-list item", () => {
    const edited: OfflinePackage = {
      ...base,
      packingList: [{ ...base.packingList[0]!, quantity: "2" }, base.packingList[1]!],
    };
    expect(contentHash(edited)).not.toBe(contentHash(base));
  });

  it("is a 64-character hex sha-256 digest", () => {
    expect(contentHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

/* ── toStringList ────────────────────────────────────────────────────────── */

describe("toStringList", () => {
  it("wraps a bare string", () => {
    expect(toStringList("+9771")).toEqual(["+9771"]);
  });

  it("keeps an array of strings and drops the blanks", () => {
    expect(toStringList(["+9771", "", "  ", "+9772"])).toEqual(["+9771", "+9772"]);
  });

  it("takes the string values out of an object", () => {
    expect(toStringList({ primary: "+9771", secondary: "+9772", verified: true })).toEqual([
      "+9771",
      "+9772",
    ]);
  });

  it("returns an empty array for null/undefined/other", () => {
    expect(toStringList(null)).toEqual([]);
    expect(toStringList(undefined)).toEqual([]);
    expect(toStringList(42)).toEqual([]);
  });
});

/* ── resolveVersion ──────────────────────────────────────────────────────── */

describe("resolveVersion", () => {
  it("does not write at all when the hash is unchanged", async () => {
    const result = await resolveVersion("booking-1", 5, "abc", new Date("2026-07-01"), "abc", NOW);

    expect(bookingUpdate).not.toHaveBeenCalled();
    expect(result.version).toBe(5);
    expect(result.contentUpdatedAt).toEqual(new Date("2026-07-01"));
  });

  it("stores the first hash without inventing a version bump", async () => {
    const result = await resolveVersion("booking-1", 1, null, null, "abc", NOW);

    expect(result.version).toBe(1);
    expect(result.contentUpdatedAt).toBe(NOW);

    const arg = bookingUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.offlinePackageHash).toBe("abc");
    // No `increment` on the first fingerprint.
    expect(arg.data.offlinePackageVersion).toBeUndefined();
  });

  it("increments atomically when the hash differs", async () => {
    bookingUpdate.mockResolvedValue({ offlinePackageVersion: 6 });

    const result = await resolveVersion("booking-1", 5, "old", new Date("2026-07-01"), "new", NOW);

    expect(result.version).toBe(6);
    expect(result.contentUpdatedAt).toBe(NOW);

    const arg = bookingUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    // `{ increment: 1 }` is an atomic `x = x + 1` in SQL, not a read-then-write.
    expect(arg.data.offlinePackageVersion).toEqual({ increment: 1 });
    expect(arg.data.offlinePackageHash).toBe("new");
  });
});

/* ── access control ──────────────────────────────────────────────────────── */

describe("assertOfflinePackageAccess", () => {
  const row = makeRow();

  it("lets the owning trekker through", async () => {
    trekkerFindUnique.mockResolvedValue({ id: "trekker-1" });
    await expect(assertOfflinePackageAccess(row, TREKKER_ACTOR)).resolves.toBeUndefined();
  });

  it("404s another trekker rather than admitting the booking exists", async () => {
    trekkerFindUnique.mockResolvedValue({ id: "trekker-999" });
    await expect(assertOfflinePackageAccess(row, TREKKER_ACTOR)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("404s a trekker token with no trekker profile", async () => {
    trekkerFindUnique.mockResolvedValue(null);
    await expect(assertOfflinePackageAccess(row, TREKKER_ACTOR)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("404s a tenant token scoped to a different agency — the §4 isolation rule", async () => {
    await expect(
      assertOfflinePackageAccess(row, { ...ADMIN_ACTOR, agencyId: "agency-2" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("404s a tenant token with no agency at all", async () => {
    await expect(
      assertOfflinePackageAccess(row, { userId: "user-2", role: "AGENCY_ADMIN" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("lets an agency admin read any booking in their own agency", async () => {
    await expect(assertOfflinePackageAccess(row, ADMIN_ACTOR)).resolves.toBeUndefined();
    // Admins skip the guide lookup entirely.
    expect(agencyUserFindFirst).not.toHaveBeenCalled();
  });

  it("lets an agency moderator read any booking in their own agency", async () => {
    await expect(
      assertOfflinePackageAccess(row, { ...ADMIN_ACTOR, role: "AGENCY_MODERATOR" })
    ).resolves.toBeUndefined();
  });

  it("lets the assigned guide through when the id matches their AgencyUser id", async () => {
    agencyUserFindFirst.mockResolvedValue({ id: "guide-ref-1", agencyStaffs: [] });
    await expect(assertOfflinePackageAccess(row, GUIDE_ACTOR)).resolves.toBeUndefined();
  });

  it("403s a guide from the same agency who is not assigned to this trek", async () => {
    agencyUserFindFirst.mockResolvedValue({ id: "someone-else", agencyStaffs: [] });
    await expect(assertOfflinePackageAccess(row, GUIDE_ACTOR)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("403s a guide when the trek has no guide assigned yet", async () => {
    agencyUserFindFirst.mockResolvedValue({ id: "guide-ref-1", agencyStaffs: [] });
    await expect(
      assertOfflinePackageAccess({ ...row, assignedGuideId: null }, GUIDE_ACTOR)
    ).rejects.toMatchObject({ status: 403 });
  });
});

/* ── guide contact ───────────────────────────────────────────────────────── */

describe("loadGuideContact", () => {
  it("returns null without querying when no guide is assigned", async () => {
    expect(await loadGuideContact("agency-1", null)).toBeNull();
    expect(guideProfileFindFirst).not.toHaveBeenCalled();
  });

  it("returns null — not an error — when the guide has no profile row", async () => {
    guideProfileFindFirst.mockResolvedValue(null);
    expect(await loadGuideContact("agency-1", "guide-ref-1")).toBeNull();
  });

  it("scopes the lookup by agency so a shared id cannot cross tenants", async () => {
    guideProfileFindFirst.mockResolvedValue({
      fullName: "Pemba Sherpa",
      phone: "+9779811111111",
      altPhone: null,
      satellitePhone: "+8821600000",
      languages: ["en", "ne"],
    });

    const contact = await loadGuideContact("agency-1", "guide-ref-1");

    expect(contact).toEqual({
      name: "Pemba Sherpa",
      phone: "+9779811111111",
      altPhone: null,
      satellitePhone: "+8821600000",
      languages: ["en", "ne"],
    });

    const where = (guideProfileFindFirst.mock.calls[0]![0] as { where: Record<string, unknown> })
      .where;
    expect(where).toMatchObject({ agencyId: "agency-1", guideRef: "guide-ref-1", isActive: true });
  });
});

/* ── payload shape ───────────────────────────────────────────────────────── */

describe("mapOfflinePackage", () => {
  const pkg = mapOfflinePackage(makeRow(), null, NOW);

  it("computes the trek's end date from duration, inclusive of day 1", () => {
    // 3-day trek starting 2026-08-01 ends 2026-08-03, not 08-04.
    expect(pkg.trek.startDate).toBe("2026-08-01");
    expect(pkg.trek.endDate).toBe("2026-08-03");
  });

  it("keeps itinerary descriptions in full — there is no 'tap for more' offline", () => {
    expect(pkg.itinerary[0]!.description).toHaveLength(400);
    expect(pkg.itinerary[0]!.description).not.toContain("…");
  });

  it("includes photo URLs so the app can pre-download them", () => {
    expect(pkg.itinerary[0]!.photos).toEqual(["https://cdn.example.com/lukla.webp"]);
    expect(pkg.itinerary[1]!.photos).toEqual([]);
  });

  it("carries every itinerary day, in order", () => {
    expect(pkg.itinerary.map((d) => d.dayNumber)).toEqual([1, 2, 3]);
  });

  it("flattens the packing list and renames isEssential → essential", () => {
    expect(pkg.packingList).toEqual([
      { category: "Clothing", item: "Down jacket", quantity: "1", essential: true },
      { category: "Gear", item: "Headtorch", quantity: "1", essential: false },
    ]);
  });

  it("normalises the agency's Json phone/email columns into string arrays", () => {
    expect(pkg.agency.phones).toEqual(["+97714000000"]);
    expect(pkg.agency.emails).toEqual(["ops@himalaya.example"]);
  });

  it("converts the Decimal total price into a plain number", () => {
    expect(pkg.booking.totalPrice).toBe(1200.5);
  });

  it("bundles the agency emergency contacts and the trekker's next of kin", () => {
    expect(pkg.emergency.contacts).toHaveLength(1);
    expect(pkg.emergency.contacts[0]!.label).toBe("Ops desk (24/7)");
    expect(pkg.emergency.trekkerEmergencyContact).toEqual({
      name: "Bina Rai",
      phone: "+9779800000002",
    });
  });

  it("omits the next-of-kin block when only half of it is filled in", () => {
    const partial = mapOfflinePackage(
      makeRow({ trekker: { emergencyContactName: "Bina Rai", emergencyContactPhone: null } }),
      null,
      NOW
    );
    expect(partial.emergency.trekkerEmergencyContact).toBeNull();
  });

  it("exposes the country code so the app can pick its bundled national numbers", () => {
    expect(pkg.emergency.countryCode).toBe("NP");
  });

  it("falls back to the default country when the package has none", () => {
    const row = makeRow();
    const noCountry = mapOfflinePackage(
      { ...row, package: { ...row.package!, countryCode: null } },
      null,
      NOW
    );
    expect(noCountry.trek.countryCode).toBe(DEFAULT_COUNTRY_CODE);
  });

  it("includes the guide card when one was resolved", () => {
    const withGuide = mapOfflinePackage(
      makeRow(),
      {
        name: "Pemba Sherpa",
        phone: "+9779811111111",
        altPhone: null,
        satellitePhone: null,
        languages: [],
      },
      NOW
    );
    expect(withGuide.guide?.name).toBe("Pemba Sherpa");
  });

  it("stamps generatedAt from the injected clock", () => {
    expect(pkg.generatedAt).toBe("2026-07-28T09:30:00.000Z");
  });
});

/* ── the endpoint's service entry point ──────────────────────────────────── */

describe("buildOfflinePackage", () => {
  it("404s an unknown booking id", async () => {
    bookingFindUnique.mockResolvedValue(null);
    await expect(buildOfflinePackage("nope", ADMIN_ACTOR, NOW)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("409s a booking that has not been confirmed yet", async () => {
    bookingFindUnique.mockResolvedValue(makeRow({ status: "INQUIRY" }));
    await expect(buildOfflinePackage("booking-1", ADMIN_ACTOR, NOW)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("serves every status that counts as confirmed-or-later", async () => {
    for (const status of OFFLINE_PACKAGE_STATUSES) {
      vi.clearAllMocks();
      guideProfileFindFirst.mockResolvedValue(null);
      bookingUpdate.mockResolvedValue({ offlinePackageVersion: 2 });
      bookingFindUnique.mockResolvedValue(makeRow({ status }));

      const pkg = await buildOfflinePackage("booking-1", ADMIN_ACTOR, NOW);
      expect(pkg.status).toBe(status);
    }
  });

  it("authorises before disclosing anything about the booking", async () => {
    bookingFindUnique.mockResolvedValue(makeRow());
    trekkerFindUnique.mockResolvedValue({ id: "some-other-trekker" });

    await expect(buildOfflinePackage("booking-1", TREKKER_ACTOR, NOW)).rejects.toMatchObject({
      status: 404,
    });
    // Rejected before we ever went looking for the guide's phone number.
    expect(guideProfileFindFirst).not.toHaveBeenCalled();
  });

  it("stores the first fingerprint and keeps the version at 1", async () => {
    bookingFindUnique.mockResolvedValue(makeRow());

    const pkg = await buildOfflinePackage("booking-1", ADMIN_ACTOR, NOW);

    expect(pkg.version).toBe(1);
    expect(pkg.contentUpdatedAt).toBe("2026-07-28T09:30:00.000Z");
  });

  it("does not touch the database when the content is unchanged", async () => {
    // Fingerprint the bundle exactly as the service would, then feed it back.
    const stored = contentHash(mapOfflinePackage(makeRow(), null, NOW));
    bookingFindUnique.mockResolvedValue(
      makeRow({
        offlinePackageVersion: 4,
        offlinePackageHash: stored,
        offlinePackageUpdatedAt: new Date("2026-07-20T00:00:00.000Z"),
      })
    );

    const pkg = await buildOfflinePackage("booking-1", ADMIN_ACTOR, NOW);

    expect(pkg.version).toBe(4);
    expect(bookingUpdate).not.toHaveBeenCalled();
  });

  it("bumps the version when the itinerary was edited behind our back", async () => {
    bookingUpdate.mockResolvedValue({ offlinePackageVersion: 5 });
    bookingFindUnique.mockResolvedValue(
      makeRow({
        offlinePackageVersion: 4,
        offlinePackageHash: "a-hash-from-before-the-edit",
        offlinePackageUpdatedAt: new Date("2026-07-20T00:00:00.000Z"),
      })
    );

    const pkg = await buildOfflinePackage("booking-1", ADMIN_ACTOR, NOW);

    expect(pkg.version).toBe(5);
    expect(bookingUpdate).toHaveBeenCalledTimes(1);
  });

  it("bumps the version when the guide's phone number changes", async () => {
    const withOldGuide = contentHash(
      mapOfflinePackage(
        makeRow(),
        { name: "Pemba", phone: "+111", altPhone: null, satellitePhone: null, languages: [] },
        NOW
      )
    );
    guideProfileFindFirst.mockResolvedValue({
      fullName: "Pemba",
      phone: "+222", // the number was corrected
      altPhone: null,
      satellitePhone: null,
      languages: [],
    });
    bookingUpdate.mockResolvedValue({ offlinePackageVersion: 3 });
    bookingFindUnique.mockResolvedValue(
      makeRow({ offlinePackageVersion: 2, offlinePackageHash: withOldGuide })
    );

    const pkg = await buildOfflinePackage("booking-1", ADMIN_ACTOR, NOW);

    expect(pkg.guide?.phone).toBe("+222");
    expect(pkg.version).toBe(3);
  });
});

/* ── the cheap probe ─────────────────────────────────────────────────────── */

describe("getOfflinePackageVersion", () => {
  it("returns just the counter, without loading the trek", async () => {
    bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      agencyId: "agency-1",
      trekkerId: "trekker-1",
      assignedGuideId: "guide-ref-1",
      status: "PAID",
      offlinePackageVersion: 7,
      offlinePackageUpdatedAt: new Date("2026-07-25T00:00:00.000Z"),
    });

    const result = await getOfflinePackageVersion("booking-1", ADMIN_ACTOR);

    expect(result).toEqual({
      bookingId: "booking-1",
      version: 7,
      contentUpdatedAt: "2026-07-25T00:00:00.000Z",
      status: "PAID",
    });

    // The `select` must stay narrow — that is the whole point of this endpoint.
    const select = (bookingFindUnique.mock.calls[0]![0] as { select: Record<string, unknown> })
      .select;
    expect(select.package).toBeUndefined();
    expect(select.agency).toBeUndefined();
  });

  it("applies the same access rules as the full bundle", async () => {
    bookingFindUnique.mockResolvedValue({
      id: "booking-1",
      agencyId: "agency-1",
      trekkerId: "trekker-1",
      assignedGuideId: null,
      status: "PAID",
      offlinePackageVersion: 7,
      offlinePackageUpdatedAt: null,
    });

    await expect(
      getOfflinePackageVersion("booking-1", { ...ADMIN_ACTOR, agencyId: "agency-2" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("404s an unknown booking", async () => {
    bookingFindUnique.mockResolvedValue(null);
    await expect(getOfflinePackageVersion("nope", ADMIN_ACTOR)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("httpError", () => {
  it("attaches the status the controller will send", () => {
    const err = httpError(409, "nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(409);
    expect(err.message).toBe("nope");
  });
});

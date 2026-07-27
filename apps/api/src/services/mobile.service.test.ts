import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the mobile dashboard service.
 *
 * `@funtush/database` is replaced with hand-written spies, so these tests run
 * with no Postgres, no Redis and no network — they assert on the *shape* of the
 * queries we send and the *shape* of the payload we return, which is exactly
 * what "mobile-optimized" means here.
 */

const trekkerFindUnique = vi.fn();
const bookingGroupBy = vi.fn();
const bookingFindMany = vi.fn();
const agencyUserFindFirst = vi.fn();
const itineraryFindMany = vi.fn();

vi.mock("@funtush/database", () => ({
  db: {
    trekker: { findUnique: (...a: unknown[]) => trekkerFindUnique(...a) },
    booking: {
      groupBy: (...a: unknown[]) => bookingGroupBy(...a),
      findMany: (...a: unknown[]) => bookingFindMany(...a),
    },
    agencyUser: { findFirst: (...a: unknown[]) => agencyUserFindFirst(...a) },
    trekItinerary: { findMany: (...a: unknown[]) => itineraryFindMany(...a) },
  },
}));

import {
  parseSection,
  toDateOnly,
  startOfUtcDay,
  addDays,
  daysBetween,
  trekEndDate,
  truncate,
  toNumber,
  countsFromStatusGroups,
  mapTrekkerTrek,
  mapGuideTrek,
  resolveGuideIdentity,
  getTrekkerDashboard,
  getGuideDashboard,
  SECTION_STATUSES,
  TODAY_ITINERARY_CAP,
  type TrekkerTrekRow,
  type GuideTrekRow,
} from "./mobile.service";
import { parsePagination } from "../utils/pagination";

/** A fixed "now" so every date assertion is deterministic. */
const NOW = new Date("2026-07-27T09:30:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  bookingGroupBy.mockResolvedValue([]);
  bookingFindMany.mockResolvedValue([]);
  itineraryFindMany.mockResolvedValue([]);
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

describe("parseSection", () => {
  it("defaults to upcoming when absent or empty", () => {
    expect(parseSection(undefined)).toBe("upcoming");
    expect(parseSection("")).toBe("upcoming");
  });

  it("accepts the three known sections", () => {
    expect(parseSection("upcoming")).toBe("upcoming");
    expect(parseSection("active")).toBe("active");
    expect(parseSection("completed")).toBe("completed");
  });

  it("returns null for anything else so the route can send a 400", () => {
    expect(parseSection("cancelled")).toBeNull();
    expect(parseSection(7)).toBeNull();
  });
});

describe("date helpers", () => {
  it("renders a date as YYYY-MM-DD", () => {
    expect(toDateOnly(NOW)).toBe("2026-07-27");
  });

  it("snaps to midnight UTC", () => {
    expect(startOfUtcDay(NOW).toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("shifts by whole days in both directions", () => {
    expect(toDateOnly(addDays(NOW, 3))).toBe("2026-07-30");
    expect(toDateOnly(addDays(NOW, -3))).toBe("2026-07-24");
  });

  it("counts whole days between two instants regardless of time of day", () => {
    expect(daysBetween(NOW, new Date("2026-08-01T23:59:00.000Z"))).toBe(5);
    expect(daysBetween(NOW, new Date("2026-07-25T00:01:00.000Z"))).toBe(-2);
  });

  it("makes a 5-day trek end on day 5, not day 6", () => {
    expect(toDateOnly(trekEndDate(new Date("2026-08-01T00:00:00.000Z"), 5))).toBe("2026-08-05");
  });

  it("treats a zero/absent duration as a single day", () => {
    expect(toDateOnly(trekEndDate(new Date("2026-08-01T00:00:00.000Z"), 0))).toBe("2026-08-01");
  });
});

describe("truncate", () => {
  it("returns null for empty input", () => {
    expect(truncate(null)).toBeNull();
    expect(truncate("")).toBeNull();
  });

  it("leaves short text untouched", () => {
    expect(truncate("Trek to Namche", 140)).toBe("Trek to Namche");
  });

  it("cuts long text and marks it with an ellipsis", () => {
    const result = truncate("a".repeat(300), 20);
    expect(result).toHaveLength(20);
    expect(result?.endsWith("…")).toBe(true);
  });
});

describe("toNumber", () => {
  it("unwraps Prisma Decimal-like values", () => {
    expect(toNumber("1700.50")).toBe(1700.5);
    expect(toNumber({ toString: () => "42" })).toBe(42);
  });

  it("falls back to 0 for unparseable values", () => {
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("not-a-number")).toBe(0);
  });
});

describe("countsFromStatusGroups", () => {
  it("folds per-status counts into the three sections", () => {
    expect(
      countsFromStatusGroups([
        { status: "PENDING", _count: { _all: 2 } },
        { status: "PAID", _count: { _all: 1 } },
        { status: "ACTIVE", _count: { _all: 1 } },
        { status: "COMPLETED", _count: { _all: 4 } },
      ])
    ).toEqual({ upcoming: 3, active: 1, completed: 4 });
  });

  it("ignores dead bookings (cancelled / rejected)", () => {
    expect(
      countsFromStatusGroups([
        { status: "CANCELLED", _count: { _all: 9 } },
        { status: "REJECTED", _count: { _all: 3 } },
      ])
    ).toEqual({ upcoming: 0, active: 0, completed: 0 });
  });
});

/* ── mappers: the actual "slim payload" contract ─────────────────────────── */

const trekkerRow: TrekkerTrekRow = {
  id: "booking-1",
  status: "CONFIRMED",
  groupSize: 4,
  totalPrice: "1700.00",
  package: { title: "Everest Base Camp", slug: "everest-base-camp", durationDays: 12 },
  agency: { name: "Himalaya Treks" },
  departureDate: { startDate: new Date("2026-08-08T00:00:00.000Z") },
};

describe("mapTrekkerTrek", () => {
  it("produces a flat card with computed dates", () => {
    expect(mapTrekkerTrek(trekkerRow, NOW)).toEqual({
      bookingId: "booking-1",
      status: "CONFIRMED",
      packageTitle: "Everest Base Camp",
      packageSlug: "everest-base-camp",
      agencyName: "Himalaya Treks",
      startDate: "2026-08-08",
      endDate: "2026-08-19",
      durationDays: 12,
      groupSize: 4,
      totalPrice: 1700,
      daysUntilStart: 12,
    });
  });

  it("stays flat — no nested objects survive into the payload", () => {
    const card = mapTrekkerTrek(trekkerRow, NOW) as unknown as Record<string, unknown>;
    for (const value of Object.values(card)) {
      expect(typeof value === "object" && value !== null).toBe(false);
    }
  });

  it("survives missing relations without throwing", () => {
    const card = mapTrekkerTrek(
      { ...trekkerRow, package: null, agency: null, departureDate: null },
      NOW
    );
    expect(card.packageTitle).toBe("");
    expect(card.agencyName).toBe("");
    expect(card.startDate).toBe("2026-07-27");
  });
});

const guideRow: GuideTrekRow = {
  id: "booking-9",
  status: "ACTIVE",
  groupSize: 6,
  trekkerName: "John Doe",
  trekkerPhone: "+9779800000000",
  packageId: "pkg-1",
  package: { title: "Annapurna Circuit", durationDays: 10 },
  departureDate: { startDate: new Date("2026-07-25T00:00:00.000Z") },
};

describe("mapGuideTrek", () => {
  it("includes the trekker's contact details a guide needs in the field", () => {
    expect(mapGuideTrek(guideRow, NOW)).toEqual({
      bookingId: "booking-9",
      status: "ACTIVE",
      packageTitle: "Annapurna Circuit",
      startDate: "2026-07-25",
      endDate: "2026-08-03",
      durationDays: 10,
      groupSize: 6,
      trekkerName: "John Doe",
      trekkerPhone: "+9779800000000",
      daysUntilStart: -2,
    });
  });
});

/* ── trekker dashboard ───────────────────────────────────────────────────── */

describe("getTrekkerDashboard", () => {
  it("404s when the user has no trekker profile", async () => {
    trekkerFindUnique.mockResolvedValue(null);

    await expect(
      getTrekkerDashboard("user-1", "upcoming", parsePagination({}), NOW)
    ).rejects.toMatchObject({ status: 404 });
  });

  it("scopes every query to the trekker and returns counts + a page", async () => {
    trekkerFindUnique.mockResolvedValue({ id: "trekker-1" });
    bookingGroupBy.mockResolvedValue([
      { status: "CONFIRMED", _count: { _all: 2 } },
      { status: "COMPLETED", _count: { _all: 5 } },
    ]);
    bookingFindMany.mockResolvedValue([trekkerRow]);

    const result = await getTrekkerDashboard(
      "user-1",
      "upcoming",
      parsePagination({ page: "1", limit: "10" }),
      NOW
    );

    expect(trekkerFindUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { id: true },
    });

    const findManyArgs = bookingFindMany.mock.calls[0][0];
    expect(findManyArgs.where.trekkerId).toBe("trekker-1");
    expect(findManyArgs.where.status.in).toEqual([...SECTION_STATUSES.upcoming]);
    expect(findManyArgs.skip).toBe(0);
    expect(findManyArgs.take).toBe(10);
    // A `select` (not `include`) is what keeps the payload slim.
    expect(findManyArgs.select).toBeDefined();
    expect(findManyArgs.include).toBeUndefined();

    expect(result.counts).toEqual({ upcoming: 2, active: 0, completed: 5 });
    expect(result.meta).toEqual({ total: 2, page: 1, limit: 10, pages: 1 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].bookingId).toBe("booking-1");
  });

  it("sorts completed treks newest-first and upcoming treks soonest-first", async () => {
    trekkerFindUnique.mockResolvedValue({ id: "trekker-1" });

    await getTrekkerDashboard("user-1", "completed", parsePagination({}), NOW);
    expect(bookingFindMany.mock.calls[0][0].orderBy).toEqual({
      departureDate: { startDate: "desc" },
    });

    vi.clearAllMocks();
    trekkerFindUnique.mockResolvedValue({ id: "trekker-1" });
    bookingGroupBy.mockResolvedValue([]);
    bookingFindMany.mockResolvedValue([]);

    await getTrekkerDashboard("user-1", "upcoming", parsePagination({}), NOW);
    expect(bookingFindMany.mock.calls[0][0].orderBy).toEqual({
      departureDate: { startDate: "asc" },
    });
  });

  it("applies skip/take from the pagination request", async () => {
    trekkerFindUnique.mockResolvedValue({ id: "trekker-1" });

    await getTrekkerDashboard("user-1", "upcoming", parsePagination({ page: "3", limit: "5" }), NOW);

    expect(bookingFindMany.mock.calls[0][0]).toMatchObject({ skip: 10, take: 5 });
  });
});

/* ── guide identity + dashboard ──────────────────────────────────────────── */

describe("resolveGuideIdentity", () => {
  it("collects the user, agency-user and staff ids as match candidates", async () => {
    agencyUserFindFirst.mockResolvedValue({
      id: "agency-user-1",
      agencyStaffs: [{ id: "staff-1" }],
    });

    const identity = await resolveGuideIdentity("user-7", "agency-1");

    expect(agencyUserFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-7", agencyId: "agency-1" } })
    );
    expect(identity.candidateIds).toEqual(["user-7", "agency-user-1", "staff-1"]);
  });

  it("still returns the user id when there is no staff record", async () => {
    agencyUserFindFirst.mockResolvedValue({ id: "agency-user-1", agencyStaffs: [] });

    const identity = await resolveGuideIdentity("user-7", "agency-1");
    expect(identity.staffId).toBeNull();
    expect(identity.candidateIds).toEqual(["user-7", "agency-user-1"]);
  });
});

describe("getGuideDashboard", () => {
  it("scopes bookings to the agency AND the guide's own ids", async () => {
    agencyUserFindFirst.mockResolvedValue({
      id: "agency-user-1",
      agencyStaffs: [{ id: "staff-1" }],
    });
    bookingGroupBy.mockResolvedValue([{ status: "ACTIVE", _count: { _all: 1 } }]);
    bookingFindMany.mockResolvedValue([guideRow]);

    const result = await getGuideDashboard(
      "user-7",
      "agency-1",
      "active",
      parsePagination({}),
      NOW
    );

    // Every booking query carries the tenant id — the §4 isolation rule.
    for (const call of bookingFindMany.mock.calls) {
      expect(call[0].where.agencyId).toBe("agency-1");
      expect(call[0].where.assignedGuideId.in).toEqual(["user-7", "agency-user-1", "staff-1"]);
    }
    expect(bookingGroupBy.mock.calls[0][0].where.agencyId).toBe("agency-1");

    expect(result.counts).toEqual({ upcoming: 0, active: 1, completed: 0 });
    expect(result.data[0].bookingId).toBe("booking-9");
    expect(result.today.date).toBe("2026-07-27");
  });

  it("returns an empty dashboard (not an error) for a user with no guide identity", async () => {
    agencyUserFindFirst.mockResolvedValue(null);

    const result = await getGuideDashboard(
      "user-7",
      "agency-1",
      "upcoming",
      parsePagination({}),
      NOW
    );

    expect(result.data).toEqual([]);
    expect(result.counts).toEqual({ upcoming: 0, active: 0, completed: 0 });
    expect(result.today.itinerary).toEqual([]);
    // No booking query is ever issued without a resolved identity.
    expect(bookingFindMany).not.toHaveBeenCalled();
  });

  it("resolves today's itinerary day from the trek start date", async () => {
    agencyUserFindFirst.mockResolvedValue({ id: "agency-user-1", agencyStaffs: [] });
    bookingGroupBy.mockResolvedValue([]);
    // Two callers of findMany: the paginated list, then today's in-field treks.
    bookingFindMany.mockResolvedValue([guideRow]);
    itineraryFindMany.mockResolvedValue([
      {
        packageId: "pkg-1",
        dayNumber: 3,
        location: "Namche Bazaar",
        altitudeM: 3440,
        description: "x".repeat(400),
      },
    ]);

    const result = await getGuideDashboard(
      "user-7",
      "agency-1",
      "active",
      parsePagination({}),
      NOW
    );

    // Trek started 2026-07-25, today is 2026-07-27 → day 3 of 10.
    expect(itineraryFindMany.mock.calls[0][0].where.OR).toEqual([
      { packageId: "pkg-1", dayNumber: 3 },
    ]);

    expect(result.today.total).toBe(1);
    expect(result.today.itinerary[0]).toMatchObject({
      bookingId: "booking-9",
      dayNumber: 3,
      totalDays: 10,
      location: "Namche Bazaar",
      altitudeM: 3440,
      trekkerPhone: "+9779800000000",
    });
    // The long description is truncated, and photos are never fetched at all.
    expect(result.today.itinerary[0].note).toHaveLength(140);
    expect(result.today.itinerary[0]).not.toHaveProperty("photos");
  });

  it("drops treks whose itinerary has already ended", async () => {
    agencyUserFindFirst.mockResolvedValue({ id: "agency-user-1", agencyStaffs: [] });
    bookingFindMany.mockResolvedValue([
      {
        ...guideRow,
        // 2-day trek that started 20 days ago → day 21 of 2, i.e. finished.
        package: { title: "Short Hike", durationDays: 2 },
        departureDate: { startDate: new Date("2026-07-07T00:00:00.000Z") },
      },
    ]);

    const result = await getGuideDashboard(
      "user-7",
      "agency-1",
      "active",
      parsePagination({}),
      NOW
    );

    expect(result.today.itinerary).toEqual([]);
    // No itinerary lookup is needed when nothing is running today.
    expect(itineraryFindMany).not.toHaveBeenCalled();
  });

  it("caps today's itinerary query so the payload can never grow unbounded", async () => {
    agencyUserFindFirst.mockResolvedValue({ id: "agency-user-1", agencyStaffs: [] });

    await getGuideDashboard("user-7", "agency-1", "active", parsePagination({}), NOW);

    const todayCall = bookingFindMany.mock.calls.find((c) => c[0].take === TODAY_ITINERARY_CAP);
    expect(todayCall).toBeDefined();
  });
});

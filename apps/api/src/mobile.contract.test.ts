import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ── Mobile API contract tests (Mobile week · Day 5) ──────────────────────────
 *
 * Days 1–4 each shipped their own unit tests, and those check that each function
 * behaves. This file checks something different and, for a mobile backend, more
 * important: that the three **promises** the mobile API makes to the app are
 * actually kept, end to end.
 *
 *   1. **The offline package contains everything the offline itinerary screen
 *      needs.** Not "the function returns an object" — that a phone with the
 *      radio switched off can draw the whole screen from what it cached.
 *   2. **Device registration, refresh and removal work as one lifecycle.** Not
 *      three isolated calls against three separate mocks, but the real sequence
 *      an app performs across a login, eight app launches and a logout.
 *   3. **Mobile dashboard payloads are meaningfully smaller than the web ones.**
 *      The `/mobile` namespace only earns its existence if it is measurably
 *      lighter than the endpoints it sits beside. This suite measures it.
 *
 * These are "contract" tests rather than unit tests: they are written from the
 * app's point of view and will fail if a future refactor quietly drops a field,
 * even if every individual function still passes its own tests. That is exactly
 * the failure mode a mobile backend has — the server is fine, the phone is not.
 */

/* ── One shared in-memory stand-in for Postgres ──────────────────────────── */

/**
 * `vi.mock` is hoisted above the imports, so the spies it uses have to be
 * created inside `vi.hoisted`. Everything the three suites touch lives here;
 * each `describe` block configures the handful of methods it cares about.
 */
const dbMock = vi.hoisted(() => ({
  booking: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  trekker: { findUnique: vi.fn() },
  guideProfile: { findFirst: vi.fn() },
  agencyUser: { findFirst: vi.fn() },
  trekItinerary: { findMany: vi.fn() },
  deviceToken: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock("@funtush/database", () => ({ db: dbMock }));

import { buildOfflinePackage, DEFAULT_COUNTRY_CODE } from "./services/offlinePackage.service";
import type { OfflinePackage } from "./services/offlinePackage.service";
import {
  registerDeviceToken,
  unregisterDeviceToken,
  listUserDeviceTokens,
  MAX_DEVICES_PER_USER,
} from "./services/deviceToken.service";
import { mapTrekkerTrek, mapGuideTrek, getTrekkerDashboard } from "./services/mobile.service";
import type { TrekkerTrekRow, GuideTrekRow } from "./services/mobile.service";
import { DEFAULT_EMERGENCY_COUNTRY } from "./data/emergencyNumbers";
import { findCountryEmergencyNumbers } from "./services/emergencyNumbers.service";

/* ── Shared helpers ──────────────────────────────────────────────────────── */

/** Fixed clock, so every date in this file is reproducible. */
const NOW = new Date("2026-08-06T08:00:00.000Z");

/** How many days the fixture trek runs — used to check itinerary completeness. */
const DURATION_DAYS = 12;

/**
 * Walk a dotted path like `"emergency.contacts.0.phone"` into a nested object.
 * Returns the special `MISSING` marker rather than `undefined` so the assertion
 * can tell "the key is absent" apart from "the key holds `undefined`".
 */
const MISSING = Symbol("missing");

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;

  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return MISSING;
    const container = current as Record<string, unknown>;
    if (!(segment in container)) return MISSING;
    current = container[segment];
  }

  return current;
}

/**
 * Every place `undefined` appears anywhere inside a value.
 *
 * This matters far more on mobile than it looks. `JSON.stringify` **deletes**
 * keys whose value is `undefined` — `{ phone: undefined }` serialises to `{}`.
 * So a field that is `undefined` on the server does not arrive as an empty field
 * on the phone; it does not arrive at all, and the app's `booking.guide.phone`
 * throws instead of rendering "not set". `null` survives the round trip and is
 * therefore the only correct way to say "no value".
 */
function undefinedPaths(value: unknown, path = "$"): string[] {
  if (value === undefined) return [path];
  if (value === null || typeof value !== "object") return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry, i) => undefinedPaths(entry, `${path}.${i}`));
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
    undefinedPaths(entry, `${path}.${key}`)
  );
}

/** Bytes this value takes on the wire, as UTF-8 JSON. */
function wireBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ════════════════════════════════════════════════════════════════════════════
   1. The offline package contains everything the offline itinerary view needs
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * A fully-populated booking row, shaped exactly like `OFFLINE_BOOKING_SELECT`
 * produces.
 *
 * Deliberately *complete*: the point of this suite is to prove that when the
 * data exists, all of it reaches the phone. A separate test below strips the
 * optional parts back out to prove the bundle degrades gracefully instead of
 * throwing.
 *
 * `description` is long on purpose — it is what the "descriptions are not
 * truncated" assertion measures against.
 */
function fullBookingRow() {
  const longDescription =
    "Trek from Namche Bazaar to Tengboche. The trail drops to the Dudh Kosi at " +
    "Phunki Tenga before a long, steady climb through rhododendron forest to the " +
    "monastery at 3,867 m. Expect four to five hours of walking. Drink at every " +
    "opportunity and let the porters set the pace on the climb — this is the day " +
    "most altitude headaches begin, and slowing down here is what prevents them.";

  return {
    id: "booking-1",
    agencyId: "agency-1",
    trekkerId: "trekker-1",
    packageId: "package-1",
    status: "PAID",
    groupSize: 4,
    totalPrice: "185000.00",
    trekkerName: "Asha Gurung",
    trekkerEmail: "asha@example.com",
    trekkerPhone: "+9779800000001",
    specialRequests: "Vegetarian meals for two.",
    assignedGuideId: "agency-user-9",
    offlinePackageVersion: 3,
    // `null` means "never fingerprinted", so `resolveVersion` records the hash
    // without inventing a version bump — see `offlinePackage.service.ts`.
    offlinePackageHash: null,
    offlinePackageUpdatedAt: null,

    departureDate: { startDate: new Date("2026-09-01T00:00:00.000Z") },
    branch: { name: "Thamel Office", phone: "+97714700000" },
    trekker: {
      emergencyContactName: "Bina Gurung",
      emergencyContactPhone: "+9779800000002",
    },

    package: {
      id: "package-1",
      title: "Everest Base Camp Trek",
      slug: "everest-base-camp-trek",
      description: "Classic 12-day trek to the foot of Everest via Namche and Tengboche.",
      difficulty: "CHALLENGING",
      durationDays: DURATION_DAYS,
      countryCode: "NP",
      // One itinerary row per trek day — the completeness check below counts them.
      itineraries: Array.from({ length: DURATION_DAYS }, (_, i) => ({
        dayNumber: i + 1,
        location: `Stage ${i + 1}`,
        altitudeM: 2800 + i * 150,
        description: longDescription,
        photos: [
          `https://cdn.funtush.com/treks/ebc/day-${i + 1}-1280.webp`,
          `https://cdn.funtush.com/treks/ebc/day-${i + 1}-640.webp`,
        ],
      })),
      packingItems: [
        {
          category: "Clothing",
          item: "Down jacket (-20°C rated)",
          quantity: "1",
          isEssential: true,
          sortOrder: 0,
        },
        {
          category: "Documents",
          item: "TIMS card + Sagarmatha permit",
          quantity: "1 each",
          isEssential: true,
          sortOrder: 0,
        },
        {
          category: "Gear",
          item: "Headtorch",
          quantity: "1 + spare batteries",
          isEssential: false,
          sortOrder: 1,
        },
      ],
    },

    agency: {
      id: "agency-1",
      name: "Himalaya Trails",
      profile: {
        phone: ["+97714500000", "+9779801111111"],
        email: "ops@himalayatrails.com",
        address: "Thamel Marg, Kathmandu",
      },
      emergencyContacts: [
        {
          label: "Ops desk (24/7)",
          phone: "+9779801111111",
          altPhone: "+97714500000",
          type: "AGENCY_DESK",
          notes: "Ask for the duty manager.",
        },
        {
          label: "Simrik Air rescue",
          phone: "+9779801234567",
          altPhone: null,
          type: "RESCUE",
          notes: null,
        },
      ],
    },
  };
}

/** The guide contact `loadGuideContact` resolves for the fixture booking. */
const GUIDE_PROFILE = {
  fullName: "Pemba Sherpa",
  phone: "+9779802222222",
  altPhone: "+9779803333333",
  satellitePhone: "+8821612345678",
  languages: ["Nepali", "English", "Sherpa"],
};

/** The verified caller — the trekker whose booking this is. */
const TREKKER_ACTOR = { userId: "user-1", role: "TREKKER" };

/**
 * Every field the offline itinerary screen reads.
 *
 * This list *is* the contract. It was written by walking the screens the app
 * renders with no connection — the trek header, the day-by-day itinerary, the
 * packing list, the "who do I call" panel — and writing down what each one
 * needs. If a future change to `OFFLINE_BOOKING_SELECT` drops a column, this
 * list is what notices.
 *
 * Split into two, because "must be present" and "must have a value" are
 * different promises. `specialRequests` may legitimately be `null`; the guide's
 * phone number may not be, when a guide is assigned.
 */
const OFFLINE_KEYS_THAT_MUST_EXIST = [
  "bookingId",
  "version",
  "generatedAt",
  "contentUpdatedAt",
  "status",
  "trek.packageId",
  "trek.title",
  "trek.slug",
  "trek.difficulty",
  "trek.durationDays",
  "trek.startDate",
  "trek.endDate",
  "trek.countryCode",
  "trek.description",
  "agency.agencyId",
  "agency.name",
  "agency.phones",
  "agency.emails",
  "agency.address",
  "booking.groupSize",
  "booking.totalPrice",
  "booking.trekkerName",
  "booking.trekkerEmail",
  "booking.trekkerPhone",
  "booking.specialRequests",
  "booking.branchName",
  "booking.branchPhone",
  "guide",
  "itinerary",
  "packingList",
  "emergency.countryCode",
  "emergency.contacts",
  "emergency.trekkerEmergencyContact",
];

const OFFLINE_VALUES_THAT_MUST_BE_SET = [
  "bookingId",
  "trek.title",
  "trek.startDate",
  "trek.endDate",
  "trek.countryCode",
  "agency.name",
  "booking.trekkerName",
  "booking.trekkerPhone",
  "guide.name",
  "guide.phone",
  "emergency.countryCode",
  "emergency.trekkerEmergencyContact.name",
  "emergency.trekkerEmergencyContact.phone",
];

describe("the offline package contains everything the offline itinerary view needs", () => {
  let bundle: OfflinePackage;

  beforeEach(async () => {
    dbMock.booking.findUnique.mockResolvedValue(fullBookingRow());
    dbMock.booking.update.mockResolvedValue({ offlinePackageVersion: 3 });
    dbMock.trekker.findUnique.mockResolvedValue({ id: "trekker-1" });
    dbMock.guideProfile.findFirst.mockResolvedValue(GUIDE_PROFILE);

    bundle = await buildOfflinePackage("booking-1", TREKKER_ACTOR, NOW);
  });

  it("carries every field the offline screens read", () => {
    const absent = OFFLINE_KEYS_THAT_MUST_EXIST.filter(
      (path) => readPath(bundle, path) === MISSING
    );
    expect(absent, `missing from the bundle: ${absent.join(", ")}`).toEqual([]);
  });

  it("actually fills in the fields a trekker in trouble depends on", () => {
    const empty = OFFLINE_VALUES_THAT_MUST_BE_SET.filter((path) => {
      const value = readPath(bundle, path);
      return value === MISSING || value === null || value === "";
    });
    expect(empty, `present but empty: ${empty.join(", ")}`).toEqual([]);
  });

  it("contains no `undefined`, which JSON would silently delete", () => {
    // See `undefinedPaths` above: an `undefined` field does not reach the phone
    // as an empty field, it does not reach the phone at all.
    expect(undefinedPaths(bundle)).toEqual([]);
  });

  it("survives the JSON round trip the device storage performs", () => {
    // The app does not keep the object we build — it keeps
    // `JSON.parse(await AsyncStorage.getItem(...))`. Anything that does not
    // survive that (a `Date`, a Prisma `Decimal`, a `Map`) is a field that looks
    // right in a server test and is broken on the phone.
    const roundTripped = JSON.parse(JSON.stringify(bundle));
    expect(roundTripped).toEqual(bundle);
  });

  it("uses JSON-native types only — no Decimal objects, no Date objects", () => {
    expect(typeof bundle.booking.totalPrice).toBe("number");
    expect(typeof bundle.trek.startDate).toBe("string");
    expect(typeof bundle.generatedAt).toBe("string");
  });

  it("has one itinerary entry for every day of the trek, in order", () => {
    // A gap here is a day the trekker opens the app and sees a blank screen —
    // on the day they are walking it.
    expect(bundle.itinerary).toHaveLength(DURATION_DAYS);
    expect(bundle.itinerary.map((d) => d.dayNumber)).toEqual(
      Array.from({ length: DURATION_DAYS }, (_, i) => i + 1)
    );
    expect(bundle.trek.durationDays).toBe(DURATION_DAYS);
  });

  it("keeps itinerary descriptions whole, unlike the dashboard", () => {
    // Day 1's dashboard truncates descriptions to 140 characters because the
    // trekker can always tap through for the rest. Offline there is no "tap
    // through" — this text *is* what they read at 4,000 m, so it must be intact.
    const source = fullBookingRow().package.itineraries[0]!.description;

    for (const day of bundle.itinerary) {
      expect(day.description).toBe(source);
      expect(day.description!.length).toBeGreaterThan(140);
      expect(day.description).not.toContain("…");
    }
  });

  it("includes photo URLs so the app can pre-download them while online", () => {
    for (const day of bundle.itinerary) {
      expect(day.photos.length).toBeGreaterThan(0);
      for (const url of day.photos) expect(url).toMatch(/^https:\/\//);
    }
  });

  it("carries the altitude profile, which is what altitude sickness advice needs", () => {
    for (const day of bundle.itinerary) {
      expect(typeof day.altitudeM).toBe("number");
    }
  });

  it("carries the packing list with its essential flags", () => {
    expect(bundle.packingList.length).toBeGreaterThan(0);
    for (const entry of bundle.packingList) {
      expect(entry.category).toBeTruthy();
      expect(entry.item).toBeTruthy();
      expect(typeof entry.essential).toBe("boolean");
    }
    expect(bundle.packingList.some((entry) => entry.essential)).toBe(true);
  });

  it("carries a complete 'who do I call' panel", () => {
    // Three independent ways to reach help, because in the field any one of them
    // may be the one that works: the agency's own contacts, the guide's phones,
    // and the country code that selects the bundled national numbers (Day 4).
    expect(bundle.emergency.contacts.length).toBeGreaterThan(0);
    for (const contact of bundle.emergency.contacts) {
      expect(contact.label).toBeTruthy();
      expect(contact.phone).toMatch(/^\+/); // full international form — dialable abroad
      expect(contact.type).toBeTruthy();
    }

    expect(bundle.guide?.phone).toMatch(/^\+/);
    expect(bundle.guide?.satellitePhone).toMatch(/^\+/);
    expect(bundle.guide?.languages.length).toBeGreaterThan(0);

    expect(bundle.emergency.trekkerEmergencyContact?.phone).toMatch(/^\+/);
  });

  it("names a country the Day 4 emergency table actually has numbers for", () => {
    // The join that makes SOS layer 1 work: this bundle stamps a country code,
    // and the app looks that exact code up in its bundled copy of the Day 4
    // table. If the two ever disagree, the SOS screen renders no number.
    const country = findCountryEmergencyNumbers(bundle.emergency.countryCode);

    expect(country, `no emergency numbers for ${bundle.emergency.countryCode}`).not.toBeNull();
    expect(country!.police.length + (country!.universal ? 1 : 0)).toBeGreaterThan(0);
  });

  it("agrees with the Day 4 table on which country to fall back to", () => {
    // Two constants in two files that must not drift. `offlinePackage.service`
    // decides what a country-less trek claims; `data/emergencyNumbers` decides
    // which numbers exist for that claim.
    expect(DEFAULT_EMERGENCY_COUNTRY).toBe(DEFAULT_COUNTRY_CODE);
  });

  it("is one self-contained document — the app never has to fetch anything else", () => {
    // Every id in the bundle is accompanied by the human-readable value the
    // screen renders. If any of these were id-only, the offline screen would
    // have to resolve them over a network that is not there.
    expect(bundle.trek.packageId).toBeTruthy();
    expect(bundle.trek.title).toBeTruthy(); // …not just packageId
    expect(bundle.agency.agencyId).toBeTruthy();
    expect(bundle.agency.name).toBeTruthy(); // …not just agencyId
    expect(bundle.guide?.name).toBeTruthy(); // …not just assignedGuideId
  });

  it("still produces a usable bundle when the optional parts are missing", () => {
    // Graceful degradation is the other half of the promise. A trek with no
    // guide assigned yet, no branch and no next-of-kin on file must still cache
    // its itinerary and its emergency numbers — a partial bundle beats none.
    const bare = fullBookingRow();
    bare.assignedGuideId = null as unknown as string;
    bare.branch = null as unknown as { name: string; phone: string };
    bare.specialRequests = null as unknown as string;
    bare.trekker = { emergencyContactName: null, emergencyContactPhone: null } as never;

    dbMock.booking.findUnique.mockResolvedValue(bare);
    dbMock.guideProfile.findFirst.mockResolvedValue(null);

    return buildOfflinePackage("booking-1", TREKKER_ACTOR, NOW).then((degraded) => {
      // The optional parts come back as `null`, never as a missing key.
      expect(degraded.guide).toBeNull();
      expect(degraded.booking.branchName).toBeNull();
      expect(degraded.emergency.trekkerEmergencyContact).toBeNull();
      expect(undefinedPaths(degraded)).toEqual([]);

      // …and everything that keeps a trekker safe is still there.
      expect(degraded.itinerary).toHaveLength(DURATION_DAYS);
      expect(degraded.emergency.contacts.length).toBeGreaterThan(0);
      expect(degraded.emergency.countryCode).toBe("NP");
    });
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2. Device token registration, refresh and removal
   ════════════════════════════════════════════════════════════════════════════ */

/** A row as the `device_tokens` table stores it. */
interface FakeDeviceRow {
  id: string;
  userId: string;
  fcmToken: string;
  platform: string;
  lastActiveAt: Date;
  createdAt: Date;
}

/**
 * A tiny in-memory stand-in for the `device_tokens` table.
 *
 * The Day 3 unit tests mock each Prisma call individually, which proves each
 * function calls Prisma correctly. This does the complementary thing: it keeps
 * **state** between calls, so a whole lifecycle — register, relaunch eight
 * times, swap users on a shared tablet, log out — runs against one table and the
 * assertions can be about what the table ends up holding. That is the level at
 * which "registration, refresh and removal work" is a meaningful claim.
 *
 * It implements only the four operations the service uses, and it implements
 * them the way Postgres does: `fcmToken` is UNIQUE, and `upsert` keys on it.
 */
function installFakeDeviceTable() {
  const rows: FakeDeviceRow[] = [];
  let nextId = 1;

  dbMock.deviceToken.findUnique.mockImplementation(
    ({ where }: { where: { fcmToken: string } }) =>
      Promise.resolve(rows.find((r) => r.fcmToken === where.fcmToken) ?? null)
  );

  dbMock.deviceToken.upsert.mockImplementation(
    ({
      where,
      create,
      update,
    }: {
      where: { fcmToken: string };
      create: Omit<FakeDeviceRow, "id" | "createdAt">;
      update: Partial<FakeDeviceRow>;
    }) => {
      const existing = rows.find((r) => r.fcmToken === where.fcmToken);

      if (existing) {
        // The UNIQUE index on `fcm_token` means this is an update in place —
        // including `userId`, which is what reassigns a shared device.
        Object.assign(existing, update);
        return Promise.resolve(existing);
      }

      const row: FakeDeviceRow = {
        id: `device-${nextId++}`,
        createdAt: new Date(),
        ...create,
      };
      rows.push(row);
      return Promise.resolve(row);
    }
  );

  dbMock.deviceToken.findMany.mockImplementation(({ where }: { where: { userId: string } }) =>
    Promise.resolve(
      rows
        .filter((r) => r.userId === where.userId)
        .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
    )
  );

  /**
   * Handles all three shapes the service uses:
   *   `{ fcmToken, userId }`          — logout, scoped to the caller
   *   `{ id: { in: [...] } }`         — the device-limit eviction
   *   `{ fcmToken: { in: [...] } }`   — pruning tokens Firebase called dead
   *
   * An unrecognised filter key must **not** be treated as "match everything" —
   * that would silently turn a targeted delete into a table wipe, which is
   * precisely the bug the first draft of this fake had.
   */
  dbMock.deviceToken.deleteMany.mockImplementation(
    ({
      where,
    }: {
      where: {
        id?: { in: string[] };
        fcmToken?: string | { in: string[] };
        userId?: string;
      };
    }) => {
      const matchesField = (
        filter: string | { in: string[] } | undefined,
        actual: string
      ): boolean => {
        if (filter === undefined) return true;
        return typeof filter === "string" ? actual === filter : filter.in.includes(actual);
      };

      const before = rows.length;

      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!;
        const matches =
          matchesField(where.id, row.id) &&
          matchesField(where.fcmToken, row.fcmToken) &&
          matchesField(where.userId, row.userId);

        if (matches) rows.splice(i, 1);
      }

      return Promise.resolve({ count: before - rows.length });
    }
  );

  dbMock.deviceToken.count.mockImplementation(({ where }: { where: { userId: string } }) =>
    Promise.resolve(rows.filter((r) => r.userId === where.userId).length)
  );

  return rows;
}

/** A token shaped like a real FCM one: long, no whitespace. */
const token = (suffix: string) => `fMEP0vJqS0${"a".repeat(140)}${suffix}`;

const PHONE_TOKEN = token("phone01");
const TABLET_TOKEN = token("tabl02");

describe("device token registration, refresh and removal", () => {
  let rows: FakeDeviceRow[];

  beforeEach(() => {
    rows = installFakeDeviceTable();
  });

  it("registers a phone on first launch after login", async () => {
    const result = await registerDeviceToken({
      userId: "user-1",
      fcmToken: PHONE_TOKEN,
      platform: "android", // lowercase, as React Native's `Platform.OS` gives it
    });

    expect(result.created).toBe(true);
    expect(result.platform).toBe("ANDROID"); // normalised on the way in
    expect(result.deviceCount).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe("user-1");
  });

  it("never returns the raw token, only a masked preview", async () => {
    const result = await registerDeviceToken({
      userId: "user-1",
      fcmToken: PHONE_TOKEN,
      platform: "android",
    });

    // The token is the address of somebody's phone. Leaking one lets a third
    // party spoof-target that device — the same instinct as Backend Guide §9's
    // rule about payment credentials.
    expect(JSON.stringify(result)).not.toContain(PHONE_TOKEN);
    // The last six characters and nothing else — enough for a developer to match
    // a log line to a device, useless to anyone who wants to push to it.
    expect(result.tokenPreview).toBe("…hone01");
    expect(result.tokenPreview).toHaveLength(7); // the ellipsis + 6
    // …but the real token is in the database, or push could not be delivered.
    expect(rows[0]!.fcmToken).toBe(PHONE_TOKEN);
  });

  it("refreshes on every launch without creating duplicate rows", async () => {
    await registerDeviceToken({
      userId: "user-1",
      fcmToken: PHONE_TOKEN,
      platform: "android",
    });
    const firstSeen = rows[0]!.lastActiveAt;

    // Eight more app launches with the same token, as the real app does.
    for (let i = 0; i < 8; i++) {
      const refresh = await registerDeviceToken({
        userId: "user-1",
        fcmToken: PHONE_TOKEN,
        platform: "android",
      });
      expect(refresh.created).toBe(false); // 200, not 201
    }

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("device-1"); // same row, updated in place
    expect(rows[0]!.lastActiveAt.getTime()).toBeGreaterThanOrEqual(firstSeen.getTime());
  });

  it("handles Firebase rotating the token: the new one is added, the old is stale", async () => {
    await registerDeviceToken({ userId: "user-1", fcmToken: PHONE_TOKEN, platform: "android" });
    const rotated = token("rot003");
    await registerDeviceToken({ userId: "user-1", fcmToken: rotated, platform: "android" });

    // Both rows exist — the server cannot know the old one is dead until either
    // Firebase says so (`pruneInvalidTokens`) or it goes stale (270 days). Until
    // then, sending to both is the safe behaviour: a duplicate notification is a
    // nuisance, a missed SOS alert is not.
    expect(rows).toHaveLength(2);
    const live = await listUserDeviceTokens("user-1");
    expect(live.map((t) => t.fcmToken)).toContain(rotated);
  });

  it("keeps a phone and a tablet as separate devices for the same user", async () => {
    await registerDeviceToken({ userId: "user-1", fcmToken: PHONE_TOKEN, platform: "android" });
    await registerDeviceToken({ userId: "user-1", fcmToken: TABLET_TOKEN, platform: "ios" });

    // This is the whole reason `device_tokens` replaced the single
    // `users.fcm_token` column: a guide with a phone and a work tablet must get
    // the SOS alert on both, not on whichever registered last.
    const live = await listUserDeviceTokens("user-1");
    expect(live).toHaveLength(2);
    expect(live.map((t) => t.platform).sort()).toEqual(["ANDROID", "IOS"]);
  });

  it("reassigns a shared expedition tablet instead of duplicating it", async () => {
    await registerDeviceToken({ userId: "asha", fcmToken: TABLET_TOKEN, platform: "android" });
    // Asha signs out, Bina signs in. Firebase hands the app the *same* token —
    // it is the same installation.
    await registerDeviceToken({ userId: "bina", fcmToken: TABLET_TOKEN, platform: "android" });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe("bina");
    // Asha's itinerary must not be pushed to a tablet Bina is holding.
    expect(await listUserDeviceTokens("asha")).toEqual([]);
    expect(await listUserDeviceTokens("bina")).toHaveLength(1);
  });

  it("removes the device on logout", async () => {
    await registerDeviceToken({ userId: "user-1", fcmToken: PHONE_TOKEN, platform: "android" });
    await registerDeviceToken({ userId: "user-1", fcmToken: TABLET_TOKEN, platform: "ios" });

    const result = await unregisterDeviceToken({ userId: "user-1", fcmToken: PHONE_TOKEN });

    expect(result.removed).toBe(1);
    expect(result.deviceCount).toBe(1); // the tablet is untouched
    expect(rows.map((r) => r.fcmToken)).toEqual([TABLET_TOKEN]);
  });

  it("makes logout idempotent — a second attempt is a success, not a 404", async () => {
    await registerDeviceToken({ userId: "user-1", fcmToken: PHONE_TOKEN, platform: "android" });
    await unregisterDeviceToken({ userId: "user-1", fcmToken: PHONE_TOKEN });

    // The app retried, or the row was already pruned. Logout must still succeed:
    // reporting failure would leave the app showing an error for a logout that
    // worked.
    const second = await unregisterDeviceToken({ userId: "user-1", fcmToken: PHONE_TOKEN });
    expect(second.removed).toBe(0);
    expect(second.deviceCount).toBe(0);
  });

  it("will not let one user silence another user's phone", async () => {
    await registerDeviceToken({ userId: "asha", fcmToken: PHONE_TOKEN, platform: "android" });

    // Mallory learned Asha's token somehow and posts it to her own logout.
    const attempt = await unregisterDeviceToken({ userId: "mallory", fcmToken: PHONE_TOKEN });

    expect(attempt.removed).toBe(0);
    expect(rows).toHaveLength(1);
    expect(await listUserDeviceTokens("asha")).toHaveLength(1); // still reachable for SOS
  });

  it("rejects a malformed token instead of storing something undeliverable", async () => {
    await expect(
      registerDeviceToken({ userId: "user-1", fcmToken: "too-short", platform: "android" })
    ).rejects.toThrow(/fcmToken/);

    await expect(
      registerDeviceToken({
        userId: "user-1",
        fcmToken: `${token("a")} ${token("b")}`,
        platform: "android",
      })
    ).rejects.toThrow(/fcmToken/);

    await expect(
      registerDeviceToken({ userId: "user-1", fcmToken: PHONE_TOKEN, platform: "symbian" })
    ).rejects.toThrow(/platform/);

    expect(rows).toHaveLength(0);
  });

  it("caps a runaway client at the device limit, evicting the least recently used", async () => {
    // A client bug that re-registers with a fresh token on every screen mount
    // would otherwise turn every SOS push into a broadcast to hundreds of dead
    // addresses.
    for (let i = 0; i < MAX_DEVICES_PER_USER + 5; i++) {
      const fcmToken = token(`dev${String(i).padStart(3, "0")}`);
      await registerDeviceToken({ userId: "user-1", fcmToken, platform: "android" });

      // Spread `lastActiveAt` so "least recently active" is well-defined.
      // Registrations inside one test can land on the same millisecond, and the
      // eviction order would then be arbitrary — and the test flaky.
      const row = rows.find((r) => r.fcmToken === fcmToken);
      if (row) row.lastActiveAt = new Date(NOW.getTime() + i * 1000);
    }

    expect(rows).toHaveLength(MAX_DEVICES_PER_USER);
    // The survivors are the most recently active ones: the last registration
    // stays, the first is gone.
    expect(rows.some((r) => r.fcmToken === token("dev014"))).toBe(true);
    expect(rows.some((r) => r.fcmToken === token("dev000"))).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3. Mobile dashboard payloads are meaningfully smaller than the web ones
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * The **web** response for one booking, as `getAgencyBookings` in
 * `booking.service.ts` actually produces it.
 *
 * That query uses Prisma's `include:` at the top level, which means "give me
 * every column of `Booking`" and then nests the relations on top:
 *
 * ```ts
 * include: {
 *   package: { select: { title: true, slug: true } },
 *   departureDate: { select: { startDate: true } },
 *   addOns: { include: { addOn: true } },
 * }
 * ```
 *
 * This fixture mirrors that shape field for field. It is a fixture rather than a
 * live call because the point of the comparison is the *shape* of the two
 * responses, and pinning the web shape here means this test fails loudly if
 * someone widens the web endpoint too — which is exactly when we would want to
 * re-check the mobile one.
 */
function webBookingRow() {
  return {
    id: "booking-1",
    agencyId: "agency-1",
    trekkerId: "trekker-1",
    packageId: "package-1",
    branchId: "branch-1",
    departureDateId: "departure-1",
    groupSize: 4,
    totalPrice: "185000.00",
    status: "PAID",
    trekkerName: "Asha Gurung",
    trekkerEmail: "asha@example.com",
    trekkerPhone: "+9779800000001",
    trekkerCountry: "NP",
    specialRequests: "Vegetarian meals for two.",
    rejectionReason: null,
    proposedDate: null,
    assignedGuideId: "agency-user-9",
    offlinePackageVersion: 3,
    offlinePackageHash: "9f2c1b0a8e7d6c5b4a39281706f5e4d3c2b1a09887766554433221100ffeeddcc",
    offlinePackageUpdatedAt: "2026-08-01T10:00:00.000Z",
    createdAt: "2026-06-14T09:12:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    package: { title: "Everest Base Camp Trek", slug: "everest-base-camp-trek" },
    departureDate: { startDate: "2026-09-01T00:00:00.000Z" },
    addOns: [
      {
        id: "booking-addon-1",
        bookingId: "booking-1",
        addOnId: "addon-1",
        quantity: 4,
        priceAtBooking: "12000.00",
        addOn: {
          id: "addon-1",
          packageId: "package-1",
          name: "Lukla flight",
          price: "12000.00",
          perPerson: true,
          createdAt: "2026-01-04T00:00:00.000Z",
        },
      },
      {
        id: "booking-addon-2",
        bookingId: "booking-1",
        addOnId: "addon-2",
        quantity: 2,
        priceAtBooking: "4500.00",
        addOn: {
          id: "addon-2",
          packageId: "package-1",
          name: "Sleeping bag hire",
          price: "4500.00",
          perPerson: true,
          createdAt: "2026-01-04T00:00:00.000Z",
        },
      },
    ],
  };
}

/** The same booking as the mobile trekker dashboard's `select` fetches it. */
const MOBILE_TREKKER_ROW: TrekkerTrekRow = {
  id: "booking-1",
  status: "PAID",
  groupSize: 4,
  totalPrice: "185000.00",
  package: {
    title: "Everest Base Camp Trek",
    slug: "everest-base-camp-trek",
    durationDays: DURATION_DAYS,
  },
  agency: { name: "Himalaya Trails" },
  departureDate: { startDate: new Date("2026-09-01T00:00:00.000Z") },
};

/** …and as the mobile guide dashboard's `select` fetches it. */
const MOBILE_GUIDE_ROW: GuideTrekRow = {
  id: "booking-1",
  status: "PAID",
  groupSize: 4,
  trekkerName: "Asha Gurung",
  trekkerPhone: "+9779800000001",
  packageId: "package-1",
  package: { title: "Everest Base Camp Trek", durationDays: DURATION_DAYS },
  departureDate: { startDate: new Date("2026-09-01T00:00:00.000Z") },
};

/**
 * The ceiling a mobile card must stay under, as a fraction of the web response
 * for the same booking.
 *
 * 0.45 is a threshold, not a target — the real figure is well below it (the test
 * prints both). It is set loosely on purpose: a test that asserts "exactly 31%"
 * fails every time somebody adds a legitimate field, which trains people to
 * update the number without thinking. A loose bound only fires when the mobile
 * payload has genuinely stopped being a mobile payload.
 */
const MAX_MOBILE_FRACTION = 0.45;

describe("mobile dashboard payloads are meaningfully smaller than the web equivalents", () => {
  it("a trekker card is a fraction of the web booking row", () => {
    const web = wireBytes(webBookingRow());
    const mobile = wireBytes(mapTrekkerTrek(MOBILE_TREKKER_ROW, NOW));

    // Printed so a failure tells you the actual numbers, not just "too big".
    expect(
      mobile / web,
      `mobile ${mobile}B vs web ${web}B = ${Math.round((mobile / web) * 100)}%`
    ).toBeLessThan(MAX_MOBILE_FRACTION);
  });

  it("a guide card is a fraction of the web booking row", () => {
    const web = wireBytes(webBookingRow());
    const mobile = wireBytes(mapGuideTrek(MOBILE_GUIDE_ROW, NOW));

    expect(
      mobile / web,
      `mobile ${mobile}B vs web ${web}B = ${Math.round((mobile / web) * 100)}%`
    ).toBeLessThan(MAX_MOBILE_FRACTION);
  });

  it("the gap widens across a full page, which is what a phone actually downloads", async () => {
    // One card is a curiosity; a page of ten is the request the app makes on
    // every launch, and the saving multiplies.
    dbMock.trekker.findUnique.mockResolvedValue({ id: "trekker-1" });
    dbMock.booking.groupBy.mockResolvedValue([{ status: "PAID", _count: { _all: 10 } }]);
    dbMock.booking.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        ...MOBILE_TREKKER_ROW,
        id: `booking-${i + 1}`,
      }))
    );

    const dashboard = await getTrekkerDashboard(
      "user-1",
      "upcoming",
      { page: 1, limit: 10, skip: 0, take: 10 },
      NOW
    );

    // The web equivalent: `{ bookings, total, page, limit }` with ten full rows.
    const web = wireBytes({
      bookings: Array.from({ length: 10 }, () => webBookingRow()),
      total: 10,
      page: 1,
      limit: 10,
    });
    const mobile = wireBytes(dashboard);

    expect(
      mobile / web,
      `mobile ${mobile}B vs web ${web}B = ${Math.round((mobile / web) * 100)}%`
    ).toBeLessThan(MAX_MOBILE_FRACTION);

    // …and the mobile response still does *more*: it carries the three tab
    // badge counts and a pagination envelope the web response does not have.
    expect(dashboard.counts).toEqual({ upcoming: 10, active: 0, completed: 0 });
    expect(dashboard.meta).toEqual({ total: 10, page: 1, limit: 10, pages: 1 });
  });

  it("keeps list items flat — no nested objects or arrays", () => {
    // Flatness is half of where the saving comes from, and it is also what makes
    // the app's view-model mapping a one-liner. `{"packageTitle":"…"}` beats
    // `{"package":{"title":"…","slug":"…","agency":{...}}}` on both counts.
    for (const card of [
      mapTrekkerTrek(MOBILE_TREKKER_ROW, NOW) as unknown as Record<string, unknown>,
      mapGuideTrek(MOBILE_GUIDE_ROW, NOW) as unknown as Record<string, unknown>,
    ]) {
      for (const [key, value] of Object.entries(card)) {
        expect(Array.isArray(value), `${key} is an array`).toBe(false);
        expect(
          value !== null && typeof value === "object",
          `${key} is a nested object`
        ).toBe(false);
      }
    }
  });

  it("sends dates as YYYY-MM-DD, not full ISO timestamps", () => {
    // 10 characters instead of 24, on three fields, on every card. The app only
    // renders the calendar day, so the time-of-day is bytes nobody reads.
    const card = mapTrekkerTrek(MOBILE_TREKKER_ROW, NOW);
    expect(card.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(card.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sends money as a number, not a Prisma Decimal object", () => {
    // Prisma serialises `Decimal` as an object, which both bloats the payload
    // and forces the app to parse it.
    const card = mapTrekkerTrek(MOBILE_TREKKER_ROW, NOW);
    expect(typeof card.totalPrice).toBe("number");
    expect(card.totalPrice).toBe(185000);
  });

  it("omits the internal columns the web row leaks", () => {
    // Not only smaller — narrower. None of these belong on a phone screen, and
    // two of them (the offline hash, the rejection reason) are internal state.
    const card = mapTrekkerTrek(MOBILE_TREKKER_ROW, NOW) as unknown as Record<string, unknown>;

    for (const leaked of [
      "offlinePackageHash",
      "offlinePackageVersion",
      "rejectionReason",
      "departureDateId",
      "branchId",
      "assignedGuideId",
      "trekkerEmail",
      "createdAt",
      "updatedAt",
    ]) {
      expect(card, `trekker card should not carry ${leaked}`).not.toHaveProperty(leaked);
    }
  });

  it("does NOT apply the slimming rule to the offline package — and that is correct", async () => {
    // The rule is "send exactly what the screen needs", not "send less". The
    // offline bundle is deliberately far larger than a dashboard card, because
    // it is the *only* thing the phone will have. A future refactor that
    // "optimised" it down to card size would break the feature, so the asymmetry
    // is asserted rather than left as a comment.
    dbMock.booking.findUnique.mockResolvedValue(fullBookingRow());
    dbMock.booking.update.mockResolvedValue({ offlinePackageVersion: 3 });
    dbMock.trekker.findUnique.mockResolvedValue({ id: "trekker-1" });
    dbMock.guideProfile.findFirst.mockResolvedValue(GUIDE_PROFILE);

    const bundle = await buildOfflinePackage("booking-1", TREKKER_ACTOR, NOW);

    expect(wireBytes(bundle)).toBeGreaterThan(wireBytes(mapTrekkerTrek(MOBILE_TREKKER_ROW, NOW)));
  });
});

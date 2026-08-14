import { createHash } from "node:crypto";
import { db } from "@funtush/database";
import type { BookingStatus, Prisma } from "@funtush/database";
import { resolveGuideIdentity, toDateOnly, startOfUtcDay, trekEndDate, toNumber } from "./mobile.service";
import { httpError } from "../utils/httpError";
import { stableStringify } from "../utils/stableStringify";

/**
 * ── Offline itinerary caching contract (Mobile week · Day 2) ─────────────────
 *
 * `GET /mobile/bookings/:id/offline-package` returns **one** JSON document that
 * contains everything a trekker or guide needs while the trek is running:
 * the full itinerary, the guide's contact details, the packing list and the
 * emergency numbers. The app stores it on the device at booking confirmation
 * and reads it from local storage from then on.
 *
 * Why one bundle instead of five endpoints?
 * ─────────────────────────────────────────
 * The app must be able to finish caching *before* the trekker walks out of
 * coverage. Five round-trips over a 2G link is five chances to fail halfway and
 * end up with a half-cached trek — which is exactly the situation where the
 * data matters most. One request either succeeds or fails as a whole, so the
 * device is never left in a partially-cached state.
 *
 * This is also the one place in the mobile API where nesting is correct. Day 1's
 * list endpoints are deliberately flat because they feed scrolling lists; this
 * is a document that gets written to disk once and read many times, so grouping
 * it into `trek` / `guide` / `packingList` / `emergency` makes the app's storage
 * code and this file's version fingerprint far easier to reason about.
 *
 * Versioning
 * ──────────
 * Every bundle carries an integer `version`. The app sends its cached version
 * back (as `If-None-Match`, or `?knownVersion=`) and gets a bare `304 Not
 * Modified` when nothing has changed — a few bytes instead of tens of kilobytes.
 * See `resolveVersion` below for how the counter stays honest.
 */

/* ── Which bookings get a bundle ─────────────────────────────────────────── */

/**
 * The bundle exists "at booking confirmation" onwards. Before the agency has
 * accepted the inquiry there is no trek to cache — the departure date could
 * still change, and an itinerary sitting on a phone for a trek that never
 * happens is worse than no itinerary at all.
 *
 * `COMPLETED` stays in the list so a trekker can still open their itinerary
 * after the trek (for photos, expense notes and the review they are invited to
 * write). `CANCELLED` / `REJECTED` are excluded: the app should drop that cache.
 */
export const OFFLINE_PACKAGE_STATUSES: readonly BookingStatus[] = [
  "CONFIRMED",
  "PAYMENT_PENDING",
  "PAID",
  "ACTIVE",
  "COMPLETED",
];

/** Country used when a package has no `countryCode` — Funtush launches in Nepal. */
export const DEFAULT_COUNTRY_CODE = "NP";

/**
 * Tenant roles that may read **any** booking inside their own agency.
 *
 * Backend Guide §5 gives Agency Admin full control of their agency and Agency
 * Moderator an operational subset that includes booking management, so both need
 * to be able to open a trek they are not personally guiding. Every other tenant
 * role (STAFF, GUIDE) must be the assigned guide.
 */
export const AGENCY_WIDE_ROLES: readonly string[] = ["AGENCY_ADMIN", "AGENCY_MODERATOR"];

/* ── Errors ──────────────────────────────────────────────────────────────── */

/**
 * `httpError` used to be defined here. It moved to `utils/httpError.ts` on Day 3
 * when the device-token service needed the same helper; re-exporting keeps every
 * existing `import { httpError } from "./offlinePackage.service"` working.
 */
export { httpError };
export type { HttpError } from "../utils/httpError";

/* ── Actor ───────────────────────────────────────────────────────────────── */

/** Who is asking, taken entirely from the verified JWT — never from the body. */
export interface OfflinePackageActor {
  userId: string;
  role: string;
  /** Present on tenant tokens (agency staff/guides), absent on trekker tokens. */
  agencyId?: string;
}

/* ── Payload shape ───────────────────────────────────────────────────────── */

export interface OfflineItineraryDay {
  dayNumber: number;
  location: string | null;
  altitudeM: number | null;
  /** Full text, deliberately **not** truncated — see `buildOfflinePackage`. */
  description: string | null;
  /** Image URLs the app pre-downloads while it still has a connection. */
  photos: string[];
}

export interface OfflinePackingItem {
  category: string;
  item: string;
  quantity: string | null;
  essential: boolean;
}

export interface OfflineEmergencyContact {
  label: string;
  phone: string;
  altPhone: string | null;
  type: string;
  notes: string | null;
}

export interface OfflineGuideContact {
  name: string;
  phone: string;
  altPhone: string | null;
  satellitePhone: string | null;
  languages: string[];
}

export interface OfflinePackage {
  bookingId: string;
  version: number;
  /** When this bundle was assembled (ISO-8601, UTC). */
  generatedAt: string;
  /** When the *content* last changed — null until the first version bump. */
  contentUpdatedAt: string | null;
  status: string;

  trek: {
    packageId: string;
    title: string;
    slug: string;
    difficulty: string;
    durationDays: number;
    startDate: string;
    endDate: string;
    countryCode: string;
    description: string | null;
  };

  agency: {
    agencyId: string;
    name: string;
    phones: string[];
    emails: string[];
    address: string | null;
  };

  booking: {
    groupSize: number;
    totalPrice: number;
    trekkerName: string;
    trekkerEmail: string;
    trekkerPhone: string;
    specialRequests: string | null;
    branchName: string | null;
    branchPhone: string | null;
  };

  guide: OfflineGuideContact | null;
  itinerary: OfflineItineraryDay[];
  packingList: OfflinePackingItem[];

  emergency: {
    /** Tells the app which set of *bundled* national numbers to show. */
    countryCode: string;
    /** Trek-specific numbers the app could not have known in advance. */
    contacts: OfflineEmergencyContact[];
    /** The trekker's own next-of-kin, for the guide to call. */
    trekkerEmergencyContact: { name: string; phone: string } | null;
  };
}

/* ── Content fingerprinting ──────────────────────────────────────────────── */

/**
 * `JSON.stringify` with object keys sorted at every level.
 *
 * The fingerprint below must depend only on the *values* in the bundle. Plain
 * `JSON.stringify` preserves insertion order, so if a future refactor reordered
 * two `select` fields the string would change even though the data did not —
 * and every phone in the field would be told to redownload. Sorting the keys
 * removes that whole class of false positives.
 *
 * The implementation moved to `utils/stableStringify.ts` on Day 4, when the
 * emergency-number directory needed it *without* also pulling in
 * `@funtush/database` through this file. Re-exported so every existing
 * `import { stableStringify } from "./offlinePackage.service"` keeps working.
 */
export { stableStringify };

/**
 * SHA-256 of the bundle's content, as hex.
 *
 * `version`, `generatedAt` and `contentUpdatedAt` are stripped first: they change
 * on every request (or *because* of a version bump), so including them would
 * make the hash differ every time and the counter would run away.
 */
export function contentHash(pkg: OfflinePackage): string {
  const { version: _v, generatedAt: _g, contentUpdatedAt: _c, ...content } = pkg;
  return createHash("sha256").update(stableStringify(content)).digest("hex");
}

/**
 * Decide what version number this bundle should carry, and persist it.
 *
 * The naive way to implement "increments on content change" is to bump a counter
 * from every place that can edit a trek — the package editor, the itinerary
 * editor, guide assignment, the packing-list screen, the agency's emergency
 * contacts screen. That is five call sites today and an unbounded number later,
 * and the day someone forgets one, a phone in the mountains silently keeps a
 * stale itinerary. Missing a bump is a safety bug, not a caching bug.
 *
 * So we invert it: assemble the bundle, fingerprint it, and compare against the
 * fingerprint stored on the booking.
 *
 *   - **Same hash** → nothing changed. Pure read, no write, version unchanged.
 *   - **Different hash** → something, somewhere, changed. Bump by one and store
 *     the new hash.
 *   - **No hash yet** (first ever request, or a row that predates this feature)
 *     → store the hash and keep the version where it is. The app has never seen
 *     this bundle, so there is nothing to invalidate.
 *
 * This cannot miss a change, and no editor screen needs to know the offline
 * package exists.
 *
 * @returns the version to serve and when the content last changed.
 */
export async function resolveVersion(
  bookingId: string,
  currentVersion: number,
  storedHash: string | null,
  storedUpdatedAt: Date | null,
  freshHash: string,
  now: Date
): Promise<{ version: number; contentUpdatedAt: Date | null }> {
  if (storedHash === freshHash) {
    return { version: currentVersion, contentUpdatedAt: storedUpdatedAt };
  }

  // First fingerprint for this booking: record it without inventing a change.
  if (storedHash === null) {
    await db.booking.update({
      where: { id: bookingId },
      data: { offlinePackageHash: freshHash, offlinePackageUpdatedAt: now },
    });
    return { version: currentVersion, contentUpdatedAt: now };
  }

  // `increment` is an atomic UPDATE ... SET x = x + 1 in Postgres, so two
  // requests landing at once cannot both read 3 and both write 4.
  const updated = await db.booking.update({
    where: { id: bookingId },
    data: {
      offlinePackageVersion: { increment: 1 },
      offlinePackageHash: freshHash,
      offlinePackageUpdatedAt: now,
    },
    select: { offlinePackageVersion: true },
  });

  return { version: updated.offlinePackageVersion, contentUpdatedAt: now };
}

/* ── Loading the booking ─────────────────────────────────────────────────── */

/**
 * Everything the bundle needs, in one query.
 *
 * This is the opposite of Day 1's slim dashboard `select`: there we fetched as
 * little as possible, here we fetch the whole trek — because the entire point is
 * that the phone will not be able to ask again. Both are the same rule applied
 * honestly: *send exactly what the screen needs, and nothing else.*
 *
 * `satisfies Prisma.BookingSelect` rather than Day 1's `as const`: it type-checks
 * every field name against the real schema (so a typo is a compile error, not a
 * silently-missing field at runtime) while keeping the multi-key `orderBy` arrays
 * mutable, which `as const` would not.
 */
const OFFLINE_BOOKING_SELECT = {
  id: true,
  agencyId: true,
  trekkerId: true,
  packageId: true,
  status: true,
  groupSize: true,
  totalPrice: true,
  trekkerName: true,
  trekkerEmail: true,
  trekkerPhone: true,
  specialRequests: true,
  assignedGuideId: true,
  offlinePackageVersion: true,
  offlinePackageHash: true,
  offlinePackageUpdatedAt: true,

  departureDate: { select: { startDate: true } },
  branch: { select: { name: true, phone: true } },
  trekker: { select: { emergencyContactName: true, emergencyContactPhone: true } },

  package: {
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      difficulty: true,
      durationDays: true,
      countryCode: true,
      itineraries: {
        select: {
          dayNumber: true,
          location: true,
          altitudeM: true,
          description: true,
          photos: true,
        },
        orderBy: { dayNumber: "asc" },
      },
      packingItems: {
        select: { category: true, item: true, quantity: true, isEssential: true, sortOrder: true },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { item: "asc" }],
      },
    },
  },

  agency: {
    select: {
      id: true,
      name: true,
      profile: { select: { phone: true, email: true, address: true } },
      emergencyContacts: {
        where: { isActive: true },
        select: { label: true, phone: true, altPhone: true, type: true, notes: true },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      },
    },
  },
} satisfies Prisma.BookingSelect;

/** The row shape `OFFLINE_BOOKING_SELECT` produces. */
export interface OfflineBookingRow {
  id: string;
  agencyId: string;
  trekkerId: string | null;
  packageId: string;
  status: string;
  groupSize: number;
  totalPrice: unknown;
  trekkerName: string;
  trekkerEmail: string;
  trekkerPhone: string;
  specialRequests: string | null;
  assignedGuideId: string | null;
  offlinePackageVersion: number;
  offlinePackageHash: string | null;
  offlinePackageUpdatedAt: Date | null;
  departureDate: { startDate: Date } | null;
  branch: { name: string; phone: string } | null;
  trekker: { emergencyContactName: string | null; emergencyContactPhone: string | null } | null;
  package: {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    difficulty: string;
    durationDays: number;
    countryCode: string | null;
    itineraries: {
      dayNumber: number;
      location: string | null;
      altitudeM: number | null;
      description: string | null;
      photos: string[];
    }[];
    packingItems: {
      category: string;
      item: string;
      quantity: string | null;
      isEssential: boolean;
      sortOrder: number;
    }[];
  } | null;
  agency: {
    id: string;
    name: string;
    profile: { phone: unknown; email: unknown; address: string | null } | null;
    emergencyContacts: {
      label: string;
      phone: string;
      altPhone: string | null;
      type: string;
      notes: string | null;
    }[];
  } | null;
}

/**
 * `AgencyProfile.phone` and `.email` are `Json?` columns, so they may hold a
 * bare string, an array, or `null` depending on which screen wrote them. The app
 * wants a predictable `string[]`, so normalise here rather than making every
 * client handle three shapes.
 */
export function toStringList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return value.trim() === "" ? [] : [value.trim()];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
  }
  // An object like `{ primary: "…", secondary: "…" }` — take its string values.
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .map((v) => v.trim());
  }
  return [];
}

/* ── Access control ──────────────────────────────────────────────────────── */

/**
 * Decide whether `actor` may read this booking's offline package.
 *
 * Two completely separate paths, matching the two role levels in Backend Guide
 * §5. Throws an `HttpError`; returns nothing on success.
 *
 *   **Trekker** — identity is platform-level, so there is no agency to compare.
 *   We resolve their `Trekker.id` from the JWT's `User.id` and require it to
 *   equal `booking.trekkerId`. A trekker can hold exactly their own bookings.
 *
 *   **Tenant (agency admin / staff / guide)** — the token must be scoped to the
 *   *booking's own* agency. This single comparison is the tenant-isolation rule
 *   from Backend Guide §4; without it, a valid guide token from agency A could
 *   read agency B's trek by guessing a booking id. Beyond that:
 *     - an `AGENCY_WIDE_ROLES` role may read any booking in that agency.
 *     - everyone else must be the guide actually assigned to this trek. A guide
 *       has no business reading a colleague's trekker's phone number.
 */
export async function assertOfflinePackageAccess(
  booking: Pick<OfflineBookingRow, "id" | "agencyId" | "trekkerId" | "assignedGuideId">,
  actor: OfflinePackageActor
): Promise<void> {
  if (actor.role === "TREKKER") {
    const trekker = await db.trekker.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });

    // 404, not 403: telling a stranger "this booking exists but is not yours"
    // leaks that the id is real. Unknown and not-yours look identical.
    if (!trekker || trekker.id !== booking.trekkerId) {
      throw httpError(404, "Booking not found");
    }
    return;
  }

  if (!actor.agencyId || actor.agencyId !== booking.agencyId) {
    throw httpError(404, "Booking not found");
  }

  if (AGENCY_WIDE_ROLES.includes(actor.role)) return;

  const identity = await resolveGuideIdentity(actor.userId, booking.agencyId);
  const isAssignedGuide =
    booking.assignedGuideId !== null && identity.candidateIds.includes(booking.assignedGuideId);

  if (!isAssignedGuide) {
    throw httpError(403, "Forbidden: you are not assigned to this trek");
  }
}

/* ── Assembling the bundle ───────────────────────────────────────────────── */

/**
 * Look up the assigned guide's contact card.
 *
 * Returns `null` — never throws — when the trek has no guide yet or the guide
 * has no profile row. A missing guide phone number must not stop the trekker
 * from caching their itinerary and emergency numbers; a partial bundle beats no
 * bundle. The app renders "guide to be confirmed" and the agency desk number
 * from `emergency.contacts` remains the fallback.
 */
export async function loadGuideContact(
  agencyId: string,
  assignedGuideId: string | null
): Promise<OfflineGuideContact | null> {
  if (!assignedGuideId) return null;

  const profile = await db.guideProfile.findFirst({
    // Scoped by `agencyId` as well as `guideRef`: `guideRef` is an unconstrained
    // string, so agency-scoping is what stops a shared id from crossing tenants.
    where: { agencyId, guideRef: assignedGuideId, isActive: true },
    select: {
      fullName: true,
      phone: true,
      altPhone: true,
      satellitePhone: true,
      languages: true,
    },
  });

  if (!profile) return null;

  return {
    name: profile.fullName,
    phone: profile.phone,
    altPhone: profile.altPhone,
    satellitePhone: profile.satellitePhone,
    languages: profile.languages ?? [],
  };
}

/** Shape one loaded booking row (plus its guide) into the wire payload. */
export function mapOfflinePackage(
  row: OfflineBookingRow,
  guide: OfflineGuideContact | null,
  now: Date
): OfflinePackage {
  const pkg = row.package;
  const durationDays = pkg?.durationDays ?? 1;
  const start = row.departureDate ? startOfUtcDay(row.departureDate.startDate) : startOfUtcDay(now);
  const emergencyName = row.trekker?.emergencyContactName ?? null;
  const emergencyPhone = row.trekker?.emergencyContactPhone ?? null;
  const countryCode = pkg?.countryCode ?? DEFAULT_COUNTRY_CODE;

  return {
    bookingId: row.id,
    // Filled in by the caller once the version has been resolved.
    version: row.offlinePackageVersion,
    generatedAt: now.toISOString(),
    contentUpdatedAt: row.offlinePackageUpdatedAt?.toISOString() ?? null,
    status: row.status,

    trek: {
      packageId: row.packageId,
      title: pkg?.title ?? "",
      slug: pkg?.slug ?? "",
      difficulty: pkg?.difficulty ?? "",
      durationDays,
      startDate: toDateOnly(start),
      endDate: toDateOnly(trekEndDate(start, durationDays)),
      countryCode,
      description: pkg?.description ?? null,
    },

    agency: {
      agencyId: row.agencyId,
      name: row.agency?.name ?? "",
      phones: toStringList(row.agency?.profile?.phone),
      emails: toStringList(row.agency?.profile?.email),
      address: row.agency?.profile?.address ?? null,
    },

    booking: {
      groupSize: row.groupSize,
      totalPrice: toNumber(row.totalPrice),
      trekkerName: row.trekkerName,
      trekkerEmail: row.trekkerEmail,
      trekkerPhone: row.trekkerPhone,
      specialRequests: row.specialRequests,
      branchName: row.branch?.name ?? null,
      branchPhone: row.branch?.phone ?? null,
    },

    guide,

    // Full descriptions, unlike the dashboard's `truncate(…, 140)`. On the
    // dashboard the trekker can always tap through for the rest; here there is
    // no "tap through" — this text *is* the itinerary they will read at 4,000 m.
    itinerary: (pkg?.itineraries ?? []).map((day) => ({
      dayNumber: day.dayNumber,
      location: day.location,
      altitudeM: day.altitudeM,
      description: day.description,
      // Photo URLs are included on purpose: the app pre-downloads them into its
      // image cache while it still has a connection.
      photos: day.photos ?? [],
    })),

    packingList: (pkg?.packingItems ?? []).map((entry) => ({
      category: entry.category,
      item: entry.item,
      quantity: entry.quantity,
      essential: entry.isEssential,
    })),

    emergency: {
      countryCode,
      contacts: (row.agency?.emergencyContacts ?? []).map((contact) => ({
        label: contact.label,
        phone: contact.phone,
        altPhone: contact.altPhone,
        type: contact.type,
        notes: contact.notes,
      })),
      trekkerEmergencyContact:
        emergencyName && emergencyPhone ? { name: emergencyName, phone: emergencyPhone } : null,
    },
  };
}

/**
 * `GET /mobile/bookings/:id/offline-package` — build (or rebuild) the bundle.
 *
 * @param bookingId from the URL.
 * @param actor     the verified caller.
 * @param now       injectable clock so tests are deterministic.
 */
export async function buildOfflinePackage(
  bookingId: string,
  actor: OfflinePackageActor,
  now: Date = new Date()
): Promise<OfflinePackage> {
  const row = (await db.booking.findUnique({
    where: { id: bookingId },
    select: OFFLINE_BOOKING_SELECT,
  })) as unknown as OfflineBookingRow | null;

  if (!row) throw httpError(404, "Booking not found");

  // Authorise before revealing anything about the booking.
  await assertOfflinePackageAccess(row, actor);

  if (!(OFFLINE_PACKAGE_STATUSES as readonly string[]).includes(row.status)) {
    throw httpError(
      409,
      `Offline package is only available once a booking is confirmed (current status: ${row.status})`
    );
  }

  const guide = await loadGuideContact(row.agencyId, row.assignedGuideId);
  const draft = mapOfflinePackage(row, guide, now);

  const { version, contentUpdatedAt } = await resolveVersion(
    row.id,
    row.offlinePackageVersion,
    row.offlinePackageHash,
    row.offlinePackageUpdatedAt,
    contentHash(draft),
    now
  );

  return { ...draft, version, contentUpdatedAt: contentUpdatedAt?.toISOString() ?? null };
}

/* ── The cheap "do I need to refetch?" check ─────────────────────────────── */

export interface OfflinePackageVersion {
  bookingId: string;
  version: number;
  contentUpdatedAt: string | null;
  status: string;
}

/**
 * `GET /mobile/bookings/:id/offline-package/version` — the version and nothing else.
 *
 * The app calls this on every launch and only refetches the full bundle when the
 * number is higher than its cached one. The response is ~100 bytes against tens
 * of kilobytes, which on a metered Himalayan SIM is the difference between a
 * check the app can afford to do often and one it cannot.
 *
 * It deliberately does **not** recompute the fingerprint: that would mean
 * loading the whole trek on every poll, which defeats the purpose. The counter
 * only moves when someone actually fetches the bundle — and the only reader that
 * matters, the app, always fetches the bundle right after seeing a higher
 * number. See the doc for the one edge case this leaves.
 */
export async function getOfflinePackageVersion(
  bookingId: string,
  actor: OfflinePackageActor
): Promise<OfflinePackageVersion> {
  const row = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      agencyId: true,
      trekkerId: true,
      assignedGuideId: true,
      status: true,
      offlinePackageVersion: true,
      offlinePackageUpdatedAt: true,
    },
  });

  if (!row) throw httpError(404, "Booking not found");

  await assertOfflinePackageAccess(row, actor);

  return {
    bookingId: row.id,
    version: row.offlinePackageVersion,
    contentUpdatedAt: row.offlinePackageUpdatedAt?.toISOString() ?? null,
    status: row.status,
  };
}

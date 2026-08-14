import { db } from "@funtush/database";
import { httpError } from "../test/utils/httpError";

/**
 * ── Push token & device management (Mobile week · Day 3) ─────────────────────
 *
 * Firebase Cloud Messaging does not deliver to "a user". It delivers to a
 * **registration token** — an opaque string Firebase hands to one specific app
 * installation on one specific phone. Push therefore only works if the server
 * keeps an accurate, current list of those tokens.
 *
 * That list is what this file owns. Two operations, both driven by the app:
 *
 *   POST   /mobile/register-device   → "here is my token, keep it current"
 *   DELETE /mobile/register-device   → "I logged out, stop pushing to me"
 *
 * Why it needs its own table
 * ──────────────────────────
 * `users.fcm_token` already exists — a single nullable column. It cannot express
 * the normal case: one account, several devices. A guide with a phone and a
 * work tablet gets the SOS alert on whichever device happened to register last,
 * and silence on the other. Backend Guide §10 says an SOS must never fail
 * silently, so "whichever device registered last" is not an acceptable answer.
 * One row per device fixes that.
 *
 * The three rules that make this correct
 * ──────────────────────────────────────
 * 1. **The token is the identity of the device, not of the user.** So the upsert
 *    is keyed on the token, and re-registering an existing token *reassigns* it
 *    to whoever is logged in now. See `registerDeviceToken`.
 * 2. **A token is never returned to a client.** It is the address of somebody's
 *    phone; leaking one lets a third party spoof-target that device. Responses
 *    carry a masked preview only — the same instinct as Backend Guide §9's rule
 *    about payment credentials.
 * 3. **Unregistering is idempotent.** Logout must succeed even if the token was
 *    already gone, so a delete that matches nothing is a success, not a 404.
 */

/* ── Platform ────────────────────────────────────────────────────────────── */

/**
 * The values the `DevicePlatform` enum accepts, as plain strings.
 *
 * Duplicated here rather than imported from `@funtush/database` on purpose: the
 * unit tests mock that package away entirely, and a test suite that cannot see
 * the list of valid platforms cannot test the validator that rejects bad ones.
 */
export const DEVICE_PLATFORMS = ["ANDROID", "IOS", "WEB"] as const;

export type DevicePlatformValue = (typeof DEVICE_PLATFORMS)[number];

/**
 * How many devices one account may keep registered.
 *
 * There is no legitimate user with 200 phones, but there is a client bug that
 * re-registers on every screen mount, and an attacker who calls this endpoint in
 * a loop. Either way the cost lands on the *send* path: every SOS push would
 * then fan out to hundreds of dead tokens. Capping the list keeps a bad client
 * from turning into a slow broadcast storm. Ten covers phone + tablet + a few
 * reinstalls with room to spare.
 */
export const MAX_DEVICES_PER_USER = 10;

/**
 * How long a token may sit untouched before a cleanup job may drop it.
 *
 * 270 days is Firebase's own threshold — it marks tokens inactive for that long
 * as stale and stops delivering to them. Matching it means our table says the
 * same thing Firebase's does.
 */
export const STALE_TOKEN_DAYS = 270;

/**
 * Accept what a phone actually sends and normalise it to the enum.
 *
 * React Native's `Platform.OS` returns lowercase `"ios"` / `"android"`, so the
 * app would have to remember to uppercase it. Being liberal here (trim, then
 * uppercase) removes an entire category of "why is my device not registering"
 * support ticket, while still storing exactly one canonical spelling.
 *
 * Returns `null` — not a thrown error — because "is this valid?" and "what HTTP
 * status does invalid deserve?" are different questions, and only the caller
 * knows the second one.
 */
export function normalizePlatform(raw: unknown): DevicePlatformValue | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase();
  // `.includes` on a `readonly [...]` tuple is typed to only accept its own
  // members, so widen to `readonly string[]` before asking the question.
  return (DEVICE_PLATFORMS as readonly string[]).includes(upper)
    ? (upper as DevicePlatformValue)
    : null;
}

/* ── Token validation ────────────────────────────────────────────────────── */

/**
 * Bounds for a plausible FCM registration token.
 *
 * Real tokens are ~150–200 characters today, but Firebase has changed that
 * format twice and never promised a length. So this is a sanity check, not a
 * format check: reject the empty string and reject anything so large it is
 * clearly an attempt to stuff the column, and let Firebase itself be the judge
 * of whether a well-formed-looking token is real.
 */
export const MIN_TOKEN_LENGTH = 20;
export const MAX_TOKEN_LENGTH = 4096;

/**
 * Normalise and sanity-check a registration token.
 *
 * Whitespace is rejected rather than stripped. A token arriving with a space in
 * the middle means the client mangled it — silently "fixing" it would store a
 * token that looks fine but that Firebase will never deliver to, and the failure
 * would surface days later as "push doesn't work on my phone". Better to say so
 * at registration time. Leading/trailing whitespace *is* trimmed, because that
 * is a copy-paste artefact rather than corruption.
 */
export function normalizeFcmToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  if (/\s/.test(token)) return null;
  return token;
}

/**
 * A safe, loggable stand-in for a token: `…a1b2c3`.
 *
 * Enough for a developer to match a log line against a device, useless to anyone
 * who wants to push to it. This is what goes in API responses and console output;
 * the full token never leaves the database.
 */
export function maskToken(token: string): string {
  return `…${token.slice(-6)}`;
}

/* ── Shapes ──────────────────────────────────────────────────────────────── */

/** What `registerDeviceToken` needs. `userId` always comes from the JWT. */
export interface RegisterDeviceInput {
  userId: string;
  fcmToken: unknown;
  platform: unknown;
}

/** What the app gets back. Note: no token, only a masked preview. */
export interface RegisteredDevice {
  deviceId: string;
  platform: DevicePlatformValue;
  tokenPreview: string;
  lastActiveAt: string;
  /** `true` on first registration, `false` when an existing token was refreshed. */
  created: boolean;
  /** How many devices this account has registered after the call. */
  deviceCount: number;
}

/** A token row as the push sender wants it. */
export interface DeviceTokenRecord {
  fcmToken: string;
  platform: DevicePlatformValue;
}

/* ── Register ────────────────────────────────────────────────────────────── */

/**
 * Register a device, or refresh one that is already registered.
 *
 * The app calls this on **every launch**, not just at login. Firebase rotates
 * tokens on its own schedule (app reinstall, app data cleared, restore from
 * backup, or just Firebase deciding to), and a rotated token that we never hear
 * about is a phone that has silently stopped receiving SOS alerts. Re-sending
 * the same token every launch is cheap; discovering a dead token during an
 * emergency is not.
 *
 * ### Why `upsert` keyed on the token
 *
 * Consider a shared expedition tablet. Asha signs in, registers token `T`. She
 * signs out; Bina signs in. Firebase hands the app the *same* `T` — it is the
 * same installation. Three things could happen:
 *
 * - Insert a second row → `T` is now on both users' lists, and Asha's private
 *   itinerary is pushed to a tablet Bina is holding. **Wrong.**
 * - Reject as duplicate → Bina never gets push. **Wrong.**
 * - Move the row to Bina → correct, and what the unique index on `fcm_token`
 *   plus this upsert gives us for free.
 *
 * `update` therefore sets `userId` as well as `platform` and `lastActiveAt`.
 * That single line is the whole reassignment behaviour.
 */
export async function registerDeviceToken(
  input: RegisterDeviceInput
): Promise<RegisteredDevice> {
  const { userId } = input;
  if (!userId) throw httpError(401, "Unauthorized");

  const fcmToken = normalizeFcmToken(input.fcmToken);
  if (!fcmToken) {
    throw httpError(
      400,
      `fcmToken is required and must be ${MIN_TOKEN_LENGTH}–${MAX_TOKEN_LENGTH} characters with no whitespace`
    );
  }

  const platform = normalizePlatform(input.platform);
  if (!platform) {
    throw httpError(400, `platform must be one of: ${DEVICE_PLATFORMS.join(", ")}`);
  }

  const now = new Date();

  // Read first, purely so the response can say whether this was a new device.
  // It is *not* a check-then-act race: the write below is a single atomic
  // upsert, so two launches racing each other still end with exactly one row.
  // The worst case is a `created: true` that should have been `false`, which is
  // a cosmetic field in a response body.
  const existing = await db.deviceToken.findUnique({
    where: { fcmToken },
    select: { id: true },
  });

  const device = await db.deviceToken.upsert({
    where: { fcmToken },
    create: { userId, fcmToken, platform, lastActiveAt: now },
    // `userId` is updated on purpose — see the shared-tablet case above.
    update: { userId, platform, lastActiveAt: now },
    select: { id: true, platform: true, lastActiveAt: true },
  });

  const deviceCount = await enforceDeviceLimit(userId);

  return {
    deviceId: device.id,
    platform: device.platform as DevicePlatformValue,
    tokenPreview: maskToken(fcmToken),
    lastActiveAt: device.lastActiveAt.toISOString(),
    created: existing === null,
    deviceCount,
  };
}

/**
 * Keep a user's device list at or below `MAX_DEVICES_PER_USER`, dropping the
 * least recently active rows first.
 *
 * Least-recently-active is the right thing to evict because `lastActiveAt` is
 * refreshed on every app launch: the row that has not been touched in longest is
 * the phone that was traded in, not the one in the user's pocket.
 *
 * Returns the device count *after* trimming, so the caller can report it.
 */
export async function enforceDeviceLimit(userId: string): Promise<number> {
  const devices = await db.deviceToken.findMany({
    where: { userId },
    // Newest activity first, so everything past index `MAX - 1` is the tail we
    // want to drop. Ties broken by `createdAt` so the order is deterministic —
    // otherwise Postgres may return rows in any order and the eviction would be
    // arbitrary (and the test flaky).
    orderBy: [{ lastActiveAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });

  if (devices.length <= MAX_DEVICES_PER_USER) return devices.length;

  const doomed = devices.slice(MAX_DEVICES_PER_USER).map((d) => d.id);
  await db.deviceToken.deleteMany({ where: { id: { in: doomed } } });

  return MAX_DEVICES_PER_USER;
}

/* ── Unregister ──────────────────────────────────────────────────────────── */

/** What `unregisterDeviceToken` needs. `userId` always comes from the JWT. */
export interface UnregisterDeviceInput {
  userId: string;
  fcmToken: unknown;
}

export interface UnregisterResult {
  /** How many rows were actually deleted: 1 normally, 0 if already gone. */
  removed: number;
  /** Devices this account still has registered. */
  deviceCount: number;
}

/**
 * Unregister a device on logout.
 *
 * ### Why the delete is scoped to `userId` as well as the token
 *
 * `deleteMany({ where: { fcmToken, userId } })` — not `delete({ where: {
 * fcmToken } })`. The token is a bearer-ish string: anyone who learns another
 * person's token could otherwise post it here and silence that person's phone,
 * including for SOS alerts. Requiring the row to *also* belong to the caller
 * turns that into a no-op. It costs nothing, because the only client that
 * legitimately knows a token is the device it belongs to.
 *
 * ### Why a miss is not a 404
 *
 * Logout has to succeed. The token may already be gone — the user logged out on
 * another device, a cleanup job pruned it, or the app is retrying a request that
 * actually succeeded the first time. Reporting failure would leave the app
 * showing a logout error for a logout that worked. So we return `removed: 0` and
 * let the caller decide whether it cares (it does not).
 */
export async function unregisterDeviceToken(
  input: UnregisterDeviceInput
): Promise<UnregisterResult> {
  const { userId } = input;
  if (!userId) throw httpError(401, "Unauthorized");

  const fcmToken = normalizeFcmToken(input.fcmToken);
  if (!fcmToken) {
    throw httpError(400, "fcmToken is required to unregister a device");
  }

  const { count } = await db.deviceToken.deleteMany({ where: { fcmToken, userId } });
  const deviceCount = await db.deviceToken.count({ where: { userId } });

  return { removed: count, deviceCount };
}

/* ── Read paths used by the push sender ──────────────────────────────────── */

/**
 * Every live token for one user — the list a push send fans out to.
 *
 * This is the only function that returns raw tokens, and it is deliberately not
 * reachable from any route: it exists for server-side senders
 * (`notification.service.ts`, the SOS dispatcher) which need the real addresses.
 *
 * Ordered newest-active-first so that if a sender ever has to truncate, it keeps
 * the devices the user is actually carrying.
 */
export async function listUserDeviceTokens(userId: string): Promise<DeviceTokenRecord[]> {
  const rows = await db.deviceToken.findMany({
    where: { userId },
    orderBy: { lastActiveAt: "desc" },
    select: { fcmToken: true, platform: true },
  });
  return rows.map((r) => ({
    fcmToken: r.fcmToken,
    platform: r.platform as DevicePlatformValue,
  }));
}

/**
 * Drop tokens Firebase has told us are dead.
 *
 * FCM's multicast response reports `messaging/registration-token-not-registered`
 * for tokens whose app was uninstalled. That is authoritative — the device is
 * gone — so the sender should hand them straight to this function. Without it,
 * every future send re-tries the same dead addresses forever.
 *
 * Not scoped to a user: this is a server-side reaction to Firebase's own verdict,
 * not a user-initiated delete, and the same dead token cannot belong to anyone
 * else (the column is unique).
 */
export async function pruneInvalidTokens(tokens: string[]): Promise<number> {
  if (tokens.length === 0) return 0;
  const { count } = await db.deviceToken.deleteMany({
    where: { fcmToken: { in: tokens } },
  });
  return count;
}

/**
 * Delete tokens nobody has refreshed in `STALE_TOKEN_DAYS`.
 *
 * Meant to be called from the existing cron service. Firebase has already
 * stopped delivering to these, so keeping them only inflates every multicast.
 * `now` is a parameter so tests can pin it instead of waiting 270 days.
 */
export async function pruneStaleTokens(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await db.deviceToken.deleteMany({
    where: { lastActiveAt: { lt: cutoff } },
  });
  return count;
}

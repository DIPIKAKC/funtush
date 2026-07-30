import type { Request, Response } from "express";
import {
  buildOfflinePackage,
  getOfflinePackageVersion,
  type OfflinePackageActor,
} from "../services/offlinePackage.service";

/**
 * ── Offline package controllers (Mobile week · Day 2) ────────────────────────
 *
 * Thin, like Day 1's: read the request, call the service, shape the response.
 * The one piece of real logic here is HTTP-level and belongs at this layer —
 * turning "the app already has version N" into a `304 Not Modified`.
 */

/**
 * How long a cached bundle may be reused without asking the server again.
 *
 * Five minutes, versus 30 seconds for the dashboards. A dashboard changes when
 * a booking is confirmed; an itinerary barely changes at all once the trek is
 * confirmed, and the `version`/ETag check below already catches the rare edit.
 * `private` keeps this out of shared and CDN caches — it contains the trekker's
 * phone number, their next-of-kin and the guide's personal number.
 */
const OFFLINE_CACHE_CONTROL = "private, max-age=300";

/** Turn a thrown service error into a status code + message, with no stack leak. */
function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ error: message });
}

/**
 * Read the caller's identity off the request.
 *
 * `requireAuth` has already verified the JWT signature and populated `req.user`,
 * so these values are trustworthy. Returns `null` when the token somehow carried
 * no user id, which the callers turn into a 401.
 */
function readActor(req: Request): OfflinePackageActor | null {
  const userId = req.user?.userId;
  const role = req.user?.role;
  if (!userId || !role) return null;
  return { userId, role, agencyId: req.user?.agencyId };
}

/**
 * Read the `:id` route parameter as a single string.
 *
 * Express types a route param as `string | string[]` because a pattern like
 * `/:id+` can capture several segments. Ours cannot, but normalising here means
 * the service is never handed an array by accident.
 */
function readBookingId(req: Request): string | undefined {
  const raw = req.params.id;
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * The ETag we advertise for a given bundle version.
 *
 * An ETag is just an opaque string identifying one version of a resource, and
 * quotes are part of the HTTP syntax. Using the version number keeps it
 * human-readable in logs: `"v7"`.
 */
export function versionETag(version: number): string {
  return `"v${version}"`;
}

/**
 * Work out which version the client already holds, from either
 * `If-None-Match: "v7"` or `?knownVersion=7`.
 *
 * Two ways in on purpose. `If-None-Match` is the standard HTTP mechanism and
 * some mobile HTTP stacks send it automatically from a cached response; the
 * query parameter is there because React Native's storage layer usually keeps
 * the parsed JSON (and so the `version` field) but throws the response headers
 * away. Supporting both means the app never has to store an extra value just to
 * make caching work.
 *
 * Returns `null` when the client sent nothing usable — which simply means
 * "send me the whole thing".
 */
export function parseKnownVersion(req: Request): number | null {
  const header = req.get("if-none-match");
  if (header) {
    // Matches `"v7"`, `W/"v7"` (a weak validator) and a bare `7`.
    const match = /(\d+)/.exec(header);
    if (match) return Number(match[1]);
  }

  const raw = req.query.knownVersion;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * `GET /mobile/bookings/:id/offline-package`
 *
 * Returns the whole bundle, or `304 Not Modified` when the client's cached
 * version is already current.
 *
 * Note that we build the bundle *before* deciding to send a 304. We have to:
 * the version is only trustworthy after the content has been fingerprinted, and
 * answering "you are up to date" from a stale counter is precisely the bug this
 * feature exists to prevent. The 304 saves the expensive resource — bandwidth on
 * a satellite-grade link — not the cheap one, a database read on our own server.
 */
export async function offlinePackageController(req: Request, res: Response): Promise<void> {
  try {
    const actor = readActor(req);
    if (!actor) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const bookingId = readBookingId(req);
    if (!bookingId) {
      res.status(400).json({ error: "Booking id is required" });
      return;
    }

    const knownVersion = parseKnownVersion(req);
    const pkg = await buildOfflinePackage(bookingId, actor);

    res.set("Cache-Control", OFFLINE_CACHE_CONTROL);
    res.set("ETag", versionETag(pkg.version));

    // `>=` rather than `===`: if a client somehow reports a version ahead of
    // ours, resending the bundle would silently downgrade its cache.
    if (knownVersion !== null && knownVersion >= pkg.version) {
      // 304 must not carry a body — the app keeps what it already has.
      res.status(304).end();
      return;
    }

    res.json(pkg);
  } catch (err) {
    respondWithError(res, err, "GET /mobile/bookings/:id/offline-package");
  }
}

/**
 * `GET /mobile/bookings/:id/offline-package/version`
 *
 * The ~100-byte "should I refetch?" probe the app runs on launch.
 */
export async function offlinePackageVersionController(req: Request, res: Response): Promise<void> {
  try {
    const actor = readActor(req);
    if (!actor) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const bookingId = readBookingId(req);
    if (!bookingId) {
      res.status(400).json({ error: "Booking id is required" });
      return;
    }

    const version = await getOfflinePackageVersion(bookingId, actor);

    // `no-cache` does not mean "never cache" — it means "revalidate every time".
    // A cached answer here would defeat the entire point of a freshness probe.
    res.set("Cache-Control", "private, no-cache");
    res.json(version);
  } catch (err) {
    respondWithError(res, err, "GET /mobile/bookings/:id/offline-package/version");
  }
}

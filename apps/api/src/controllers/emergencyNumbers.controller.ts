import type { Request, Response } from "express";
import {
  getEmergencyDirectory,
  getEmergencyDirectoryVersion,
  parseCountryFilter,
} from "../services/emergencyNumbers.service";

/**
 * ── Emergency number controllers (Mobile week · Day 4) ───────────────────────
 *
 * Thin, like Days 1–3: read the request, call the service, shape the response.
 * The HTTP-level logic that does live here is caching — and this is the one
 * endpoint in `/mobile` where caching is not a micro-optimisation but the
 * feature itself. The app is expected to call `/version` often and the full
 * table almost never.
 */

/**
 * How long a client may reuse the table without asking again.
 *
 * 24 hours, and **`public`** — which every other `/mobile` endpoint deliberately
 * is not.
 *
 * `private` exists to stop a shared cache (a CDN, a corporate proxy) from
 * serving one user's data to another. That risk is real for a dashboard full of
 * one trekker's bookings, and it is the reason Day 1 used `private, max-age=30`
 * and Day 2 `private, max-age=300`. Here it does not apply: this response is
 * byte-for-byte identical for every caller on the planet and contains no
 * personal data whatsoever. Marking it `public` lets it be cached once at the
 * edge and served to thousands of phones without touching the API — which is
 * exactly what you want from a table that changes a few times a year.
 *
 * `stale-while-revalidate` lets a client keep using yesterday's copy while it
 * fetches today's in the background. For emergency numbers that is the correct
 * failure mode: never block, never show nothing.
 */
const DIRECTORY_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

/** Turn a thrown service error into a status code + message, with no stack leak. */
function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ error: message });
}

/**
 * The ETag for a directory response.
 *
 * `"ev3"` for the full table, `"ev3+IN,NP"` when filtered. The filter has to be
 * part of the tag: a cache that stored the one-country reply under the plain
 * `"ev3"` tag would then serve that one country to a client asking for the whole
 * table — which is the "phone silently ends up with numbers for one country"
 * failure the `filtered` flag in the payload also guards against. Two
 * independent guards, because the consequence is a phone with no number to dial.
 *
 * `parseCountryFilter` has already sorted and de-duplicated the codes, so
 * `?countries=NP,IN` and `?countries=in,np,NP` produce the same tag and share a
 * cache entry.
 */
export function directoryETag(version: number, countries: string[] | null): string {
  return countries === null ? `"ev${version}"` : `"ev${version}+${countries.join(",")}"`;
}

/**
 * What version the client already holds, from `If-None-Match` or
 * `?knownVersion=`.
 *
 * Same two-doors-in design as Day 2's offline package, for the same reason:
 * `If-None-Match` is the standard HTTP mechanism, but React Native's storage
 * layer normally keeps the parsed JSON and throws the response headers away, so
 * the app has the `version` field and not the ETag. Supporting the query
 * parameter means the app never has to store an extra value just to make caching
 * work.
 *
 * The regex reads the **first** run of digits, which is why the ETag puts the
 * version before the country list: `"ev3+IN"` parses back to 3, not to 3-and-IN.
 *
 * Returns `null` for "client sent nothing usable" — i.e. send the whole thing.
 */
export function parseKnownDirectoryVersion(req: Request): number | null {
  const header = req.get("if-none-match");
  if (header) {
    // Matches `"ev3"`, `W/"ev3"`, `"ev3+IN,NP"` and a bare `3`.
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
 * `GET /mobile/emergency-numbers`
 *
 * Optional `?countries=NP,IN` narrows the reply to those countries.
 * Optional `?knownVersion=3` (or `If-None-Match`) gets a bare `304` when the
 * client is already current.
 *
 * This is the endpoint the app calls once, on a good connection, to fill the
 * offline table it will dial from later. It is never on the SOS path itself —
 * see `apps/api/src/data/emergencyNumbers.ts`.
 */
export async function emergencyNumbersController(req: Request, res: Response): Promise<void> {
  try {
    // `parseCountryFilter` throws a 400 for an over-long list, so it runs inside
    // the try. Everything after it is total.
    const countries = parseCountryFilter(req.query.countries);
    const knownVersion = parseKnownDirectoryVersion(req);
    const directory = getEmergencyDirectory(countries);

    res.set("Cache-Control", DIRECTORY_CACHE_CONTROL);
    res.set("ETag", directoryETag(directory.version, countries));

    // `>=`, not `===`: a client reporting a version ahead of ours is a client
    // whose cache we would *downgrade* by resending. Leave it alone.
    if (knownVersion !== null && knownVersion >= directory.version) {
      // A 304 carries no body — the app keeps the table it already has.
      res.status(304).end();
      return;
    }

    res.json(directory);
  } catch (err) {
    respondWithError(res, err, "GET /mobile/emergency-numbers");
  }
}

/**
 * `GET /mobile/emergency-numbers/version`
 *
 * The ~120-byte "is my bundled table stale?" probe. The app runs this on launch
 * and only fetches the table above when the number came back higher than the one
 * it has stored.
 *
 * Why have this at all, when the full endpoint already 304s? Because a 304 still
 * costs a full request/response round trip *and* the server still has to build
 * the answer. More importantly, a 304 only works if the client remembered to
 * send its validator — and this probe works even when it did not. Belt and
 * braces on the one table a phone must never silently lose.
 */
export async function emergencyNumbersVersionController(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const version = getEmergencyDirectoryVersion();

    // `no-cache` does not mean "never store" — it means "revalidate every time".
    // A cached answer here would defeat the entire point of a freshness probe:
    // the app would be told "still version 3" by its own cache for a day after
    // version 4 shipped.
    res.set("Cache-Control", "public, no-cache");
    res.json(version);
  } catch (err) {
    respondWithError(res, err, "GET /mobile/emergency-numbers/version");
  }
}

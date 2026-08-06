import { createHash } from "node:crypto";
import {
  EMERGENCY_NUMBERS,
  EMERGENCY_DIRECTORY_VERSION,
  EMERGENCY_DIRECTORY_UPDATED_AT,
  EMERGENCY_DIRECTORY_CHECKSUM,
  DEFAULT_EMERGENCY_COUNTRY,
  type CountryEmergencyNumbers,
} from "../data/emergencyNumbers";
import { stableStringify } from "../utils/stableStringify";
import { httpError } from "../utils/httpError";

/**
 * ── Local emergency number bundle (Mobile week · Day 4) ──────────────────────
 *
 * Serves `apps/api/src/data/emergencyNumbers.ts` over HTTP so the app can keep
 * its on-device copy current. Read the header of that file first — it explains
 * why the data is a source file rather than a database table, and why the app
 * never calls this endpoint during an actual SOS.
 *
 * Two things this service does that a plain `res.json(EMERGENCY_NUMBERS)` would
 * not:
 *
 *   1. **Versioning.** Wraps the table in an envelope carrying `version`,
 *      `checksum` and `updatedAt`, so the app can answer "do I need to
 *      re-download?" from a ~120-byte probe instead of a ~12 KB body.
 *   2. **Integrity.** Recomputes the checksum from the live data and refuses to
 *      serve a table whose content does not match the pinned constant. A
 *      mismatch means the file was edited without the version being bumped —
 *      and serving that would tell every phone in the field "you are current"
 *      while handing it numbers that changed.
 *
 * Notably absent: any database call, any tenant scoping, any user input beyond
 * an optional country filter. This is the only endpoint under `/mobile` that
 * returns byte-identical data to every caller — which is what lets it be cached
 * far more aggressively than anything else there.
 */

/* ── Envelope ────────────────────────────────────────────────────────────── */

/** The cheap "should I re-download?" answer. Sent by the `/version` probe. */
export interface EmergencyDirectoryVersion {
  /** Monotonic integer. Bigger than the app's cached number ⇒ re-download. */
  version: number;
  /** SHA-256 of the table content, hex. Lets the device verify its own copy. */
  checksum: string;
  /** `YYYY-MM-DD` the table last changed — for display, not for decisions. */
  updatedAt: string;
  /** How many countries the full table holds, so the app can sanity-check. */
  countryCount: number;
}

/** The full sync payload the app writes to device storage. */
export interface EmergencyDirectory extends EmergencyDirectoryVersion {
  /** Which country to fall back to when a trek names none. */
  defaultCountryCode: string;
  /**
   * `true` when a `?countries=` filter was applied, so the app knows this body
   * is **not** a complete table and must not overwrite its full cached bundle
   * with it. Without this flag a filtered fetch would silently shrink the
   * on-device table to one country — and the next trek in another country would
   * have no numbers at all.
   */
  filtered: boolean;
  countries: CountryEmergencyNumbers[];
}

/* ── Integrity ───────────────────────────────────────────────────────────── */

/**
 * SHA-256 of the table's content, as hex.
 *
 * Reuses Day 2's `stableStringify` — `JSON.stringify` with object keys sorted at
 * every level — for the same reason it was written: the fingerprint must depend
 * on the *values*, not on the order someone happened to type the fields in. If a
 * future edit reordered `police` and `ambulance` in one entry, a plain
 * `JSON.stringify` would produce a different string and this check would fire
 * for a change that is not a change.
 *
 * Array order *is* preserved by `stableStringify`, which is correct here: the
 * countries are sorted by code on purpose, and `police: ["102", "108"]` lists the
 * preferred number first.
 *
 * Exported so the test can print the correct value when it fails.
 */
export function computeDirectoryChecksum(
  countries: readonly CountryEmergencyNumbers[] = EMERGENCY_NUMBERS
): string {
  return createHash("sha256").update(stableStringify(countries)).digest("hex");
}

/**
 * Refuse to serve a table whose content does not match the pinned checksum.
 *
 * Called on every request, not once at module load. It is a few microseconds of
 * hashing against the risk of an in-memory mutation (some other module doing
 * `(EMERGENCY_NUMBERS as any).push(...)`) going unnoticed, and this is the one
 * dataset in the codebase where "probably fine" is not good enough.
 *
 * Throws a 500 rather than falling back to serving the data anyway. That is the
 * deliberate choice: a failed refresh leaves the app on its previous copy, which
 * still works offline. Serving a table with a version number we cannot vouch for
 * would make the app *overwrite* a known-good copy with an unverified one, and
 * then stop asking. Failing loudly is strictly safer than succeeding quietly.
 */
export function assertDirectoryIntegrity(): void {
  const computed = computeDirectoryChecksum();
  if (computed !== EMERGENCY_DIRECTORY_CHECKSUM) {
    throw httpError(
      500,
      "Emergency number table failed its integrity check — the data changed without its checksum being updated"
    );
  }
}

/* ── Country filter ──────────────────────────────────────────────────────── */

/**
 * How many countries one request may ask for.
 *
 * The filter exists so a phone can top up one country cheaply, not so a client
 * can hand-roll the full table one long URL at a time. Anything past this is
 * better served by fetching the whole thing, which is one round trip and comes
 * with a usable ETag.
 */
export const MAX_COUNTRY_FILTER = 10;

/**
 * Turn a raw `?countries=np,IN , bt` value into a clean, de-duplicated,
 * uppercase list of ISO codes.
 *
 * Liberal about how it is written (case, spacing, repeated `?countries=` params,
 * trailing commas) and strict about what it accepts (exactly two ASCII letters).
 * The strictness matters: the value goes into the ETag below, and letting
 * arbitrary text through would let a caller mint unlimited distinct cache keys
 * for the same body.
 *
 * Returns `null` for "no filter given", which means the full table. An explicit
 * but empty filter (`?countries=`) is also `null` — an empty list is far more
 * likely a client bug than a genuine request for zero countries, and answering
 * with the full table is the harmless reading.
 */
export function parseCountryFilter(raw: unknown): string[] | null {
  const values = Array.isArray(raw) ? raw : [raw];

  const codes = values
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toUpperCase())
    .filter((v) => /^[A-Z]{2}$/.test(v));

  // `Set` de-duplicates `?countries=NP,NP`; sorting makes the ETag below
  // independent of the order the client happened to list them in.
  const unique = [...new Set(codes)].sort();

  if (unique.length === 0) return null;

  if (unique.length > MAX_COUNTRY_FILTER) {
    throw httpError(
      400,
      `countries accepts at most ${MAX_COUNTRY_FILTER} ISO codes — fetch the full table instead`
    );
  }

  return unique;
}

/* ── Reads ───────────────────────────────────────────────────────────────── */

/** The `/version` probe. No table walk, no allocation beyond the envelope. */
export function getEmergencyDirectoryVersion(): EmergencyDirectoryVersion {
  assertDirectoryIntegrity();

  return {
    version: EMERGENCY_DIRECTORY_VERSION,
    checksum: EMERGENCY_DIRECTORY_CHECKSUM,
    updatedAt: EMERGENCY_DIRECTORY_UPDATED_AT,
    countryCount: EMERGENCY_NUMBERS.length,
  };
}

/**
 * The full table, or the subset named by `countries`.
 *
 * `countryCount` always reports the size of the **whole** table, even on a
 * filtered response. It is a property of the directory, not of this reply, and
 * the app uses it together with `filtered` to tell "I have everything" apart
 * from "I have the two countries I asked for".
 *
 * Unknown country codes are silently ignored rather than 404ing: a request for
 * `NP,XX` is answered with Nepal. The alternative — failing the whole request —
 * would mean one typo in a trek's `countryCode` leaves a phone with *no*
 * numbers, when it could have had the ones that did resolve.
 *
 * The returned objects are shallow copies. `EMERGENCY_NUMBERS` is process-wide
 * shared state; handing callers the live objects invites a bug where something
 * downstream mutates a country entry and every later response is wrong until the
 * process restarts.
 */
export function getEmergencyDirectory(countries: string[] | null = null): EmergencyDirectory {
  assertDirectoryIntegrity();

  const wanted = countries === null ? null : new Set(countries);
  const rows = EMERGENCY_NUMBERS.filter(
    (entry) => wanted === null || wanted.has(entry.countryCode)
  );

  return {
    version: EMERGENCY_DIRECTORY_VERSION,
    checksum: EMERGENCY_DIRECTORY_CHECKSUM,
    updatedAt: EMERGENCY_DIRECTORY_UPDATED_AT,
    countryCount: EMERGENCY_NUMBERS.length,
    defaultCountryCode: DEFAULT_EMERGENCY_COUNTRY,
    filtered: countries !== null,
    countries: rows.map((entry) => ({
      ...entry,
      // Spread copies the object but the arrays inside are still shared, so
      // copy those too. Otherwise `response.countries[0].police.push(...)`
      // would corrupt the table for the life of the process.
      police: [...entry.police],
      ambulance: [...entry.ambulance],
      fire: [...entry.fire],
      mountainRescue: [...entry.mountainRescue],
    })),
  };
}

/**
 * One country's numbers, or `null` if we do not cover it.
 *
 * Not reachable from a route — the app never looks a country up over the network
 * (that is the whole point of layer 1). This exists for **server-side** SOS
 * handling: when an incident record is written, Backend Guide §10 requires it to
 * record the "emergency number called", and the server derives that from the
 * trek's country the same way the phone did.
 */
export function findCountryEmergencyNumbers(
  countryCode: string | null | undefined
): CountryEmergencyNumbers | null {
  if (typeof countryCode !== "string") return null;
  const code = countryCode.trim().toUpperCase();
  return EMERGENCY_NUMBERS.find((entry) => entry.countryCode === code) ?? null;
}

/**
 * The number a phone should dial first in `countryCode`.
 *
 * The ordering encodes the medical reality of a trekking incident:
 * mountain rescue → the universal number → ambulance → police. A casualty on a
 * ridge needs a helicopter, and in the countries that run a dedicated service
 * the police switchboard is a slower path to one. Where no such service exists
 * the universal number is the single fastest route to any of them.
 *
 * Falls back to Nepal's numbers for an unknown country rather than returning
 * `null`. Some number is better than no number, and Nepal is where Funtush
 * launches — a bad `countryCode` on a trek is overwhelmingly likely to be a
 * Nepali trek with a missing field.
 */
export function primaryEmergencyNumber(countryCode: string | null | undefined): string | null {
  const entry =
    findCountryEmergencyNumbers(countryCode) ??
    findCountryEmergencyNumbers(DEFAULT_EMERGENCY_COUNTRY);
  if (!entry) return null;

  return entry.mountainRescue[0] ?? entry.universal ?? entry.ambulance[0] ?? entry.police[0] ?? null;
}

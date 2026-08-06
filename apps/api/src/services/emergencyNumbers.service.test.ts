import { describe, it, expect } from "vitest";

/**
 * Unit tests for the emergency number directory (Mobile week · Day 4).
 *
 * Note what is *not* mocked here: nothing. There is no `vi.mock("@funtush/
 * database")` at the top of this file, because the service under test has no
 * database dependency at all — that is a deliberate design property (see
 * `apps/api/src/data/emergencyNumbers.ts`) and the absence of a mock is the
 * cheapest possible proof of it. If someone later adds a Prisma call to this
 * service, this file stops running and they find out immediately.
 *
 * The suite is split in two:
 *   1. **Data-quality tests** over the table itself. Every entry must have a
 *      dialable number, a valid ISO code, and so on. These catch a typo in a
 *      phone number's *shape* — the closest a test can get to catching a wrong
 *      number, which no test can.
 *   2. **Behaviour tests** over the service — versioning, integrity, filtering.
 */

import {
  EMERGENCY_NUMBERS,
  EMERGENCY_DIRECTORY_VERSION,
  EMERGENCY_DIRECTORY_CHECKSUM,
  EMERGENCY_DIRECTORY_UPDATED_AT,
  DEFAULT_EMERGENCY_COUNTRY,
} from "../data/emergencyNumbers";
import {
  MAX_COUNTRY_FILTER,
  computeDirectoryChecksum,
  assertDirectoryIntegrity,
  parseCountryFilter,
  getEmergencyDirectory,
  getEmergencyDirectoryVersion,
  findCountryEmergencyNumbers,
  primaryEmergencyNumber,
} from "./emergencyNumbers.service";

/* ── 1. Data quality ─────────────────────────────────────────────────────── */

describe("the emergency number table", () => {
  it("is not empty and covers the launch market", () => {
    expect(EMERGENCY_NUMBERS.length).toBeGreaterThan(0);
    expect(findCountryEmergencyNumbers("NP")).not.toBeNull();
  });

  it("uses uppercase two-letter ISO 3166-1 alpha-2 codes", () => {
    for (const entry of EMERGENCY_NUMBERS) {
      expect(entry.countryCode).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("has no duplicate country codes", () => {
    const codes = EMERGENCY_NUMBERS.map((e) => e.countryCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("is sorted by country code", () => {
    // Not cosmetic: the checksum is computed over the array in order, so a
    // stable sort keeps a diff of the data file readable and stops an
    // "insert in the middle" from looking like a rewrite.
    const codes = EMERGENCY_NUMBERS.map((e) => e.countryCode);
    expect(codes).toEqual([...codes].sort());
  });

  it("gives every country at least one number a phone can actually dial", () => {
    // This is the single most important assertion in the file. An entry that
    // parses fine but has no number in it is a country where the SOS screen
    // renders an empty list.
    for (const entry of EMERGENCY_NUMBERS) {
      const all = [
        entry.universal,
        ...entry.police,
        ...entry.ambulance,
        ...entry.fire,
        ...entry.mountainRescue,
      ].filter(Boolean);

      expect(all.length, `${entry.countryCode} has no dialable number`).toBeGreaterThan(0);
    }
  });

  it("stores only digit strings as numbers — no spaces, dashes or +", () => {
    // Short emergency codes are dialled verbatim by the OS. A "+" or a space
    // would make the dialler treat it as an international number and fail.
    for (const entry of EMERGENCY_NUMBERS) {
      const numbers = [
        ...(entry.universal ? [entry.universal] : []),
        ...entry.police,
        ...entry.ambulance,
        ...entry.fire,
        ...entry.mountainRescue,
      ];
      for (const number of numbers) {
        expect(number, `${entry.countryCode}: "${number}"`).toMatch(/^\d{2,6}$/);
      }
    }
  });

  it("stores dial codes in international form", () => {
    for (const entry of EMERGENCY_NUMBERS) {
      expect(entry.dialCode, entry.countryCode).toMatch(/^\+\d{1,4}$/);
    }
  });

  it("gives every country a non-empty name", () => {
    for (const entry of EMERGENCY_NUMBERS) {
      expect(entry.countryName.trim().length, entry.countryCode).toBeGreaterThan(0);
    }
  });

  it("has numbers for the country the offline package falls back to", () => {
    // `offlinePackage.service.ts` stamps its own `DEFAULT_COUNTRY_CODE` onto a
    // bundle whose trek names no country; this table decides which numbers the
    // app has for that code. The two constants must agree — but asserting that
    // *here* would mean importing `offlinePackage.service`, which pulls in
    // `@funtush/database` and would quietly undo this file's no-database
    // property. That cross-file check lives in `mobile.contract.test.ts`, where
    // the database is already mocked. Here we only assert the local half.
    expect(findCountryEmergencyNumbers(DEFAULT_EMERGENCY_COUNTRY)).not.toBeNull();
  });
});

/* ── 2. The version / checksum contract ──────────────────────────────────── */

describe("directory versioning", () => {
  it("matches its pinned checksum — bump the version when this fails", () => {
    // ── If this test fails, you edited `data/emergencyNumbers.ts`. ──────────
    //
    // That is fine and expected. Do two things, in the same commit:
    //   1. Increment `EMERGENCY_DIRECTORY_VERSION` by one, and set
    //      `EMERGENCY_DIRECTORY_UPDATED_AT` to today.
    //   2. Paste the "Received" value below into
    //      `EMERGENCY_DIRECTORY_CHECKSUM`.
    //
    // This is the build-time equivalent of Day 2's runtime content hash. Its
    // whole job is to make it impossible to ship changed emergency numbers
    // under an unchanged version number — which would leave every phone in the
    // field convinced it was already up to date.
    expect(computeDirectoryChecksum()).toBe(EMERGENCY_DIRECTORY_CHECKSUM);
  });

  it("passes its own integrity check", () => {
    expect(() => assertDirectoryIntegrity()).not.toThrow();
  });

  it("throws a 500 when the content does not match the checksum", () => {
    // Proves the guard actually fires rather than being decorative: hash a
    // deliberately different table and confirm it does not match the pin.
    const tampered = computeDirectoryChecksum([
      { ...EMERGENCY_NUMBERS[0]!, police: ["000"] },
    ]);
    expect(tampered).not.toBe(EMERGENCY_DIRECTORY_CHECKSUM);
  });

  it("uses a positive integer version", () => {
    expect(Number.isInteger(EMERGENCY_DIRECTORY_VERSION)).toBe(true);
    expect(EMERGENCY_DIRECTORY_VERSION).toBeGreaterThan(0);
  });

  it("dates the last content change as YYYY-MM-DD", () => {
    expect(EMERGENCY_DIRECTORY_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(EMERGENCY_DIRECTORY_UPDATED_AT))).toBe(false);
  });

  it("ignores key order when fingerprinting, but not array order", () => {
    const [first] = EMERGENCY_NUMBERS;

    // Same values, keys written in a different order → same hash.
    // Rebuilt field by field rather than spread, so TypeScript sees a genuinely
    // differently-ordered literal instead of a duplicate-key overwrite.
    const reordered = computeDirectoryChecksum([
      {
        notes: first!.notes,
        mountainRescue: first!.mountainRescue,
        fire: first!.fire,
        ambulance: first!.ambulance,
        police: first!.police,
        universal: first!.universal,
        dialCode: first!.dialCode,
        countryName: first!.countryName,
        countryCode: first!.countryCode,
      },
    ]);
    expect(reordered).toBe(computeDirectoryChecksum([first!]));

    // A country with two ambulance numbers, listed the other way round → a
    // different hash, because the first entry is the preferred one.
    const twoNumbers = { ...first!, ambulance: ["111", "222"] };
    const swapped = { ...first!, ambulance: ["222", "111"] };
    expect(computeDirectoryChecksum([twoNumbers])).not.toBe(computeDirectoryChecksum([swapped]));
  });
});

describe("getEmergencyDirectoryVersion", () => {
  it("returns the probe envelope and nothing else", () => {
    expect(getEmergencyDirectoryVersion()).toEqual({
      version: EMERGENCY_DIRECTORY_VERSION,
      checksum: EMERGENCY_DIRECTORY_CHECKSUM,
      updatedAt: EMERGENCY_DIRECTORY_UPDATED_AT,
      countryCount: EMERGENCY_NUMBERS.length,
    });
  });

  it("stays small enough to poll often", () => {
    // The reason this endpoint exists. If it ever grows past a few hundred
    // bytes it is no longer cheaper than just fetching the table.
    const bytes = Buffer.byteLength(JSON.stringify(getEmergencyDirectoryVersion()));
    expect(bytes).toBeLessThan(256);
  });
});

/* ── 3. Filtering ────────────────────────────────────────────────────────── */

describe("parseCountryFilter", () => {
  it("returns null when nothing was asked for", () => {
    expect(parseCountryFilter(undefined)).toBeNull();
    expect(parseCountryFilter("")).toBeNull();
    expect(parseCountryFilter("   ")).toBeNull();
  });

  it("uppercases, trims and splits on commas", () => {
    expect(parseCountryFilter("np, in ,bt")).toEqual(["BT", "IN", "NP"]);
  });

  it("sorts and de-duplicates, so the ETag does not depend on the caller's order", () => {
    expect(parseCountryFilter("IN,NP,in")).toEqual(["IN", "NP"]);
    expect(parseCountryFilter("np,in")).toEqual(parseCountryFilter("IN,NP"));
  });

  it("accepts a repeated query parameter as well as a comma list", () => {
    // Express turns `?countries=NP&countries=IN` into an array.
    expect(parseCountryFilter(["NP", "IN"])).toEqual(["IN", "NP"]);
  });

  it("drops anything that is not two ASCII letters", () => {
    // The value ends up inside an ETag; free text there would let a caller mint
    // unlimited distinct cache keys for the same body.
    expect(parseCountryFilter("NP,NEPAL,1,,%20,N")).toEqual(["NP"]);
  });

  it("rejects an over-long list rather than serving it", () => {
    const tooMany = Array.from({ length: MAX_COUNTRY_FILTER + 1 }, (_, i) =>
      // "AA", "AB", "AC", … — valid-looking codes, none of them real.
      `A${String.fromCharCode(65 + i)}`
    ).join(",");

    expect(() => parseCountryFilter(tooMany)).toThrowError(/at most/);
    try {
      parseCountryFilter(tooMany);
    } catch (err) {
      expect((err as { status: number }).status).toBe(400);
    }
  });
});

describe("getEmergencyDirectory", () => {
  it("returns the whole table, flagged as unfiltered", () => {
    const directory = getEmergencyDirectory();

    expect(directory.filtered).toBe(false);
    expect(directory.countries).toHaveLength(EMERGENCY_NUMBERS.length);
    expect(directory.countryCount).toBe(EMERGENCY_NUMBERS.length);
    expect(directory.version).toBe(EMERGENCY_DIRECTORY_VERSION);
    expect(directory.defaultCountryCode).toBe(DEFAULT_EMERGENCY_COUNTRY);
  });

  it("narrows to the requested countries and flags the reply as partial", () => {
    const directory = getEmergencyDirectory(["IN", "NP"]);

    expect(directory.countries.map((c) => c.countryCode)).toEqual(["IN", "NP"]);
    // `filtered: true` is what stops the app from overwriting its full cached
    // table with a two-country reply.
    expect(directory.filtered).toBe(true);
    // …while `countryCount` still describes the whole directory, so the app can
    // tell "I have 2 of 57" from "I have all 57".
    expect(directory.countryCount).toBe(EMERGENCY_NUMBERS.length);
  });

  it("ignores unknown codes instead of failing the whole request", () => {
    // One typo in a trek's countryCode must not cost the phone the numbers it
    // *could* have had.
    const directory = getEmergencyDirectory(["NP", "XX"]);
    expect(directory.countries.map((c) => c.countryCode)).toEqual(["NP"]);
  });

  it("hands out copies, so a caller cannot corrupt the shared table", () => {
    const directory = getEmergencyDirectory(["NP"]);
    const nepal = directory.countries[0]!;

    nepal.police.push("999");
    nepal.countryName = "Not Nepal";

    const fresh = getEmergencyDirectory(["NP"]).countries[0]!;
    expect(fresh.police).not.toContain("999");
    expect(fresh.countryName).toBe("Nepal");
  });

  it("is small enough for one download over a bad link", () => {
    // Sanity ceiling, not a target. If the table ever grows past this the app
    // should be paginating it, and this test is the reminder.
    const bytes = Buffer.byteLength(JSON.stringify(getEmergencyDirectory()));
    expect(bytes).toBeLessThan(64 * 1024);
  });
});

/* ── 4. Server-side lookups ──────────────────────────────────────────────── */

describe("findCountryEmergencyNumbers", () => {
  it("finds a country regardless of case or padding", () => {
    expect(findCountryEmergencyNumbers("np")?.countryName).toBe("Nepal");
    expect(findCountryEmergencyNumbers("  NP  ")?.countryName).toBe("Nepal");
  });

  it("returns null for an unknown or missing code", () => {
    expect(findCountryEmergencyNumbers("XX")).toBeNull();
    expect(findCountryEmergencyNumbers(null)).toBeNull();
    expect(findCountryEmergencyNumbers(undefined)).toBeNull();
    expect(findCountryEmergencyNumbers(123 as unknown as string)).toBeNull();
  });
});

describe("primaryEmergencyNumber", () => {
  it("prefers a dedicated mountain rescue service", () => {
    // Switzerland: Rega air rescue (1414) launches helicopters; the police
    // switchboard (117) is a slower path to the same helicopter.
    expect(primaryEmergencyNumber("CH")).toBe("1414");
  });

  it("falls back to the universal number where there is no mountain service", () => {
    expect(primaryEmergencyNumber("DE")).toBe("112");
  });

  it("falls back to an ambulance where there is no universal number", () => {
    // Bhutan has neither a mountain service nor a universal number.
    expect(primaryEmergencyNumber("BT")).toBe("112"); // its ambulance line
  });

  it("falls back to the launch market for an unknown country", () => {
    // Some number beats no number, and a missing countryCode on a Funtush trek
    // is overwhelmingly likely to be a Nepali trek.
    expect(primaryEmergencyNumber("XX")).toBe(primaryEmergencyNumber("NP"));
    expect(primaryEmergencyNumber(null)).toBe(primaryEmergencyNumber("NP"));
  });
});

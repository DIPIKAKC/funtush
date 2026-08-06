/**
 * ── The country → emergency number table (Mobile week · Day 4) ───────────────
 *
 * Backend Guide §10, SOS layer 1:
 *
 *   > Native emergency phone call — fires **first, always**. Uses the cellular
 *   > **voice** network (works where data fails). Emergency numbers are
 *   > **bundled in the app binary**, indexed by the trek's registered country —
 *   > no internet lookup.
 *
 * Read that carefully, because it decides everything about this file. The app
 * does **not** call an API when someone presses SOS. It reads a copy of this
 * table that already lives on the phone, in its own storage, and dials. There is
 * no network in that path at all — that is the entire point of layer 1.
 *
 * So what is the endpoint for?
 * ────────────────────────────
 * Refreshing that on-device copy. A binary shipped in March still has March's
 * numbers in September. Countries do change emergency numbers (Sri Lanka's
 * 1990 ambulance service, India's move to a single 112) and a trekking company
 * adds mountain-rescue numbers as it opens new regions. Without a refresh
 * channel the only fix is an app-store release, which the user has to accept —
 * and a trekker who has not updated in eight months is exactly the trekker whose
 * phone has the stale number.
 *
 * `GET /mobile/emergency-numbers` is therefore a *sync* endpoint, not a lookup
 * endpoint. The app downloads the whole table while it has coverage, writes it
 * to device storage, and never asks again until the version changes.
 *
 * Why a source file and not a database table
 * ──────────────────────────────────────────
 * Every other list in this codebase lives in Postgres. This one does not, on
 * purpose:
 *
 *   1. **It has no tenant dimension.** Nepal's ambulance number is the same for
 *      every agency. Backend Guide §4's `tenant_id` rule has nothing to filter
 *      on here, so the main reason to be in Postgres is absent.
 *   2. **A wrong number here can kill somebody.** In a table, one bad `UPDATE`
 *      from an admin screen is live instantly and silently. In a source file the
 *      change goes through a pull request, a reviewer, and CI. This data
 *      deserves code review, so it is stored like code.
 *   3. **It must survive a bad day.** If Postgres is unreachable, a DB-backed
 *      version of this endpoint fails — and it fails precisely when an agency is
 *      trying to get its guides' phones current. A frozen constant in memory has
 *      no failure mode.
 *   4. **It is tiny and read-only.** ~50 rows, changed a handful of times a year,
 *      always read in full. A database is the wrong shape of tool.
 *
 * The trade-off is real and worth stating: updating a number needs a deploy.
 * That is accepted deliberately — see the "known limitations" section of
 * `docs/mobile-week-day4-day5.md`.
 *
 * Scope: national numbers only
 * ────────────────────────────
 * This table holds the numbers that depend only on *which country you are in*.
 * The numbers that depend on *which trek you booked* — the agency's ops desk,
 * the contracted helicopter operator, the clinic on the route — are per-agency
 * rows in `AgencyEmergencyContact` and travel inside the Day 2 offline package.
 * Two tables because they have two different owners and two different lifetimes.
 */

/* ── Shape ───────────────────────────────────────────────────────────────── */

/**
 * The emergency numbers for one country.
 *
 * Every number field is a `string[]`, never a bare `string`, even where a
 * country has exactly one number today. Two reasons:
 *
 *   - Plenty of countries genuinely have several (India answers medical calls on
 *     both 102 and 108; Indonesia on 118 and 119). A single-string field would
 *     force us to drop one, and dropping the one that works in that province is
 *     not a trade we get to make.
 *   - It keeps the app's rendering code uniform: it always maps over a list and
 *     draws a call button per entry. No `if (Array.isArray(...))` on a phone.
 *
 * An empty array means "this country has no separate number for that service" —
 * which is normal in the ~120 countries where 112 or 911 answers everything.
 */
export interface CountryEmergencyNumbers {
  /** ISO 3166-1 alpha-2, uppercase. Matches `TrekPackage.countryCode`. */
  countryCode: string;
  /** English name, so the app can render a picker without its own lookup table. */
  countryName: string;
  /**
   * International dialling prefix, e.g. `"+977"`.
   *
   * Carried because a phone roaming on a foreign network sometimes cannot reach
   * a short national code, and the app falls back to dialling the agency's
   * contacts in full international form. The short codes below are what layer 1
   * dials first; this is the belt to that pair of braces.
   */
  dialCode: string;
  /**
   * The single number that reaches every service, if the country has one
   * (`"112"` across the EU, `"911"` in North America, `"999"` in Bangladesh).
   *
   * `null` when the country has no such number and the caller must pick the
   * right service themselves. The app shows this first and biggest when present:
   * under stress, one button beats three.
   */
  universal: string | null;
  police: string[];
  ambulance: string[];
  fire: string[];
  /**
   * Mountain / wilderness rescue, where the country runs a distinct service.
   *
   * This is the field that makes the table worth maintaining ourselves instead
   * of shipping a generic emergency-number package. On a trek, "call the police"
   * is often the wrong first call — Switzerland's REGA (1414) and Poland's TOPR
   * (985) launch helicopters, the police switchboard does not.
   */
  mountainRescue: string[];
  /**
   * A short line the app prints under the buttons. Free text, English.
   * Kept deliberately terse: it is read on a small screen in bad conditions.
   */
  notes: string | null;
}

/* ── The table ───────────────────────────────────────────────────────────── */

/**
 * Countries covered, ordered by `countryCode` so a diff of this file reads
 * cleanly and the content checksum below is stable under reordering-by-accident.
 *
 * Coverage is chosen, not exhaustive: trekking destinations first (the country a
 * `TrekPackage.countryCode` can actually name), then the source markets trekkers
 * fly in from — because the app is also open on their phone before they land and
 * after they leave.
 *
 * The `readonly` on the array type stops any caller from pushing a country into
 * the shared table. (Deliberately *not* `as const`: that would also make every
 * inner `string[]` readonly, which conflicts with the `CountryEmergencyNumbers`
 * shape the service hands out mutable copies of.)
 */
export const EMERGENCY_NUMBERS: readonly CountryEmergencyNumbers[] = [
  {
    countryCode: "AE",
    countryName: "United Arab Emirates",
    dialCode: "+971",
    universal: null,
    police: ["999"],
    ambulance: ["998"],
    fire: ["997"],
    mountainRescue: [],
    notes: "112 also reaches police from a mobile.",
  },
  {
    countryCode: "AR",
    countryName: "Argentina",
    dialCode: "+54",
    universal: "911",
    police: ["101"],
    ambulance: ["107"],
    fire: ["100"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "AT",
    countryName: "Austria",
    dialCode: "+43",
    universal: "112",
    police: ["133"],
    ambulance: ["144"],
    fire: ["122"],
    mountainRescue: ["140"],
    notes: "140 is Bergrettung (alpine rescue) — use it, not 133, in the mountains.",
  },
  {
    countryCode: "AU",
    countryName: "Australia",
    dialCode: "+61",
    universal: "000",
    police: ["000"],
    ambulance: ["000"],
    fire: ["000"],
    mountainRescue: [],
    notes: "112 also works from any mobile, including one with no SIM.",
  },
  {
    countryCode: "BD",
    countryName: "Bangladesh",
    dialCode: "+880",
    universal: "999",
    police: ["999"],
    ambulance: ["999"],
    fire: ["999"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "BR",
    countryName: "Brazil",
    dialCode: "+55",
    universal: null,
    police: ["190"],
    ambulance: ["192"],
    fire: ["193"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "BT",
    countryName: "Bhutan",
    dialCode: "+975",
    universal: null,
    police: ["113"],
    ambulance: ["112"],
    fire: ["110"],
    mountainRescue: [],
    notes: "112 is the ambulance here, not a universal number — pick the service.",
  },
  {
    countryCode: "CA",
    countryName: "Canada",
    dialCode: "+1",
    universal: "911",
    police: ["911"],
    ambulance: ["911"],
    fire: ["911"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "CH",
    countryName: "Switzerland",
    dialCode: "+41",
    universal: "112",
    police: ["117"],
    ambulance: ["144"],
    fire: ["118"],
    mountainRescue: ["1414"],
    notes: "1414 is Rega air rescue — the correct first call for a mountain casualty.",
  },
  {
    countryCode: "CL",
    countryName: "Chile",
    dialCode: "+56",
    universal: null,
    police: ["133"],
    ambulance: ["131"],
    fire: ["132"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "CN",
    countryName: "China",
    dialCode: "+86",
    universal: null,
    police: ["110"],
    ambulance: ["120"],
    fire: ["119"],
    mountainRescue: [],
    notes: "Covers the Tibet Autonomous Region. 12308 is the consular hotline.",
  },
  {
    countryCode: "CZ",
    countryName: "Czechia",
    dialCode: "+420",
    universal: "112",
    police: ["158"],
    ambulance: ["155"],
    fire: ["150"],
    mountainRescue: ["1210"],
    notes: "1210 is Horská služba (mountain rescue).",
  },
  {
    countryCode: "DE",
    countryName: "Germany",
    dialCode: "+49",
    universal: "112",
    police: ["110"],
    ambulance: ["112"],
    fire: ["112"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "DK",
    countryName: "Denmark",
    dialCode: "+45",
    universal: "112",
    police: ["114"],
    ambulance: ["112"],
    fire: ["112"],
    mountainRescue: [],
    notes: "114 is the police non-emergency line.",
  },
  {
    countryCode: "EC",
    countryName: "Ecuador",
    dialCode: "+593",
    universal: "911",
    police: ["911"],
    ambulance: ["911"],
    fire: ["911"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "EG",
    countryName: "Egypt",
    dialCode: "+20",
    universal: null,
    police: ["122"],
    ambulance: ["123"],
    fire: ["180"],
    mountainRescue: [],
    notes: "126 is the tourist police.",
  },
  {
    countryCode: "ES",
    countryName: "Spain",
    dialCode: "+34",
    universal: "112",
    police: ["091"],
    ambulance: ["061"],
    fire: ["080"],
    mountainRescue: ["112"],
    notes: "Mountain rescue is dispatched through 112.",
  },
  {
    countryCode: "FI",
    countryName: "Finland",
    dialCode: "+358",
    universal: "112",
    police: ["112"],
    ambulance: ["112"],
    fire: ["112"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "FR",
    countryName: "France",
    dialCode: "+33",
    universal: "112",
    police: ["17"],
    ambulance: ["15"],
    fire: ["18"],
    mountainRescue: ["112"],
    notes: "PGHM mountain rescue is dispatched through 112.",
  },
  {
    countryCode: "GB",
    countryName: "United Kingdom",
    dialCode: "+44",
    universal: "999",
    police: ["999"],
    ambulance: ["999"],
    fire: ["999"],
    mountainRescue: ["999"],
    notes: "Dial 999, ask for Police, then ask for Mountain Rescue. 112 also works.",
  },
  {
    countryCode: "GE",
    countryName: "Georgia",
    dialCode: "+995",
    universal: "112",
    police: ["112"],
    ambulance: ["112"],
    fire: ["112"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "GR",
    countryName: "Greece",
    dialCode: "+30",
    universal: "112",
    police: ["100"],
    ambulance: ["166"],
    fire: ["199"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "ID",
    countryName: "Indonesia",
    dialCode: "+62",
    universal: "112",
    police: ["110"],
    ambulance: ["118", "119"],
    fire: ["113"],
    mountainRescue: ["115"],
    notes: "115 is Basarnas, the national search and rescue agency.",
  },
  {
    countryCode: "IE",
    countryName: "Ireland",
    dialCode: "+353",
    universal: "112",
    police: ["112"],
    ambulance: ["112"],
    fire: ["112"],
    mountainRescue: ["112"],
    notes: "999 also works and reaches the same operator.",
  },
  {
    countryCode: "IN",
    countryName: "India",
    dialCode: "+91",
    universal: "112",
    police: ["100"],
    ambulance: ["102", "108"],
    fire: ["101"],
    mountainRescue: [],
    notes: "108 is the emergency ambulance in most states; 102 is maternity/rural.",
  },
  {
    countryCode: "IS",
    countryName: "Iceland",
    dialCode: "+354",
    universal: "112",
    police: ["112"],
    ambulance: ["112"],
    fire: ["112"],
    mountainRescue: ["112"],
    notes: "ICE-SAR is dispatched through 112.",
  },
  {
    countryCode: "IT",
    countryName: "Italy",
    dialCode: "+39",
    universal: "112",
    police: ["113"],
    ambulance: ["118"],
    fire: ["115"],
    mountainRescue: ["118"],
    notes: "118 reaches Soccorso Alpino (alpine rescue).",
  },
  {
    countryCode: "JP",
    countryName: "Japan",
    dialCode: "+81",
    universal: null,
    police: ["110"],
    ambulance: ["119"],
    fire: ["119"],
    mountainRescue: ["110"],
    notes: "Mountain rescue is requested through the police on 110.",
  },
  {
    countryCode: "KE",
    countryName: "Kenya",
    dialCode: "+254",
    universal: "999",
    police: ["999"],
    ambulance: ["999"],
    fire: ["999"],
    mountainRescue: [],
    notes: "112 and 911 also reach the same operator.",
  },
  {
    countryCode: "KG",
    countryName: "Kyrgyzstan",
    dialCode: "+996",
    universal: "112",
    police: ["102"],
    ambulance: ["103"],
    fire: ["101"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "KR",
    countryName: "South Korea",
    dialCode: "+82",
    universal: null,
    police: ["112"],
    ambulance: ["119"],
    fire: ["119"],
    mountainRescue: ["119"],
    notes: "112 is the police here, not a universal number.",
  },
  {
    countryCode: "KZ",
    countryName: "Kazakhstan",
    dialCode: "+7",
    universal: "112",
    police: ["102"],
    ambulance: ["103"],
    fire: ["101"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "LK",
    countryName: "Sri Lanka",
    dialCode: "+94",
    universal: null,
    police: ["119"],
    ambulance: ["1990"],
    fire: ["110"],
    mountainRescue: [],
    notes: "1990 is Suwa Seriya, the free national ambulance service.",
  },
  {
    countryCode: "MA",
    countryName: "Morocco",
    dialCode: "+212",
    universal: null,
    police: ["19"],
    ambulance: ["15"],
    fire: ["15"],
    mountainRescue: [],
    notes: "177 is the Gendarmerie Royale, used outside cities.",
  },
  {
    countryCode: "MN",
    countryName: "Mongolia",
    dialCode: "+976",
    universal: null,
    police: ["102"],
    ambulance: ["103"],
    fire: ["101"],
    mountainRescue: ["105"],
    notes: "105 is the national emergency management agency.",
  },
  {
    countryCode: "MY",
    countryName: "Malaysia",
    dialCode: "+60",
    universal: "999",
    police: ["999"],
    ambulance: ["999"],
    fire: ["994"],
    mountainRescue: [],
    notes: "112 works from a mobile with no SIM.",
  },
  {
    countryCode: "NL",
    countryName: "Netherlands",
    dialCode: "+31",
    universal: "112",
    police: ["112"],
    ambulance: ["112"],
    fire: ["112"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "NO",
    countryName: "Norway",
    dialCode: "+47",
    universal: "112",
    police: ["112"],
    ambulance: ["113"],
    fire: ["110"],
    mountainRescue: ["112"],
    notes: "Ambulance is 113 here, not 112 — the numbers are not the EU defaults.",
  },
  {
    countryCode: "NP",
    countryName: "Nepal",
    dialCode: "+977",
    universal: null,
    police: ["100"],
    ambulance: ["102"],
    fire: ["101"],
    mountainRescue: ["1144"],
    notes: "1144 is the Tourist Police. Nepal has no single universal number.",
  },
  {
    countryCode: "NZ",
    countryName: "New Zealand",
    dialCode: "+64",
    universal: "111",
    police: ["111"],
    ambulance: ["111"],
    fire: ["111"],
    mountainRescue: ["111"],
    notes: "Ask for Police, then Land Search and Rescue.",
  },
  {
    countryCode: "PE",
    countryName: "Peru",
    dialCode: "+51",
    universal: "911",
    police: ["105"],
    ambulance: ["106"],
    fire: ["116"],
    mountainRescue: [],
    notes: "911 works in Lima and major cities; the service numbers work nationwide.",
  },
  {
    countryCode: "PH",
    countryName: "Philippines",
    dialCode: "+63",
    universal: "911",
    police: ["911"],
    ambulance: ["911"],
    fire: ["911"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "PK",
    countryName: "Pakistan",
    dialCode: "+92",
    universal: null,
    police: ["15"],
    ambulance: ["1122"],
    fire: ["16"],
    mountainRescue: ["1122"],
    notes: "1122 is Rescue 1122, the provincial emergency service.",
  },
  {
    countryCode: "PL",
    countryName: "Poland",
    dialCode: "+48",
    universal: "112",
    police: ["997"],
    ambulance: ["999"],
    fire: ["998"],
    mountainRescue: ["985"],
    notes: "985 reaches TOPR/GOPR mountain rescue directly.",
  },
  {
    countryCode: "PT",
    countryName: "Portugal",
    dialCode: "+351",
    universal: "112",
    police: ["112"],
    ambulance: ["112"],
    fire: ["112"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "RU",
    countryName: "Russia",
    dialCode: "+7",
    universal: "112",
    police: ["102"],
    ambulance: ["103"],
    fire: ["101"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "SE",
    countryName: "Sweden",
    dialCode: "+46",
    universal: "112",
    police: ["112"],
    ambulance: ["112"],
    fire: ["112"],
    mountainRescue: ["112"],
    notes: null,
  },
  {
    countryCode: "SG",
    countryName: "Singapore",
    dialCode: "+65",
    universal: null,
    police: ["999"],
    ambulance: ["995"],
    fire: ["995"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "SK",
    countryName: "Slovakia",
    dialCode: "+421",
    universal: "112",
    police: ["158"],
    ambulance: ["155"],
    fire: ["150"],
    mountainRescue: ["18300"],
    notes: "18300 is Horská záchranná služba (mountain rescue).",
  },
  {
    countryCode: "TH",
    countryName: "Thailand",
    dialCode: "+66",
    universal: "191",
    police: ["191"],
    ambulance: ["1669"],
    fire: ["199"],
    mountainRescue: [],
    notes: "1155 is the Tourist Police, with English-speaking operators.",
  },
  {
    countryCode: "TJ",
    countryName: "Tajikistan",
    dialCode: "+992",
    universal: null,
    police: ["102"],
    ambulance: ["103"],
    fire: ["101"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "TR",
    countryName: "Türkiye",
    dialCode: "+90",
    universal: "112",
    police: ["112"],
    ambulance: ["112"],
    fire: ["112"],
    mountainRescue: ["112"],
    notes: "AKUT mountain rescue is dispatched through 112.",
  },
  {
    countryCode: "TZ",
    countryName: "Tanzania",
    dialCode: "+255",
    universal: "112",
    police: ["112"],
    ambulance: ["114"],
    fire: ["114"],
    mountainRescue: [],
    notes: "Covers Kilimanjaro. Park rescue is coordinated by the gate wardens.",
  },
  {
    countryCode: "US",
    countryName: "United States",
    dialCode: "+1",
    universal: "911",
    police: ["911"],
    ambulance: ["911"],
    fire: ["911"],
    mountainRescue: ["911"],
    notes: null,
  },
  {
    countryCode: "UZ",
    countryName: "Uzbekistan",
    dialCode: "+998",
    universal: null,
    police: ["102"],
    ambulance: ["103"],
    fire: ["101"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "VN",
    countryName: "Vietnam",
    dialCode: "+84",
    universal: null,
    police: ["113"],
    ambulance: ["115"],
    fire: ["114"],
    mountainRescue: [],
    notes: null,
  },
  {
    countryCode: "ZA",
    countryName: "South Africa",
    dialCode: "+27",
    universal: null,
    police: ["10111"],
    ambulance: ["10177"],
    fire: ["10177"],
    mountainRescue: [],
    notes: "112 from a mobile reaches an emergency call centre.",
  },
];

/* ── Versioning ──────────────────────────────────────────────────────────── */

/**
 * The version the app compares against its cached copy.
 *
 * **Bump this by one in the same commit that edits the table above.** The test
 * `emergencyNumbers.service.test.ts` fails the build if you forget — see
 * `EMERGENCY_DIRECTORY_CHECKSUM` for how.
 *
 * A monotonic integer rather than a date or a semver string because the only
 * question the app ever asks is "is the server's number bigger than mine?".
 * That comparison is one line on the device and cannot be got wrong; parsing a
 * date on a phone whose clock is wrong can.
 */
export const EMERGENCY_DIRECTORY_VERSION = 1;

/**
 * The date the table above last changed, `YYYY-MM-DD`.
 *
 * Not used for the freshness decision — `EMERGENCY_DIRECTORY_VERSION` is. This
 * exists so the app can show "Emergency numbers updated 6 Aug 2026" on its
 * safety screen, which is what makes a trekker trust the offline copy enough to
 * rely on it.
 */
export const EMERGENCY_DIRECTORY_UPDATED_AT = "2026-08-06";

/**
 * SHA-256 of the table's content, pinned by hand.
 *
 * This is the guard that makes `EMERGENCY_DIRECTORY_VERSION` trustworthy.
 *
 * Day 2 solved the same problem at *runtime*: the offline package fingerprints
 * itself on every request and bumps its own counter, because five different
 * editor screens could change a booking and any of them could forget. Here there
 * is exactly one way to change the data — editing this file — so the check can
 * happen earlier and cheaper, at **build time**:
 *
 *   1. You edit a number. The computed hash no longer matches this constant.
 *   2. CI fails with "the table changed but the checksum was not updated".
 *   3. You bump `EMERGENCY_DIRECTORY_VERSION` and paste the new checksum
 *      (the failing test prints it).
 *
 * The result is that it is *impossible* to ship a changed table with an
 * unchanged version number — which would leave every phone in the field
 * convinced it was already up to date. That is the failure this constant exists
 * to prevent, and it is a safety failure, not a caching one.
 *
 * The checksum is also served to the app, which stores it next to its cached
 * copy. It lets the device verify its own storage was not corrupted, without
 * having to re-download to find out.
 */
export const EMERGENCY_DIRECTORY_CHECKSUM =
  "4dbefcc14002d60f69ff168e5135eb59bcb2d7e2ec9ead45a0ac89f1d47f8a81";

/**
 * The country used when a trek does not name one.
 *
 * Mirrors `DEFAULT_COUNTRY_CODE` in `offlinePackage.service.ts` — the two must
 * agree, because that file decides which country the offline bundle claims and
 * this one decides which numbers the app has for it.
 */
export const DEFAULT_EMERGENCY_COUNTRY = "NP";

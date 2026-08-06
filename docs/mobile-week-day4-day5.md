# Mobile Week — Day 4 & Day 5

**Day 4:** Local Emergency Number Bundle
**Day 5:** Testing

Branch: `feature/ds/mobile-backend` · Date: 6 August 2026

This document explains everything built today, line by line, assuming no prior knowledge of the codebase. If you have never touched this project, start at section 1 and read straight through.

---

## Table of contents

1. [What we were asked to build](#1-what-we-were-asked-to-build)
2. [Background: why an emergency number endpoint exists at all](#2-background-why-an-emergency-number-endpoint-exists-at-all)
3. [The big decision: a source file, not a database table](#3-the-big-decision-a-source-file-not-a-database-table)
4. [File 1 — `data/emergencyNumbers.ts` (the table)](#4-file-1--dataemergencynumbersts-the-table)
5. [The versioning problem, and how we solved it](#5-the-versioning-problem-and-how-we-solved-it)
6. [File 2 — `utils/stableStringify.ts` (a helper we had to move)](#6-file-2--utilsstablestringifyts-a-helper-we-had-to-move)
7. [File 3 — `services/emergencyNumbers.service.ts` (the logic)](#7-file-3--servicesemergencynumbersserviceits-the-logic)
8. [File 4 — `controllers/emergencyNumbers.controller.ts` (the HTTP layer)](#8-file-4--controllersemergencynumberscontrollerts-the-http-layer)
9. [File 5 — the routes](#9-file-5--the-routes)
10. [Day 5 — what "testing" means here](#10-day-5--what-testing-means-here)
11. [Day 5, test 1 — the offline package is complete](#11-day-5-test-1--the-offline-package-is-complete)
12. [Day 5, test 2 — the device token lifecycle](#12-day-5-test-2--the-device-token-lifecycle)
13. [Day 5, test 3 — mobile payloads are smaller than web](#13-day-5-test-3--mobile-payloads-are-smaller-than-web)
14. [Results: every number we measured](#14-results-every-number-we-measured)
15. [What was deliberately NOT done](#15-what-was-deliberately-not-done)
16. [Known limitations and what the next day should pick up](#16-known-limitations-and-what-the-next-day-should-pick-up)
17. [Quick reference: the new API](#17-quick-reference-the-new-api)

---

## 1. What we were asked to build

**Day 4 — Local Emergency Number Bundle**

> - `GET /mobile/emergency-numbers` — full country-to-emergency-number table for local bundling in app
> - Versioned so app knows when to refresh the bundled table
>
> *Deliverable: Emergency number table available for offline bundling*

**Day 5 — Testing**

> - Test offline package contains everything needed for offline itinerary view
> - Test device token registration, refresh, and removal
> - Test mobile dashboard payloads are meaningfully smaller than web equivalents
>
> *Deliverable: All tests pass*

Both deliverables are met. 246 tests pass across the seven mobile files (166 existed before today, 80 were added).

### Files created today

| File | Lines | What it is |
|---|---|---|
| `apps/api/src/data/emergencyNumbers.ts` | ~700 | The country → emergency number table |
| `apps/api/src/services/emergencyNumbers.service.ts` | ~230 | Versioning, integrity checking, filtering |
| `apps/api/src/controllers/emergencyNumbers.controller.ts` | ~160 | HTTP: caching, ETags, `304` |
| `apps/api/src/utils/stableStringify.ts` | ~35 | Deterministic JSON, moved out of Day 2's file |
| `apps/api/src/services/emergencyNumbers.service.test.ts` | ~290 | 34 Day 4 unit tests |
| `apps/api/src/mobile.contract.test.ts` | ~800 | 34 Day 5 contract tests |

### Files modified today

| File | Change |
|---|---|
| `apps/api/src/routes/mobile.routes.ts` | Two new routes |
| `apps/api/src/routes/mobile.routes.test.ts` | +12 route tests for the new endpoints |
| `apps/api/src/services/offlinePackage.service.ts` | `stableStringify` moved out, re-exported |

---

## 2. Background: why an emergency number endpoint exists at all

If you are new to this project, this section is the most important one. Everything in Day 4 follows from it.

The Funtush Backend Guide, §10, describes the **SOS 4-layer offline pipeline**. When a trekker presses the SOS button, four things fire at once, independently, so that if one fails the next is already running. Layer 1 is:

> **Native emergency phone call** — fires **first, always**. Uses the cellular **voice** network (works where data fails). Emergency numbers are **bundled in the app binary**, indexed by the trek's registered country — no internet lookup.

Read that last clause again: **no internet lookup**.

This is the single most counter-intuitive thing about today's work. We are building an API endpoint that serves emergency numbers, and **the SOS button never calls it**. Not once. Not as a fallback.

### Why not?

Because of where trekkers are. On the Everest Base Camp trail there is a voice signal in maybe half the villages and a data signal in far fewer. The whole design of layer 1 rests on one fact: **the voice network works in places the data network does not.** A phone can dial 100 from a valley where it cannot load a web page.

So if the app had to fetch the emergency number over HTTP before dialling it, layer 1 would fail in exactly the conditions it was designed for. The number must already be on the phone, in the phone's own storage, before the emergency starts.

### Then what is the endpoint for?

**Refreshing that on-device copy.**

Imagine the app ships in March. Its binary contains March's numbers. In June, a country changes its ambulance service — this really happens; Sri Lanka introduced 1990 as its national ambulance line, India consolidated onto 112. In September, a trekker who has not updated the app in six months presses SOS and dials a number that no longer answers.

The only fix without this endpoint is an app-store release the user has to accept. The user who has not updated in six months is precisely the user who will not accept it.

So `GET /mobile/emergency-numbers` is a **sync endpoint**, not a lookup endpoint:

```
App launches, has a good connection
  → GET /mobile/emergency-numbers/version    (134 bytes)
  → "version 4?  I have version 3. Time to refresh."
  → GET /mobile/emergency-numbers            (11.5 KB, once)
  → writes the whole table to device storage
  → …weeks pass, trekker walks out of coverage…
  → SOS pressed → reads device storage → dials → no network involved
```

The endpoint runs on a good day so that the phone is correct on a bad one. Hold that picture; every design choice below follows from it.

---

## 3. The big decision: a source file, not a database table

Every other list in this codebase lives in PostgreSQL. Agencies, bookings, packing lists, the agency's own emergency contacts — all database tables. This one is a `.ts` file checked into git.

That is unusual enough to justify carefully. Four reasons:

### 3.1 It has no tenant dimension

Backend Guide §4 is the project's number-one rule:

> An agency must never see, query, or even know about another agency's existence or data.

Every table has a `tenant_id` and every query filters by it. But Nepal's ambulance number is `102` for every agency on the platform. There is nothing to filter. The main structural reason to be in Postgres — relational data that needs per-tenant slicing — simply does not apply.

### 3.2 A wrong number here can kill somebody

This is the real argument.

If the table were in the database, an admin screen could change a number with one `UPDATE`. That change is live in milliseconds, seen by nobody, reviewed by nobody.

As a source file, changing a number means: open a pull request → a colleague reviews the diff → CI runs → deploy. The data gets the same scrutiny as the code, because the consequence of getting it wrong is the same as the consequence of a bad `if` statement in the SOS path.

**Store data at the level of care its failure mode deserves.** For most data, "a database row" is right. For the number a trekker dials from a ridge, it is not.

### 3.3 It has to survive a bad day

If Postgres is unreachable, a database-backed version of this endpoint returns a 500. When would that matter? Exactly when an agency is trying to get its guides' phones current before a departure.

A frozen constant held in the Node process's memory has no failure mode. There is no connection to drop.

### 3.4 It is tiny and read-only

57 countries. Changed a handful of times a year. Always read in full, never queried, never joined, never sorted differently. A database is the wrong shape of tool for that — you would be paying a network round trip and a query planner for a hard-coded array.

### The cost, stated honestly

**Updating a number requires a code deploy.** There is no admin screen for it.

That is a real cost and we accepted it deliberately. It is listed again in [section 16](#16-known-limitations-and-what-the-next-day-should-pick-up) so nobody later thinks it was an oversight. Given how rarely national emergency numbers change, and how badly we want review on the ones that do, it is the right trade — but it is a trade.

### One more distinction: two kinds of emergency number

There are **two** sets of emergency numbers in this system and they must not be confused:

| | National numbers | Trek-specific numbers |
|---|---|---|
| **Examples** | Nepal police `100`, Swiss air rescue `1414` | "Himalaya Trails ops desk", "Simrik Air rescue" |
| **Depends on** | which *country* you are in | which *trek* you booked |
| **Owner** | the platform (all agencies share them) | one agency (tenant-scoped) |
| **Where they live** | this file (`data/emergencyNumbers.ts`) | the `agency_emergency_contacts` table |
| **How they reach the phone** | Day 4's endpoint | Day 2's offline package |

Two different owners, two different lifetimes, two different storage decisions. The Day 5 tests check that these two halves agree with each other — see [section 11](#11-day-5-test-1--the-offline-package-is-complete).

---

## 4. File 1 — `data/emergencyNumbers.ts` (the table)

### 4.1 The shape of one country

```ts
export interface CountryEmergencyNumbers {
  countryCode: string;
  countryName: string;
  dialCode: string;
  universal: string | null;
  police: string[];
  ambulance: string[];
  fire: string[];
  mountainRescue: string[];
  notes: string | null;
}
```

Field by field:

**`countryCode: string`** — ISO 3166-1 alpha-2, uppercase: `"NP"`, `"IN"`, `"CH"`. This is the join key. `TrekPackage.countryCode` in the database holds the same format, and Day 2's offline package copies it into `emergency.countryCode`. The phone reads that field, looks up this code in its cached table, and gets the numbers. If the two formats ever disagreed, the SOS screen would render nothing.

**`countryName: string`** — `"Nepal"`, `"Switzerland"`. Included so the app can render a country picker without shipping its *own* code-to-name lookup table. Sending 6 extra bytes per country is cheaper than making the client maintain a parallel dataset that can drift.

**`dialCode: string`** — `"+977"`. Not the emergency number; the international prefix. It is here because a phone roaming on a foreign network sometimes cannot reach a short national code, and the app then falls back to dialling the agency's contacts in full international form. Short codes are the primary path; this is the backup for the backup.

**`universal: string | null`** — the one number that reaches every service. `"112"` across the EU, `"911"` in North America, `"999"` in Bangladesh. `null` where the country has no such number and the caller must choose a service.

This nullability is real data, not laziness. Nepal genuinely has no universal number — you dial `100` for police, `102` for ambulance, `101` for fire. Bhutan is worse: `112` there is the **ambulance**, not a universal number, so a tourist muscle-memory-dialling 112 expecting an operator gets an ambulance dispatcher.

The app renders `universal` first and biggest when it is present. Under stress, one button beats three.

**`police` / `ambulance` / `fire`: `string[]`** — arrays, never bare strings, even where a country has exactly one number today.

Two reasons:

1. Some countries genuinely have several. India answers medical calls on both `102` and `108`; Indonesia on `118` and `119`. A single-string field would force us to drop one — and dropping the one that works in that particular province is not a decision we get to make from Kathmandu.
2. It keeps the app's rendering code uniform. It always maps over a list and draws one call button per entry. No `if (Array.isArray(...))` branching on a phone.

An empty array means "this country has no separate number for that service", which is normal wherever `112` or `911` answers everything.

**`mountainRescue: string[]`** — the field that makes this table worth maintaining ourselves instead of installing an npm package of emergency numbers.

On a trek, "call the police" is often the *wrong first call*. Switzerland's REGA (`1414`) and Poland's TOPR (`985`) launch helicopters directly; the police switchboard is a slower path to the same helicopter. For a casualty at altitude, that difference is measured in hours.

No generic emergency-number dataset models this, because no generic dataset is built for trekking. Ours is.

**`notes: string | null`** — one short line the app prints under the buttons. Deliberately terse — it is read on a small screen in bad conditions. Examples from the table:

```ts
notes: "1414 is Rega air rescue — the correct first call for a mountain casualty."
notes: "Ambulance is 113 here, not 112 — the numbers are not the EU defaults."
notes: "112 is the ambulance here, not a universal number — pick the service."
```

Each of those is a mistake a European trekker would plausibly make.

### 4.2 The table itself

```ts
export const EMERGENCY_NUMBERS: readonly CountryEmergencyNumbers[] = [
  { countryCode: "AE", /* … */ },
  { countryCode: "AR", /* … */ },
  // …57 entries, sorted by country code…
];
```

**57 countries**, sorted by `countryCode`. Coverage is *chosen*, not exhaustive:

- **Trekking destinations** first — every country a `TrekPackage.countryCode` could realistically name. Nepal, India, Bhutan, Pakistan, China (which covers Tibet), Tanzania (Kilimanjaro), Peru, Argentina, Chile, the Alpine countries, Iceland, Norway, New Zealand.
- **Source markets** second — where trekkers fly in from. The app is open on their phone before they land and after they leave.

Two mechanical details worth noticing:

**Sorted by country code.** Not cosmetic. The content checksum ([section 5](#5-the-versioning-problem-and-how-we-solved-it)) is computed over the array *in order*, so a stable sort keeps a diff readable and stops "insert a country in the middle" from looking like a rewrite. There is a test asserting the sort holds.

**`readonly`, but not `as const`.** The `readonly` on the array type stops any code from `push`ing a country into the shared table at runtime.

We deliberately did **not** write `as const` on the literal. `as const` would also make every inner `string[]` into a `readonly string[]`, which then does not satisfy the `CountryEmergencyNumbers` interface — whose arrays are mutable, because the service hands out mutable *copies*. (This is the same TypeScript trap Day 2 hit with Prisma's `orderBy`, where `as const` made an array readonly and Prisma rejected it. Worth remembering: `as const` is deeper than it looks.)

---

## 5. The versioning problem, and how we solved it

The task says: *"Versioned so app knows when to refresh the bundled table."* This section is how, and why the obvious approach is not good enough.

### 5.1 The naive version

```ts
export const EMERGENCY_DIRECTORY_VERSION = 1;
```

Serve that number. The app compares it to its cached number. Bigger ⇒ re-download.

Simple and correct — **as long as everybody remembers to bump it**.

They will not. Someone will fix a typo in Bhutan's ambulance number, ship it, and leave the version at 4. Every phone in the field then checks in, sees version 4, concludes "I am current", and keeps the old number. Forever. The bug is completely silent and only surfaces the day somebody actually presses SOS in Bhutan.

**A missed version bump here is a safety bug, not a caching bug.** So "remember to bump it" is not an acceptable design.

### 5.2 How Day 2 solved the same problem

Day 2 hit this exact problem with the offline package. A booking's bundle is assembled from six different tables, edited from five different screens. Asking every editor screen to bump a counter meant five call sites today and an unbounded number later.

Day 2's solution was to **invert it**: assemble the bundle, hash the content, compare the hash to the one stored on the booking. Different hash ⇒ something changed ⇒ bump. This cannot miss a change, and no editor screen needs to know the offline package exists.

### 5.3 Our version: the same idea, moved to build time

Here there is exactly **one** way to change the data: editing `data/emergencyNumbers.ts`. That means the check can happen earlier and far more cheaply — at build time rather than on every request.

```ts
export const EMERGENCY_DIRECTORY_VERSION = 1;
export const EMERGENCY_DIRECTORY_UPDATED_AT = "2026-08-06";
export const EMERGENCY_DIRECTORY_CHECKSUM =
  "4dbefcc14002d60f69ff168e5135eb59bcb2d7e2ec9ead45a0ac89f1d47f8a81";
```

And in the test file:

```ts
it("matches its pinned checksum — bump the version when this fails", () => {
  expect(computeDirectoryChecksum()).toBe(EMERGENCY_DIRECTORY_CHECKSUM);
});
```

The workflow this creates:

1. You edit a phone number.
2. CI fails: *"expected `<new hash>` to be `<old hash>`"*.
3. You bump `EMERGENCY_DIRECTORY_VERSION` from 1 to 2, set `EMERGENCY_DIRECTORY_UPDATED_AT` to today, and paste the new hash the failing test just printed.

The result is that **it is impossible to ship a changed table under an unchanged version number**. The failure mode from 5.1 has been designed out, not documented away.

The test carries a comment block explaining exactly this, so the person who trips it is not confused:

```ts
// ── If this test fails, you edited `data/emergencyNumbers.ts`. ──────────
//
// That is fine and expected. Do two things, in the same commit:
//   1. Increment `EMERGENCY_DIRECTORY_VERSION` by one, and set
//      `EMERGENCY_DIRECTORY_UPDATED_AT` to today.
//   2. Paste the "Received" value below into `EMERGENCY_DIRECTORY_CHECKSUM`.
```

> **General lesson.** When a rule has to hold ("the version reflects the content"), do not write it in a comment and hope. Find the earliest place a machine can check it and let the machine fail the build. Day 2 did this at runtime because it had to; Day 4 does it at build time because it can. Build time is better — it fails on the developer's laptop instead of on a phone in the mountains.

### 5.4 Why an integer, not a date or a semver string

The only question the app ever asks is *"is the server's number bigger than mine?"*.

That comparison is one line on the device and cannot be got wrong. Parsing a date on a phone whose clock is wrong — and trekkers' phones have wrong clocks, because they cross time zones and lose signal for days — can be.

`EMERGENCY_DIRECTORY_UPDATED_AT` exists purely for **display**: the app shows "Emergency numbers updated 6 Aug 2026" on its safety screen. That is what makes a trekker trust the offline copy enough to rely on it. It is never used to make the refresh decision.

### 5.5 What the checksum does for the app

The checksum is served to the app, not just used in CI. The app stores it alongside its cached table, and can re-hash its own storage to verify it was not corrupted — without downloading 11.5 KB to find out. On a metered Himalayan SIM that difference matters.

---

## 6. File 2 — `utils/stableStringify.ts` (a helper we had to move)

Small file, but the *reason* for it is worth understanding.

```ts
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);

  return `{${entries.join(",")}}`;
}
```

Line by line:

- **Line 2** — a primitive (`string`, `number`, `boolean`, `null`) or `undefined`. `JSON.stringify(undefined)` returns `undefined` (the value, not a string), so `?? "null"` supplies a string.
- **Line 3** — an array: recurse into each element and **keep the order**.
- **Lines 5–7** — an object: take its `[key, value]` pairs, **sort by key**, recurse into each value.

### Why sort the keys?

The hash must depend only on the **values**. Plain `JSON.stringify` preserves *insertion* order, so:

```js
JSON.stringify({ a: 1, b: 2 })  // '{"a":1,"b":2}'
JSON.stringify({ b: 2, a: 1 })  // '{"b":2,"a":1}'   ← different string, same data
```

Without sorting, a refactor that reordered two fields would change the hash, fire the CI check, and — in Day 2's runtime version — tell every phone in the field to re-download. Sorting removes that entire class of false positive.

### Why *not* sort the arrays?

Because a reordered array genuinely **is** different data:

- an itinerary is ordered (day 2 follows day 1);
- `police: ["102", "108"]` lists the *preferred* number first.

Swapping those is a real change and should produce a different hash. There is a test for exactly this pair of behaviours:

```ts
it("ignores key order when fingerprinting, but not array order", () => { … });
```

### Why the file moved

It was written on Day 2 inside `offlinePackage.service.ts`. Day 4 needed it too — but `offlinePackage.service.ts` starts with:

```ts
import { db } from "@funtush/database";
```

Importing `stableStringify` from there would have dragged the entire Prisma client into `emergencyNumbers.service.ts`, quietly destroying the "no database dependency" property that [section 3.3](#33-it-has-to-survive-a-bad-day) exists to protect. So the helper moved to `utils/`, and Day 2's file re-exports it:

```ts
export { stableStringify };
```

**Important TypeScript gotcha, and the same one Day 3 hit with `httpError`:** a re-export does **not** bring the name into the re-exporting file's own scope. `offlinePackage.service.ts` still calls `stableStringify` inside its `contentHash` function, so it needs a *separate* import line as well:

```ts
import { stableStringify } from "../utils/stableStringify";  // for our own use
export { stableStringify };                                   // for our callers
```

Forget the import line and you get `ReferenceError: stableStringify is not defined` at runtime, not a compile error.

---

## 7. File 3 — `services/emergencyNumbers.service.ts` (the logic)

### 7.1 A note before the code: what is NOT in this file

Look at the top of the test file for this service:

```ts
import { describe, it, expect } from "vitest";
```

That is the whole import block. **No `vi.mock("@funtush/database")`.**

That absence is deliberate and load-bearing. This service has no database dependency, and the missing mock is the cheapest possible proof of it. If somebody later adds a Prisma call to this service, the test file stops running and they find out immediately.

There is a comment in the test file saying exactly this, so the next person does not "helpfully" add the mock.

### 7.2 The response shapes

```ts
export interface EmergencyDirectoryVersion {
  version: number;
  checksum: string;
  updatedAt: string;
  countryCount: number;
}

export interface EmergencyDirectory extends EmergencyDirectoryVersion {
  defaultCountryCode: string;
  filtered: boolean;
  countries: CountryEmergencyNumbers[];
}
```

`EmergencyDirectory` **extends** `EmergencyDirectoryVersion`, which encodes the relationship in the type system: the full response is the probe response plus the data. If a field is added to the probe, the full response gets it automatically and cannot drift.

**`filtered: boolean`** deserves its own paragraph. It is `true` when a `?countries=` filter was applied. Without it, an app that fetched `?countries=NP` and wrote the response to storage would **silently shrink its table to one country** — and the trekker's next trek, in India, would have no numbers at all.

The flag lets the app say: *"this is a partial reply, merge it, do not replace with it."* This is the kind of bug that is invisible in every test and catastrophic in the field, so it is guarded twice — the flag here, and the ETag in the controller ([section 8.3](#83-the-etag)).

**`countryCount`** always reports the size of the **whole** table, even on a filtered reply. It is a property of the directory, not of this particular response. Together with `filtered`, it lets the app distinguish "I have 2 of 57" from "I have all 57".

### 7.3 `computeDirectoryChecksum`

```ts
export function computeDirectoryChecksum(
  countries: readonly CountryEmergencyNumbers[] = EMERGENCY_NUMBERS
): string {
  return createHash("sha256").update(stableStringify(countries)).digest("hex");
}
```

- `createHash("sha256")` — Node's built-in hasher, from `node:crypto`.
- `.update(...)` feeds it the deterministic string; `.digest("hex")` produces the 64-character hex output.
- The **default parameter** (`= EMERGENCY_NUMBERS`) means production calls it with no arguments, while tests can pass a deliberately-different table to prove the check actually fires rather than being decorative.

### 7.4 `assertDirectoryIntegrity`

```ts
export function assertDirectoryIntegrity(): void {
  const computed = computeDirectoryChecksum();
  if (computed !== EMERGENCY_DIRECTORY_CHECKSUM) {
    throw httpError(500, "Emergency number table failed its integrity check — …");
  }
}
```

Called on **every request**, not once at module load. It costs a few microseconds of hashing, and it protects against an in-memory mutation (some other module doing `(EMERGENCY_NUMBERS as any).push(...)`) going unnoticed. This is the one dataset in the codebase where "probably fine" is not good enough.

**Why it throws instead of serving the data anyway.** This looks harsh — surely stale-but-present numbers beat a 500? No, and the reasoning is worth internalising:

- A **failed refresh** leaves the app on its previous copy. That copy still works offline. The trekker is fine.
- A **successful refresh of unverified data** makes the app *overwrite* a known-good copy with one whose version number we cannot vouch for — and then **stop asking**, because it now believes it is current.

Failing loudly is strictly safer than succeeding quietly. When you cannot vouch for data, do not hand it to a client that will treat it as authoritative.

### 7.5 `parseCountryFilter`

```ts
export function parseCountryFilter(raw: unknown): string[] | null {
  const values = Array.isArray(raw) ? raw : [raw];

  const codes = values
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toUpperCase())
    .filter((v) => /^[A-Z]{2}$/.test(v));

  const unique = [...new Set(codes)].sort();

  if (unique.length === 0) return null;

  if (unique.length > MAX_COUNTRY_FILTER) {
    throw httpError(400, `countries accepts at most ${MAX_COUNTRY_FILTER} ISO codes — …`);
  }

  return unique;
}
```

Step by step:

1. **`Array.isArray(raw) ? raw : [raw]`** — Express parses `?countries=NP&countries=IN` into an *array*, and `?countries=NP` into a *string*. Normalising to an array first means one code path handles both.
2. **`.filter((v): v is string => …)`** — a **type predicate**. `v is string` tells TypeScript that everything surviving this filter is a `string`, so the following `.split(",")` compiles. Without it TypeScript only knows the values are `unknown`.
3. **`.flatMap((v) => v.split(","))`** — handles the comma form. `flatMap` rather than `map` because `split` returns an array per element, and we want one flat list.
4. **`.trim().toUpperCase()`** — accept `"np"`, `" NP "`, `"nP"`.
5. **`.filter((v) => /^[A-Z]{2}$/.test(v))`** — accept *exactly* two ASCII letters and nothing else.

   That strictness matters more than it looks. The value ends up inside an HTTP ETag ([section 8.3](#83-the-etag)). Letting arbitrary text through would let a caller mint unlimited distinct cache keys for the same body — a cheap way to blow out a CDN cache.

6. **`[...new Set(codes)].sort()`** — de-duplicate, then sort. Sorting makes the ETag independent of the order the caller happened to list the codes in, so `?countries=NP,IN` and `?countries=in,np,NP` share one cache entry instead of two.
7. **`length === 0 → null`** — "no filter", meaning the full table. Note that an explicitly *empty* filter (`?countries=`) also returns `null`. An empty list is far more likely a client bug than a genuine request for zero countries, and answering with the full table is the harmless reading.
8. **`length > MAX_COUNTRY_FILTER → 400`** — the filter exists so a phone can top up one country cheaply, not so a client can hand-roll the full table one long URL at a time. Ten is the cap.

### 7.6 `getEmergencyDirectory`

```ts
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
      police: [...entry.police],
      ambulance: [...entry.ambulance],
      fire: [...entry.fire],
      mountainRescue: [...entry.mountainRescue],
    })),
  };
}
```

Three things to notice:

**A `Set`, not `.includes()`.** `wanted.has(code)` is O(1); `array.includes(code)` is O(n). With 57 countries and 10 filter codes it makes no practical difference — but a `Set` is the right structure for "is this in my list", and using the right structure by default is how you avoid the version of this loop that *does* matter.

**Unknown country codes are ignored, not 404'd.** `?countries=NP,XX` returns Nepal. Failing the whole request would mean one typo in a trek's `countryCode` leaves the phone with *no* numbers, when it could have had the ones that did resolve. Same instinct as Day 2's "a partial bundle beats no bundle".

**The arrays are copied, not just spread.**

```ts
{ ...entry }              // copies the object — but `police` still points at the ORIGINAL array
{ ...entry, police: [...entry.police] }   // copies the array too
```

`EMERGENCY_NUMBERS` is process-wide shared state that lives for the life of the Node process. If a caller did `response.countries[0].police.push("999")` on a shallow copy, it would corrupt the real table and **every later response would be wrong until restart**. This is a classic shared-mutable-state bug and there is a test for it:

```ts
it("hands out copies, so a caller cannot corrupt the shared table", () => { … });
```

### 7.7 `primaryEmergencyNumber` — logic that is not reachable from a route

```ts
export function primaryEmergencyNumber(countryCode: string | null | undefined): string | null {
  const entry =
    findCountryEmergencyNumbers(countryCode) ??
    findCountryEmergencyNumbers(DEFAULT_EMERGENCY_COUNTRY);
  if (!entry) return null;

  return entry.mountainRescue[0] ?? entry.universal ?? entry.ambulance[0] ?? entry.police[0] ?? null;
}
```

This is **server-side** logic, not exposed by any route. It exists because Backend Guide §10 requires an SOS incident record to store the *"emergency number called"* — so the server must derive that the same way the phone did.

The `??` chain encodes the medical reality of a trekking incident, in priority order:

1. **`mountainRescue[0]`** — a casualty on a ridge needs a helicopter. Where a dedicated service exists, it is the fastest route to one.
2. **`universal`** — where no such service exists, one number reaches everything.
3. **`ambulance[0]`** — medical first, for a medical emergency.
4. **`police[0]`** — last resort.

`??` (nullish coalescing) rather than `||` is deliberate: `||` would also skip over the empty string `""`, which would silently hide a data bug where a number was blanked. `??` only falls through on `null`/`undefined`. (`mountainRescue[0]` on an empty array *is* `undefined`, which is exactly the fall-through we want.)

**The fallback to Nepal** for an unknown country is also deliberate. Some number beats no number, and a missing `countryCode` on a Funtush trek is overwhelmingly likely to be a Nepali trek with an unfilled field — Funtush launches in Nepal.

---

## 8. File 4 — `controllers/emergencyNumbers.controller.ts` (the HTTP layer)

The controller is thin, like every other one in this codebase: read the request, call the service, shape the response. The logic that *does* live here is caching — and this is the one endpoint in `/mobile` where caching is not a micro-optimisation but the feature itself.

### 8.1 The cache header — the one `public` endpoint in `/mobile`

```ts
const DIRECTORY_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
```

Compare with the rest of the mobile API:

| Endpoint | Cache-Control | Why |
|---|---|---|
| Day 1 dashboards | `private, max-age=30` | one trekker's bookings |
| Day 2 offline package | `private, max-age=300` | phone numbers, next-of-kin |
| Day 3 device routes | `no-store` | echoes a device identifier |
| **Day 4 emergency numbers** | **`public, max-age=86400`** | **identical for every caller** |

`private` exists to stop a shared cache (a CDN, a corporate proxy) from serving one user's data to another. That risk is real for a dashboard full of one trekker's bookings. Here it does not apply at all: this response is byte-for-byte identical for every caller on the planet and contains no personal data whatsoever.

Marking it `public` lets it be cached once at the edge and served to thousands of phones without ever touching the API. For a table that changes a few times a year, that is exactly right.

`stale-while-revalidate=604800` (7 days) means: *if the copy is up to a week past its expiry, use it anyway and fetch a fresh one in the background.* For emergency numbers that is the correct failure mode — **never block, never show nothing**.

> **The lesson.** `private` is not automatically "the safe default". It is the right answer for personal data and the wrong answer for shared data — where it throws away most of the caching benefit for no security gain. Ask what the data *is*, then choose.

### 8.2 `parseKnownDirectoryVersion` — two doors in

```ts
export function parseKnownDirectoryVersion(req: Request): number | null {
  const header = req.get("if-none-match");
  if (header) {
    const match = /(\d+)/.exec(header);
    if (match) return Number(match[1]);
  }

  const raw = req.query.knownVersion;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
```

Two ways to say "I already have version 3", copied from Day 2 for the same reason:

- **`If-None-Match`** is the standard HTTP mechanism, and some mobile HTTP stacks send it automatically from a cached response.
- **`?knownVersion=3`** exists because React Native's storage layer normally keeps the *parsed JSON* and throws the response headers away. The app has the `version` field; it does not have the ETag.

Supporting both means the app never has to store an extra value just to make caching work.

The regex `/(\d+)/` reads the **first run of digits** — which is why the ETag format puts the version *before* the country list. `"ev3+IN"` parses back to `3`, not to something involving the `IN`. Field order in a format is a decision, not an accident.

### 8.3 The ETag

```ts
export function directoryETag(version: number, countries: string[] | null): string {
  return countries === null ? `"ev${version}"` : `"ev${version}+${countries.join(",")}"`;
}
```

An ETag is just an opaque string identifying one version of a resource. The quotes are part of the HTTP syntax, not decoration.

**Why the filter is part of the tag.** A cache that stored a one-country reply under the plain `"ev3"` tag would then serve that one country to a client asking for the whole table. That is the "phone silently ends up with numbers for one country" failure again — and it is why we guard it twice: `filtered: true` in the payload, and the filter inside the ETag.

Since `parseCountryFilter` already sorted and de-duplicated, `?countries=NP,IN` and `?countries=in,np,NP` produce the same tag and share a cache entry.

### 8.4 The `304` path

```ts
if (knownVersion !== null && knownVersion >= directory.version) {
  res.status(304).end();
  return;
}
```

`304 Not Modified` means "you already have this; keep what you have". It carries **no body** — `.end()` rather than `.json()`.

**`>=` rather than `===`** is the interesting bit. If a client somehow reports a version *ahead* of ours (a rollback, a canary deploy, a mangled cache), resending the table would **downgrade** its cache to older data. `>=` leaves it alone. Same reasoning as Day 2's version check.

### 8.5 Why the probe endpoint exists at all

If the full endpoint already returns `304`, why also have `/version`?

1. A `304` still costs a full request/response round trip, and the server still builds the answer before deciding.
2. More importantly, a `304` **only works if the client remembered to send its validator**. The probe works even when it did not.

Belt and braces on the one table a phone must never silently lose. It measures **134 bytes** — small enough to poll on every app launch, and there is a test asserting it stays under 256 bytes:

```ts
it("stays small enough to poll often", () => {
  const bytes = Buffer.byteLength(JSON.stringify(getEmergencyDirectoryVersion()));
  expect(bytes).toBeLessThan(256);
});
```

If someone later adds the country list to the probe, that test fails and explains why it must not.

---

## 9. File 5 — the routes

```ts
router.get("/emergency-numbers/version", requireAuth, emergencyNumbersVersionController);
router.get("/emergency-numbers", requireAuth, emergencyNumbersController);
```

Two decisions here.

### 9.1 `requireAuth` but no `requireRole`

Every route from Days 1 and 2 has both guards:

```ts
router.get("/trekker/dashboard", requireAuth, requireRole(["TREKKER"]), …);
```

Days 3 and 4 deliberately drop `requireRole`. The reasoning is the same in both:

`requireRole` answers *"is this kind of user allowed to see this kind of data?"*. For "what number do you dial in Nepal?" there is no such question. Every signed-in person's app needs the same table.

Worse, a role list would mean **the next role someone invents ships with an empty emergency screen** — silently, with nobody noticing until an SOS. For safety features, an allow-list that must be maintained is a liability.

There is a test pinning this, so nobody adds a role list by reflex:

```ts
it("locks each route to the roles that own it", () => {
  // Four entries, not eight: the two device routes and the two emergency
  // number routes carry `requireAuth` only.
  expect(guardedRoles).toEqual([ /* four entries */ ]);
});
```

### 9.2 Why keep `requireAuth`, when the data is public information?

`112` is not a secret. So why require a token?

**Because nothing is lost by it.** SOS layer 1 dials from the copy already bundled in the app binary, so a signed-out user — or one with no signal at all — is unaffected. They always have numbers. This endpoint only *refreshes* that copy, and refreshing is a background thing a signed-in app does on a good connection.

**And something is gained.** An unauthenticated endpoint returning an 11.5 KB body on `api.funtush.com` is a free bandwidth amplifier for anyone who points a script at it. Behind a token, with a 24-hour public cache and a 134-byte probe in front of it, that is a non-issue.

### 9.3 Route order

`/emergency-numbers/version` is registered **before** `/emergency-numbers`. Express matches routes in declaration order.

Strictly, these two paths do not collide — Express would match them correctly either way. Registering the more specific path first is a *habit*, and it is what stops the next person from being bitten when somebody adds a wildcard. Day 2 did the same with the offline-package pair. There is a test asserting the probe is not swallowed by the broader route.

---

## 10. Day 5 — what "testing" means here

Days 1–4 each shipped their own unit tests, and those check that **each function behaves**. Day 5 asks for something different and, for a mobile backend, more important.

The three Day 5 items are not "add more unit tests". They are three **promises** the mobile API makes to the app:

1. The offline package contains everything the offline itinerary view needs.
2. Device token registration, refresh and removal work.
3. Mobile dashboard payloads are meaningfully smaller than the web equivalents.

Each is a claim about the **system**, not about a function. So they went into a new file, `apps/api/src/mobile.contract.test.ts`, written from the **app's point of view**.

### Why "contract" tests and not just more unit tests

Consider the failure this guards against. Somebody refactors `OFFLINE_BOOKING_SELECT` and drops the `photos` column. Every existing unit test still passes — `mapOfflinePackage` maps what it is given, `buildOfflinePackage` returns an object, `resolveVersion` still bumps correctly. Nothing is red.

And a trekker at 4,000 metres opens their itinerary and every photo is a grey box.

**That is the characteristic failure mode of a mobile backend: the server is fine, the phone is not.** Unit tests check the server. Contract tests check the phone's experience. Both are needed; only one of them was missing.

### One shared database mock

All three suites use one hoisted stand-in for Prisma:

```ts
const dbMock = vi.hoisted(() => ({
  booking: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  trekker: { findUnique: vi.fn() },
  guideProfile: { findFirst: vi.fn() },
  deviceToken: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  // …
}));

vi.mock("@funtush/database", () => ({ db: dbMock }));
```

**Why `vi.hoisted`?** Vitest moves `vi.mock` calls to the very top of the file, above the imports — otherwise the real module would load first and the mock would be too late. But that means any variable the mock factory references must *also* exist by then. `vi.hoisted` runs its callback in that same early phase, so `dbMock` is defined when the factory needs it. Without it you get `ReferenceError: Cannot access 'dbMock' before initialization`.

The result: **no Postgres, no network, ~26 ms for 34 tests.** Tests fast enough to run on every save are tests people actually run.

---

## 11. Day 5, test 1 — the offline package is complete

> *Test offline package contains everything needed for offline itinerary view*

### 11.1 The fixture

A fully-populated booking row, shaped exactly like Day 2's `OFFLINE_BOOKING_SELECT` produces: a 12-day Everest Base Camp trek, one itinerary row per day with photos and altitudes, a three-item packing list, two agency emergency contacts, a guide with a satellite phone, and a next-of-kin.

Deliberately **complete**, because the point of the suite is to prove that *when the data exists, all of it reaches the phone*. A separate test strips the optional parts back out to prove graceful degradation.

### 11.2 The contract itself, written down

```ts
const OFFLINE_KEYS_THAT_MUST_EXIST = [
  "bookingId", "version", "generatedAt", "contentUpdatedAt", "status",
  "trek.packageId", "trek.title", "trek.slug", "trek.difficulty",
  "trek.durationDays", "trek.startDate", "trek.endDate", "trek.countryCode",
  "trek.description",
  "agency.agencyId", "agency.name", "agency.phones", "agency.emails", "agency.address",
  "booking.groupSize", "booking.totalPrice", "booking.trekkerName", /* … */
  "guide", "itinerary", "packingList",
  "emergency.countryCode", "emergency.contacts", "emergency.trekkerEmergencyContact",
];
```

**This list *is* the contract.** It was written by walking the screens the app renders with no connection — the trek header, the day-by-day itinerary, the packing list, the "who do I call" panel — and writing down what each one needs.

There is a second, shorter list:

```ts
const OFFLINE_VALUES_THAT_MUST_BE_SET = [
  "bookingId", "trek.title", "trek.startDate", "trek.endDate", "trek.countryCode",
  "agency.name", "booking.trekkerName", "booking.trekkerPhone",
  "guide.name", "guide.phone", "emergency.countryCode",
  "emergency.trekkerEmergencyContact.name", "emergency.trekkerEmergencyContact.phone",
];
```

Two lists because **"must be present" and "must have a value" are different promises**. `booking.specialRequests` may legitimately be `null` — plenty of bookings have none. `guide.phone` may not be, when a guide is assigned.

### 11.3 The `undefined` test — the subtlest bug on this list

```ts
it("contains no `undefined`, which JSON would silently delete", () => {
  expect(undefinedPaths(bundle)).toEqual([]);
});
```

This matters far more than it looks, and it is worth understanding properly.

`JSON.stringify` **deletes** keys whose value is `undefined`:

```js
JSON.stringify({ phone: undefined })   // '{}'      ← the key is GONE
JSON.stringify({ phone: null })        // '{"phone":null}'
```

So a field that is `undefined` on the server does **not** arrive at the phone as an empty field. It does not arrive at all. On the device:

```js
booking.guide.phone        // undefined — the app renders "undefined" or crashes
```

whereas with `null` the app's `?? "Not set"` fallback works exactly as written.

**`null` is a value that means "nothing"; `undefined` is the absence of the field itself.** Over a JSON API only the first survives. The helper walks the whole structure and reports every path where an `undefined` hides:

```ts
function undefinedPaths(value: unknown, path = "$"): string[] {
  if (value === undefined) return [path];
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((e, i) => undefinedPaths(e, `${path}.${i}`));
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([k, e]) => undefinedPaths(e, `${path}.${k}`));
}
```

Returning **paths** rather than a boolean means a failure says `$.guide.satellitePhone` instead of `expected false to be true`.

### 11.4 The JSON round-trip test

```ts
it("survives the JSON round trip the device storage performs", () => {
  const roundTripped = JSON.parse(JSON.stringify(bundle));
  expect(roundTripped).toEqual(bundle);
});
```

The app does not keep the object we build. It keeps `JSON.parse(await AsyncStorage.getItem(...))`. Anything that does not survive that trip — a `Date` object, a Prisma `Decimal`, a `Map`, a `Set` — is a field that looks correct in a server test and is broken on the phone.

A companion test names the two specific offenders this codebase has hit:

```ts
expect(typeof bundle.booking.totalPrice).toBe("number");   // not a Prisma Decimal object
expect(typeof bundle.trek.startDate).toBe("string");       // not a Date
```

### 11.5 Completeness of the itinerary

```ts
expect(bundle.itinerary).toHaveLength(DURATION_DAYS);
expect(bundle.itinerary.map((d) => d.dayNumber)).toEqual([1, 2, 3, …, 12]);
```

A gap here is a day the trekker opens the app and sees a blank screen — **on the day they are walking it**. Checking the length is not enough; the day numbers must be a complete, ordered sequence.

### 11.6 Descriptions must NOT be truncated

```ts
it("keeps itinerary descriptions whole, unlike the dashboard", () => {
  const source = fullBookingRow().package.itineraries[0]!.description;
  for (const day of bundle.itinerary) {
    expect(day.description).toBe(source);
    expect(day.description!.length).toBeGreaterThan(140);
    expect(day.description).not.toContain("…");
  }
});
```

This is the test that shows the mobile rule is applied *honestly* rather than blindly.

Day 1's dashboard truncates descriptions to 140 characters — correct there, because the trekker can always tap through for the rest. Offline there is no "tap through". **That text *is* what they read at 4,000 metres.**

The rule was never "send less". It is **"send exactly what the screen needs"**. On a dashboard that means less; in an offline bundle it means everything. Two different answers from one principle, and the test pins both.

### 11.7 The self-contained test

```ts
it("is one self-contained document — the app never has to fetch anything else", () => {
  expect(bundle.trek.packageId).toBeTruthy();
  expect(bundle.trek.title).toBeTruthy();     // …not just packageId
  expect(bundle.agency.agencyId).toBeTruthy();
  expect(bundle.agency.name).toBeTruthy();    // …not just agencyId
  expect(bundle.guide?.name).toBeTruthy();    // …not just assignedGuideId
});
```

Every id in the bundle is accompanied by the human-readable value the screen renders. If any of these were id-only, the offline screen would have to resolve them over a network that is not there.

### 11.8 The Day 2 ↔ Day 4 join

Two tests connect today's work to Day 2's:

```ts
it("names a country the Day 4 emergency table actually has numbers for", () => {
  const country = findCountryEmergencyNumbers(bundle.emergency.countryCode);
  expect(country, `no emergency numbers for ${bundle.emergency.countryCode}`).not.toBeNull();
});

it("agrees with the Day 4 table on which country to fall back to", () => {
  expect(DEFAULT_EMERGENCY_COUNTRY).toBe(DEFAULT_COUNTRY_CODE);
});
```

This is the seam that makes SOS layer 1 work. The offline bundle stamps a country code; the app looks that exact code up in its bundled copy of the Day 4 table. If the two ever disagree, the SOS screen renders no number — and nothing else in the system would notice.

Two constants in two different files that must not drift. Now they cannot.

### 11.9 Graceful degradation

```ts
it("still produces a usable bundle when the optional parts are missing", () => { … });
```

A trek with no guide assigned yet, no branch and no next-of-kin on file must **still** cache its itinerary and its emergency numbers. The optional parts come back as `null` (never as a missing key), and everything that keeps a trekker safe is still there.

A partial bundle beats no bundle. Day 2 made that choice; Day 5 pins it.

---

## 12. Day 5, test 2 — the device token lifecycle

> *Test device token registration, refresh, and removal*

### 12.1 Why the Day 3 tests were not enough

Day 3 already has 36 unit tests for `deviceToken.service.ts`. They mock each Prisma call individually:

```ts
deviceTokenUpsert.mockResolvedValue({ id: "device-1", platform: "ANDROID", lastActiveAt: NOW });
```

That proves *each function calls Prisma correctly*. It cannot prove anything about a **sequence**, because the mock has no memory — every call returns the same canned answer regardless of what happened before.

But "registration, refresh and removal work" is a claim about a sequence. So this suite does the complementary thing: it builds a small **in-memory table** that keeps state between calls.

### 12.2 The fake table

```ts
function installFakeDeviceTable() {
  const rows: FakeDeviceRow[] = [];
  let nextId = 1;

  dbMock.deviceToken.findUnique.mockImplementation(({ where }) =>
    Promise.resolve(rows.find((r) => r.fcmToken === where.fcmToken) ?? null)
  );

  dbMock.deviceToken.upsert.mockImplementation(({ where, create, update }) => {
    const existing = rows.find((r) => r.fcmToken === where.fcmToken);
    if (existing) {
      Object.assign(existing, update);      // update in place
      return Promise.resolve(existing);
    }
    const row = { id: `device-${nextId++}`, createdAt: new Date(), ...create };
    rows.push(row);
    return Promise.resolve(row);
  });
  // …findMany, deleteMany, count…
}
```

It implements only the operations the service uses, and implements them **the way Postgres does** — most importantly, `fcmToken` is UNIQUE and `upsert` keys on it. That uniqueness is the whole basis of Day 3's shared-tablet behaviour, so a fake that got it wrong would test nothing.

Now the whole lifecycle runs against one table, and assertions can be about **what the table ends up holding**.

### 12.3 A bug the fake caught in itself

Worth recording, because it is instructive. My first `deleteMany` implementation was:

```ts
const tokenMatches = where.fcmToken === undefined ? true : /* … */;
const userMatches  = where.userId   === undefined ? true : /* … */;
if (tokenMatches && userMatches) rows.splice(i, 1);
```

The eviction path in `enforceDeviceLimit` calls:

```ts
db.deviceToken.deleteMany({ where: { id: { in: doomed } } });
```

No `fcmToken`, no `userId` — so both guards returned `true` and the fake **deleted every row in the table**. The test failed with a confusing `Cannot set properties of undefined`.

The fix generalises the matcher and, importantly, does **not** treat an unrecognised filter as "match everything":

```ts
const matchesField = (filter: string | { in: string[] } | undefined, actual: string) => {
  if (filter === undefined) return true;
  return typeof filter === "string" ? actual === filter : filter.in.includes(actual);
};

const matches =
  matchesField(where.id, row.id) &&
  matchesField(where.fcmToken, row.fcmToken) &&
  matchesField(where.userId, row.userId);
```

> **Lesson.** "Filter not specified ⇒ match everything" is the correct semantics for a `WHERE` clause, but it makes an *incomplete* fake dangerously wrong — a targeted delete silently becomes a table wipe. When you write a fake, make sure it understands every filter shape its callers use, and be suspicious of any default that widens rather than narrows.

### 12.4 What the lifecycle tests assert

**Registration.**
```ts
const result = await registerDeviceToken({ userId: "user-1", fcmToken: PHONE_TOKEN, platform: "android" });
expect(result.created).toBe(true);
expect(result.platform).toBe("ANDROID");   // lowercase "android" normalised on the way in
expect(rows).toHaveLength(1);
```
React Native's `Platform.OS` returns lowercase `"ios"` / `"android"`. Being liberal on input removes an entire category of "why is my device not registering" support ticket.

**No raw token ever leaves the database.**
```ts
expect(JSON.stringify(result)).not.toContain(PHONE_TOKEN);
expect(result.tokenPreview).toBe("…hone01");
expect(rows[0]!.fcmToken).toBe(PHONE_TOKEN);   // …but it IS in the DB, or push could not be delivered
```
Checking `JSON.stringify(result)` rather than individual fields catches a leak through *any* field, including one added later. A token is the address of somebody's phone; leaking one lets a third party spoof-target that device — the same instinct as Backend Guide §9's rule about payment credentials.

(This test also caught a mistake of mine: `maskToken` keeps the last **six** characters, so a token ending `phone01` masks to `…hone01`, not `…phone01`.)

**Refresh — eight app launches, one row.**
```ts
for (let i = 0; i < 8; i++) {
  const refresh = await registerDeviceToken({ userId: "user-1", fcmToken: PHONE_TOKEN, platform: "android" });
  expect(refresh.created).toBe(false);     // → HTTP 200, not 201
}
expect(rows).toHaveLength(1);
expect(rows[0]!.id).toBe("device-1");      // the same row, updated in place
```
The app calls register on **every launch**, not just at login, because Firebase rotates tokens on its own schedule and a rotated token we never hear about is a phone that has silently stopped receiving SOS alerts.

**Token rotation.** When Firebase issues a new token, both rows exist for a while. That is correct: the server cannot know the old one is dead until Firebase says so (`pruneInvalidTokens`) or it goes stale (270 days). Until then, sending to both is safe — **a duplicate notification is a nuisance, a missed SOS alert is not.**

**Phone + tablet stay separate.** The whole reason `device_tokens` replaced the old single `users.fcm_token` column: a guide with a phone and a work tablet must get the SOS alert on **both**, not on whichever registered last.

**Shared expedition tablet.**
```ts
await registerDeviceToken({ userId: "asha",  fcmToken: TABLET_TOKEN, platform: "android" });
await registerDeviceToken({ userId: "bina",  fcmToken: TABLET_TOKEN, platform: "android" });

expect(rows).toHaveLength(1);
expect(rows[0]!.userId).toBe("bina");
expect(await listUserDeviceTokens("asha")).toEqual([]);
```
Asha signs out, Bina signs in, Firebase hands the app the *same* token because it is the same installation. Three things could happen, and only one is right:

- Insert a second row → Asha's private itinerary is pushed to a tablet **Bina** is holding. Wrong.
- Reject as duplicate → Bina never gets push. Wrong.
- Move the row to Bina → correct, and what the unique index plus `update: { userId, … }` gives us.

**Removal, and idempotency.**
```ts
const second = await unregisterDeviceToken({ userId: "user-1", fcmToken: PHONE_TOKEN });
expect(second.removed).toBe(0);      // not a 404
```
Logout has to succeed. The token may already be gone — the user logged out elsewhere, a cleanup job pruned it, or the app is retrying a request that actually worked. Reporting failure would leave the app showing an error for a logout that succeeded.

**Nobody can silence somebody else's phone.**
```ts
const attempt = await unregisterDeviceToken({ userId: "mallory", fcmToken: PHONE_TOKEN });
expect(attempt.removed).toBe(0);
expect(await listUserDeviceTokens("asha")).toHaveLength(1);   // still reachable for SOS
```
`deleteMany({ where: { fcmToken, userId } })` — scoped to the caller. Without the `userId`, anyone who learned another person's token could silence that person's phone, **including for SOS alerts**.

**The device cap.** A client bug that re-registers with a fresh token on every screen mount would otherwise turn every SOS push into a broadcast to hundreds of dead addresses. 15 registrations leave 10 rows, and the survivors are the most recently active.

---

## 13. Day 5, test 3 — mobile payloads are smaller than web

> *Test mobile dashboard payloads are meaningfully smaller than web equivalents*

The `/mobile` namespace only earns its existence if it is measurably lighter than the endpoints it sits beside. This suite measures it.

### 13.1 What "the web equivalent" is

`getAgencyBookings` in `apps/api/src/services/booking.service.ts` (around line 319):

```ts
prisma.booking.findMany({
  where, orderBy, skip, take,
  include: {
    package: { select: { title: true, slug: true } },
    departureDate: { select: { startDate: true } },
    addOns: { include: { addOn: true } },
  },
});
```

The critical word is **`include`**. In Prisma:

- **`select`** = "give me *only* these columns".
- **`include`** = "give me *every* column of this model, **and also** these relations".

So this query returns all 23 `Booking` columns — including `offlinePackageHash` (a 64-character SHA), `rejectionReason`, `proposedDate`, `createdAt`, `updatedAt`, four foreign keys — plus fully-expanded add-ons.

That is fine for a web dashboard on office Wi-Fi. It is not fine for a phone on 2G.

**Prisma `select` vs `include` is the single biggest lever on payload size in this codebase**, and it is a one-word difference.

### 13.2 A fixture, not a live call — and why that is honest

The web shape is pinned as a fixture in the test file rather than fetched from a live `getAgencyBookings`. That is a deliberate choice, and it is worth defending because "fixture" can be a euphemism for "made-up number".

The fixture mirrors the `include` above field for field, and every field name and type came from the `Booking` model in `schema.prisma`. Pinning it means the test fails loudly if somebody widens the web endpoint too — which is exactly the moment we would want to re-check the mobile one.

A live call would need the whole Prisma stack mocked to return... the same fixture. Same data, more machinery.

### 13.3 The threshold

```ts
const MAX_MOBILE_FRACTION = 0.45;
```

A threshold, not a target. The real measurements are 18–21%, well under it.

It is set loosely **on purpose**. A test asserting "exactly 20%" fails every time somebody adds a legitimate field, which trains people to bump the number without thinking — and a threshold nobody thinks about is a threshold that catches nothing. A loose bound only fires when the mobile payload has genuinely stopped being a mobile payload.

Failures print both numbers:

```ts
expect(
  mobile / web,
  `mobile ${mobile}B vs web ${web}B = ${Math.round((mobile / web) * 100)}%`
).toBeLessThan(MAX_MOBILE_FRACTION);
```

Vitest's second argument to `expect` is a message shown on failure. So you get *"mobile 271B vs web 1342B = 20%"* instead of *"expected 0.2 to be less than 0.45"*.

### 13.4 What is measured

**One card:** trekker 20%, guide 18%.

**A page of ten** — the request the app actually makes on every launch: **21%** (2,875 B vs 13,475 B). One card is a curiosity; the page is the real saving, and it multiplies.

And the mobile response still does **more**: it carries the three tab-badge counts and a pagination envelope the web response does not have. Smaller *and* more useful.

### 13.5 Where the saving comes from — four assertions

**Flatness.**
```ts
for (const [key, value] of Object.entries(card)) {
  expect(Array.isArray(value), `${key} is an array`).toBe(false);
  expect(value !== null && typeof value === "object", `${key} is a nested object`).toBe(false);
}
```
`{"packageTitle":"Everest Base Camp"}` beats `{"package":{"title":"…","slug":"…","agency":{…}}}` on bytes *and* on how simply it maps to a mobile view-model.

**Short dates.**
```ts
expect(card.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
```
10 characters instead of 24, on multiple fields, on every card. The app only renders the calendar day, so the time-of-day is bytes nobody reads.

**Money as a number.** Prisma serialises `Decimal` as an object, which both bloats the payload and forces the app to parse it.

**Internal columns omitted.**
```ts
for (const leaked of ["offlinePackageHash", "offlinePackageVersion", "rejectionReason",
                      "departureDateId", "branchId", "assignedGuideId",
                      "trekkerEmail", "createdAt", "updatedAt"]) {
  expect(card).not.toHaveProperty(leaked);
}
```
Not only smaller — **narrower**. None of these belong on a phone screen, and two of them are internal state.

### 13.6 The test that asserts the rule does NOT apply

```ts
it("does NOT apply the slimming rule to the offline package — and that is correct", async () => {
  const bundle = await buildOfflinePackage("booking-1", TREKKER_ACTOR, NOW);
  expect(wireBytes(bundle)).toBeGreaterThan(wireBytes(mapTrekkerTrek(MOBILE_TREKKER_ROW, NOW)));
});
```

This is my favourite test in the file.

The rule is **"send exactly what the screen needs"**, not "send less". The offline bundle is deliberately far larger than a dashboard card, because it is the *only* thing the phone will have.

A future engineer, reading "mobile payloads must be small", might reasonably "optimise" the offline package down to card size — and break the entire feature. So the asymmetry is **asserted**, not left as a comment. A comment can be ignored; a red test cannot.

> **Lesson.** When two parts of a system apply the same principle to opposite conclusions, that is exactly where a future change will go wrong. Encode the asymmetry in a test, with the reason in the test name.

---

## 14. Results: every number we measured

### Test counts

| File | Tests | Status |
|---|---|---|
| `utils/pagination.test.ts` | 11 | pass |
| `services/mobile.service.test.ts` | 31 | pass |
| `services/offlinePackage.service.test.ts` | 53 | pass |
| `services/deviceToken.service.test.ts` | 36 | pass |
| **`services/emergencyNumbers.service.test.ts`** | **34** | **pass (new today)** |
| `routes/mobile.routes.test.ts` | 47 | pass (35 before + **12 new**) |
| **`mobile.contract.test.ts`** | **34** | **pass (new today)** |
| **Total** | **246** | **all pass** |

80 tests added today. Whole mobile suite runs in **965 ms**.

### Payload measurements

| Payload | Bytes | vs web |
|---|---|---|
| Web booking row (`include:`) | 1,342 B | — |
| Mobile trekker card | 271 B | **20%** |
| Mobile guide card | 241 B | **18%** |
| Web page of 10 bookings | 13,475 B | — |
| Mobile trekker dashboard, page of 10 | 2,875 B | **21%** |
| Emergency directory, full table (57 countries) | 11,568 B | — |
| Emergency directory version probe | 134 B | **1.2%** of the table |

### Repository health

| Check | Before today | After today |
|---|---|---|
| `tsc -p apps/api` errors | 174 | **174** (zero added) |
| `vitest run apps/api` | 8 failed / 217 passed files | 8 failed / **219** passed files |
| `eslint` on new files | — | **clean** |

The 8 failing files are pre-existing and unrelated — three are in `apps/api/src/test/bugReporting/` from the recently merged PR #148, and the rest fail to load for reasons documented in earlier weeks. This was verified by `git stash`ing today's work, re-running, and getting the identical 8. **Today's work adds two passing files and no failures.**

> Note: `tsc` reports 174 pre-existing errors in *other* files (services referencing Prisma models absent from `schema.prisma`). None are in today's files, and the count is identical with and without today's changes. CI runs `pnpm test` + `pnpm lint`, not `tsc`.

---

## 15. What was deliberately NOT done

Listing these so nobody later thinks they were forgotten.

**No database table for emergency numbers.** Argued at length in [section 3](#3-the-big-decision-a-source-file-not-a-database-table). Trade-off accepted: updates need a deploy.

**No admin UI to edit emergency numbers.** Follows from the above. Editing goes through a pull request, which is the point.

**No exhaustive country coverage.** 57 countries chosen by relevance — trekking destinations plus source markets — rather than all ~195. Adding one is a five-line edit plus a version bump.

**No caching layer (Redis) in front of the endpoint.** The data is already in process memory. A Redis round trip would make it *slower*.

**No per-tenant customisation of national numbers.** An agency cannot override Nepal's `102`. If an agency has its own rescue contact, that is an `AgencyEmergencyContact` row travelling in the Day 2 offline package — the correct place for it.

**No new Prisma migration.** Today's work adds no database columns or tables at all. (Day 2 and Day 3 each added one; Day 4 needed none, which is itself evidence the source-file decision was structurally right.)

**The push senders still are not wired to `device_tokens`.** This was already flagged as a Day 3 leftover and remains open — see below.

---

## 16. Known limitations and what the next day should pick up

### 16.1 From today

**Updating an emergency number requires a deploy.** Accepted trade-off ([section 3](#3-the-big-decision-a-source-file-not-a-database-table)). If it ever becomes a real problem, the middle path is a database *override* table layered on top of the source file — the file stays the reviewed source of truth, the table handles urgent corrections, and the endpoint merges them. Do not simply move the data into the database; that discards the review property that is the whole point.

**The checksum test must be updated by hand.** By design — that is the forcing function. But it does mean a first-time contributor will hit a failing test they did not expect. Mitigated by the comment block in the test that tells them exactly what to do.

**`?countries=` filtering is not paginated.** Capped at 10 codes instead. For 57 countries that is fine; if the table ever reaches several hundred, revisit.

**No test asserts the numbers are *correct*.** No test can — correctness is a fact about the world, not about the code. What the tests *do* check is shape: every country has at least one dialable number, numbers are digit-only strings of 2–6 characters (so no `+` or space that would break the OS dialler), dial codes are international form, codes are valid ISO. That catches typos in the *form* of a number. Correctness of the *value* is what the pull-request review is for — which is, again, why the data lives in a reviewed source file.

### 16.2 Still open from Day 3

**The push send paths still read the old single `users.fcm_token` column.** `notification.service.ts` and `lib/firebase.ts` need repointing at `listUserDeviceTokens` / `pruneInvalidTokens`. Until then, the multi-device support built on Day 3 is not actually used by any sender — a guide with a phone and a tablet still gets the alert on only one. **This is the highest-value item left in the mobile week**, because it is the gap between "we store device tokens correctly" and "SOS alerts actually reach every device".

**`pruneStaleTokens` is not scheduled.** It exists and is tested (270 days, matching Firebase's own threshold) but is not registered in `cronJobService.ts`.

### 16.3 Still open from Day 2

**The `/version` probe does not re-fingerprint.** It reads the stored counter, so it can lag one poll behind a fresh edit. The fix is to *also* bump on write, keeping the content hash as the safety net rather than the only mechanism. Day 4's build-time checksum is the same idea applied where it is cheaper.

### 16.4 Natural next steps

Given Backend Guide §10, the obvious continuations are:

1. **Wire the push senders onto `device_tokens`** (see 16.2 — do this first).
2. **The SOS API push endpoint** — layer 2 of the four-layer pipeline. `primaryEmergencyNumber()` was built today specifically so the incident record can store "emergency number called" without duplicating the lookup logic.
3. **The SMS gateway parser** — layer 3. Parses `SOS|user_id|trek_id|lat|lng|alt|timestamp` and creates the same incident record the API push would have.
4. **Offline write-sync** — layer 4. The device's local SQLite queue syncing on reconnect, possibly hours later.

---

## 17. Quick reference: the new API

### `GET /mobile/emergency-numbers`

Full country → emergency number table, for the app to bundle locally.

**Auth:** any authenticated user (`requireAuth`, no role restriction).

**Query parameters**

| Parameter | Type | Meaning |
|---|---|---|
| `countries` | comma list or repeated param | Optional. Narrow to these ISO codes, max 10. `?countries=NP,IN` |
| `knownVersion` | integer | Optional. Return `304` if the client is already current. |

**Headers**

| Header | Value |
|---|---|
| `If-None-Match` (request) | `"ev1"` — alternative to `knownVersion` |
| `Cache-Control` (response) | `public, max-age=86400, stale-while-revalidate=604800` |
| `ETag` (response) | `"ev1"`, or `"ev1+IN,NP"` when filtered |

**Response `200`**

```json
{
  "version": 1,
  "checksum": "4dbefcc14002d60f69ff168e5135eb59bcb2d7e2ec9ead45a0ac89f1d47f8a81",
  "updatedAt": "2026-08-06",
  "countryCount": 57,
  "defaultCountryCode": "NP",
  "filtered": false,
  "countries": [
    {
      "countryCode": "NP",
      "countryName": "Nepal",
      "dialCode": "+977",
      "universal": null,
      "police": ["100"],
      "ambulance": ["102"],
      "fire": ["101"],
      "mountainRescue": ["1144"],
      "notes": "1144 is the Tourist Police. Nepal has no single universal number."
    }
  ]
}
```

**Other responses**

| Status | When |
|---|---|
| `304` | Client's `knownVersion` / `If-None-Match` is already current. No body. |
| `400` | `countries` filter longer than 10 codes. |
| `401` | No token. |
| `500` | Integrity check failed — the table changed without its checksum being updated. |

---

### `GET /mobile/emergency-numbers/version`

The ~134-byte freshness probe. Call on every app launch; fetch the table above only when `version` is higher than the cached one.

**Auth:** any authenticated user.
**`Cache-Control`:** `public, no-cache` (revalidate every time — a cached freshness probe is useless).
**Never returns `304`** — a freshness probe must always answer.

**Response `200`**

```json
{
  "version": 1,
  "checksum": "4dbefcc14002d60f69ff168e5135eb59bcb2d7e2ec9ead45a0ac89f1d47f8a81",
  "updatedAt": "2026-08-06",
  "countryCount": 57
}
```

---

### The full `/mobile` surface after Day 4

| Method | Path | Day | Auth |
|---|---|---|---|
| `GET` | `/mobile/trekker/dashboard` | 1 | `TREKKER` |
| `GET` | `/mobile/guide/dashboard` | 1 | `GUIDE`, `STAFF` |
| `GET` | `/mobile/bookings/:id/offline-package` | 2 | trekker / guide / agency roles |
| `GET` | `/mobile/bookings/:id/offline-package/version` | 2 | trekker / guide / agency roles |
| `POST` | `/mobile/register-device` | 3 | any authenticated |
| `DELETE` | `/mobile/register-device` | 3 | any authenticated |
| **`GET`** | **`/mobile/emergency-numbers`** | **4** | **any authenticated** |
| **`GET`** | **`/mobile/emergency-numbers/version`** | **4** | **any authenticated** |

---

## Appendix: how to add or change a country

1. Edit `apps/api/src/data/emergencyNumbers.ts`. Keep the array **sorted by `countryCode`**.
2. Run `npx vitest run apps/api/src/services/emergencyNumbers.service.test.ts`.
3. The checksum test fails. That is expected.
4. Copy the "Received" hash from the failure.
5. In the data file:
   - paste it into `EMERGENCY_DIRECTORY_CHECKSUM`;
   - increment `EMERGENCY_DIRECTORY_VERSION` by one;
   - set `EMERGENCY_DIRECTORY_UPDATED_AT` to today's date.
6. Re-run. All green.
7. Open a pull request. **Have a second person verify the number against an official source** — that review is the reason this data lives in a source file at all.

On the next deploy, every app checks `/mobile/emergency-numbers/version`, sees the higher number, and refreshes its bundled table.

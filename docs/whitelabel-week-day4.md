# White-label Week — Day 4: Static Site Regeneration Hook

**Branch:** `feature/ds/branding-whitelabel`
**Developer:** Dipesh Singh
**Scope:** Day 4 of the white-label module — make a branding / site-config /
navigation save show up on the agency's *live public website* within seconds,
by regenerating the affected static pages and invalidating every cache in
between.

> **The task, as written:**
> - On any branding/config/navigation change, trigger regeneration of the
>   affected static pages (ISR from Week 3)
> - Verify CDN cache invalidation fires precisely on save — no stale branding
>   ever served
>
> **Deliverable:** *Branding changes reflect on the live site within seconds,
> zero downtime.*

---

## Table of contents

1. [What we were asked to build](#1-what-we-were-asked-to-build)
2. [Background: the vocabulary, explained from zero](#2-background-the-vocabulary-explained-from-zero)
3. [The problem: three caches between a save and a visitor](#3-the-problem-three-caches-between-a-save-and-a-visitor)
4. [The core idea: a three-step pipeline where order is everything](#4-the-core-idea-a-three-step-pipeline-where-order-is-everything)
5. [File 1 — `data/staticPages.ts` (what did this save invalidate?)](#5-file-1--datastaticpagests-what-did-this-save-invalidate)
6. [File 2 — `lib/cdn.ts` (telling the edge to forget)](#6-file-2--libcdnts-telling-the-edge-to-forget)
7. [File 3 — `lib/isr.ts` (telling the renderer to rebuild)](#7-file-3--libisrts-telling-the-renderer-to-rebuild)
8. [File 4 — `services/regeneration.service.ts` (the hook itself)](#8-file-4--servicesregenerationservicets-the-hook-itself)
9. [File 5 — `controllers/regeneration.controller.ts`](#9-file-5--controllersregenerationcontrollerts)
10. [File 6 — `routes/regeneration.routes.ts`](#10-file-6--routesregenerationroutests)
11. [Wiring the hook into Days 1, 2 and 3](#11-wiring-the-hook-into-days-1-2-and-3)
12. [The `Cache-Tag` header — the other half of a tag purge](#12-the-cache-tag-header--the-other-half-of-a-tag-purge)
13. [Graceful shutdown](#13-graceful-shutdown)
14. [Environment variables](#14-environment-variables)
15. [How to verify it by hand](#15-how-to-verify-it-by-hand)
16. [The tests, and what each one is protecting](#16-the-tests-and-what-each-one-is-protecting)
17. [Decisions and trade-offs](#17-decisions-and-trade-offs)
18. [What I deliberately did NOT build](#18-what-i-deliberately-did-not-build)
19. [How this meets the deliverable](#19-how-this-meets-the-deliverable)
20. [Appendix — API reference](#20-appendix--api-reference)

---

## 1. What we were asked to build

Days 1, 2 and 3 built three settings screens:

| Day | Screen | Endpoint |
|---|---|---|
| 1 | Brand identity (logo, colour, font, currency) | `PATCH /agencies/me/branding` |
| 2 | Site configuration (coming-soon mode, top bar, popup, badge) | `PATCH /agencies/me/site-config` |
| 3 | Navigation builder (menu, Book Now button) | `PATCH /agencies/me/navigation` |

All three end the same way: a row is written to PostgreSQL and a `200 OK` goes
back. **And then nothing happens.** The agency's public website — the thing all
of this exists to change — carries on showing exactly what it showed before,
until some cache somewhere happens to expire.

Day 4 is the second half of the sentence "the setting saves **and takes
effect**".

### Files created today

| File | What it is | Lines |
|---|---|---|
| `apps/api/src/data/staticPages.ts` | Pure logic: which caches did this save invalidate? Tags, URLs, hosts, page table. | ~300 |
| `apps/api/src/lib/cdn.ts` | The CDN purge client — one job, tell the edge to forget things. | ~200 |
| `apps/api/src/lib/isr.ts` | The ISR client — one job, tell the renderer to rebuild pages. | ~230 |
| `apps/api/src/services/regeneration.service.ts` | The hook: receipts, the 3-step pipeline, retries, coalescing, history. | ~420 |
| `apps/api/src/controllers/regeneration.controller.ts` | HTTP layer for the history read and the Republish button. | ~130 |
| `apps/api/src/routes/regeneration.routes.ts` | Two routes, two different guard sets. | ~50 |

Plus six test files (**107 new tests**):
`data/staticPages.test.ts`, `lib/cdn.test.ts`, `lib/isr.test.ts`,
`services/regeneration.service.test.ts`, `services/regeneration.hooks.test.ts`,
`routes/regeneration.routes.test.ts`.

### Files modified today

| File | Change |
|---|---|
| `services/branding.service.ts` | `getAgencyBrandContext` now also reads `customDomain`; `updateAgencyBranding` queues a regeneration after the commit and returns the receipt. |
| `services/siteConfig.service.ts` | Same hook, scope `siteConfig`. |
| `services/navigation.service.ts` | Same hook, scope `navigation`, after the transaction commits. |
| `controllers/branding.controller.ts` | Returns the receipt; emits `Cache-Tag` on the public read. |
| `controllers/siteConfig.controller.ts` | Same. |
| `controllers/navigation.controller.ts` | Same. |
| `index.ts` | Mounts the new router; drains in-flight regenerations on SIGTERM/SIGINT. |
| `.env.example` | Seven new (all optional) variables. |
| `routes/branding.routes.test.ts`, `routes/siteConfig.routes.test.ts`, `routes/navigation.routes.test.ts` | New assertions for the `Cache-Tag` header. |

**No database migration.** Day 4 stores nothing new in Postgres. That is worth
noticing rather than glossing over — see [§17](#17-decisions-and-trade-offs).

---

## 2. Background: the vocabulary, explained from zero

Four words are doing all the work in this task. If any of them is fuzzy, none of
the code makes sense.

### A "static site"

There are two ways to serve a web page.

**Dynamic:** the visitor asks for `xyz.funtush.io/packages`, and the server, right
then, queries the database, assembles the HTML, and sends it. Every visitor
costs a database query. If the database is slow, the page is slow. If the
database is down, the page is down.

**Static:** the HTML was built *earlier* and saved as a file. The visitor asks
for the page and gets the file. No database is touched. It is faster by an order
of magnitude, it costs almost nothing to serve, and — the part that matters for a
travel marketplace — it stays up when the backend does not.

Funtush's white-label sites are static. That is the right call for a marketing
site read by thousands of strangers and edited a few times a month.

### ISR — Incremental Static Regeneration

The obvious problem with static: the file was built from data that has since
changed. The old answer was "rebuild the whole site on every deploy", which is
fine for ten pages and hopeless for two hundred agencies × dozens of pages each.

**ISR** is the modern answer: pages are static, but individual pages can be
rebuilt *on demand* when their data changes. Not the whole site — the affected
pages. "Incremental" is that word: rebuild a bit of it, not all of it.

The renderer exposes a webhook — conventionally `POST /api/revalidate` — that
means "the data behind these pages changed, rebuild them." **Day 4 is the code
that calls that webhook at the right moment with the right list.**

### CDN and "the edge"

A **CDN** (Content Delivery Network — Cloudflare, in our stack) is a network of
servers spread around the world that keep copies of your responses. A visitor in
Kathmandu is served from a machine in Singapore instead of one in Virginia. Each
of those machines is called an **edge**.

An edge keeps its copy for as long as the `Cache-Control` header allowed. Day 1
set `public, max-age=60` on the branding read; Days 2 and 3 set `max-age=15`.
That is the CDN's licence to serve an old copy for that long.

**Purging** (or *invalidating*) is telling the CDN to throw a copy away, so the
next request goes back to the origin and picks up the new one.

### Cache tags

There are two ways to purge:

- **By URL** — "forget `https://xyz.funtush.io/packages`." Every CDN supports
  this. Its limitation is fatal on its own here: you must *know* every URL, and
  a site has an unknown number of them (one per published package, one per blog
  post). When the menu changes, every one of those pages is wrong, and nobody
  can list them.
- **By tag** — "forget everything labelled `nav:xyz`." The renderer stamps that
  label on every page that draws the menu, so one instruction covers pages nobody
  had to enumerate.

Cloudflare calls them cache tags; Fastly calls them surrogate keys; Next.js calls
them cache tags too (`revalidateTag`). **Tags are the primary mechanism in this
design; URLs are the fallback for a CDN plan that only speaks URLs.**

---

## 3. The problem: three caches between a save and a visitor

Here is the whole reason this day exists. When an agency saves a new brand
colour, that colour has to travel through **three** independent caches before a
stranger's phone shows it, and every one of them can hold a stale copy.

```
   Agency clicks Save
          │
          ▼
   ┌──────────────┐
   │  PostgreSQL  │  ← correct immediately. This is where Days 1–3 stopped.
   └──────┬───────┘
          │  read by
          ▼
   ┌────────────────────────────────────┐
   │ CACHE 1 — the API's edge cache      │  GET /site/xyz/branding
   │ `Cache-Control: public, max-age=60` │  may hold the OLD JSON for 60s
   └──────┬─────────────────────────────┘
          │  read by
          ▼
   ┌────────────────────────────────────┐
   │ CACHE 2 — the renderer's built HTML │  the static page was built from
   │ (pre-rendered pages on disk)        │  the OLD JSON and stays that way
   └──────┬─────────────────────────────┘  until something rebuilds it
          │  served through
          ▼
   ┌────────────────────────────────────┐
   │ CACHE 3 — the CDN's copy of the HTML│  even a fresh page is invisible
   └──────┬─────────────────────────────┘  while the edge holds the old one
          │
          ▼
      The visitor
```

Miss **any** of the three and the agency reloads its site, sees the old logo, and
files a bug that says *"branding doesn't save"* — even though the database row is
perfect and every test on Days 1–3 passes.

That is the bug Day 4 prevents.

---

## 4. The core idea: a three-step pipeline where order is everything

Clearing all three caches is not enough. **They have to be cleared in a specific
order**, and getting it wrong produces a bug that is *worse than doing nothing*.

```
 STEP 1  Purge the API's cached JSON       (cache 1)
            │
            │   because the renderer is about to read it
            ▼
 STEP 2  Ask the renderer to rebuild        (cache 2)
            │
            │   because the pages must exist before we advertise them
            ▼
 STEP 3  Purge the CDN's copy of the HTML   (cache 3)
```

Two ways to get it wrong, both instructive:

**If step 1 came after step 2** — the renderer rebuilds the page, but it re-reads
the *stale* JSON still sitting in the API's edge cache. It faithfully builds a
page with the old logo, and stamps a fresh timestamp on it. Now the wrong content
looks new, and every subsequent freshness check agrees it is up to date. This is
strictly worse than not purging at all, because at least an un-purged cache
eventually expires.

**If step 3 came before step 2** — the edge drops its page, the next visitor
arrives, the edge fetches from the renderer... which has not rebuilt yet. So it
fetches the *old* page and caches it again for another full lifetime. You purged,
and the effect was to reset the stale copy's clock.

That is why the pipeline is a strict sequence, and why **a failed step stops the
pipeline** rather than continuing. Half of this sequence is worse than none of
it; if a step fails, the whole thing is retried from the top.

---

## 5. File 1 — `data/staticPages.ts` (what did this save invalidate?)

Before anything can be purged, one question has to be answered precisely: *which
cached things did this save invalidate?* That question is **pure** — it needs no
database, no network, and no clock — so it lives in `data/`, exactly like Day 1's
`brandTheme.ts`, Day 2's `siteConfig.ts` and Day 3's `navigation.ts`.

### 5.1 Scopes — the three things that can change

```ts
export type RegenerationScope = "branding" | "siteConfig" | "navigation";

export const REGENERATION_SCOPES: readonly RegenerationScope[] = [
  "branding",
  "siteConfig",
  "navigation",
];
```

A **scope** is "what the agency thinks it changed". One per Day 1/2/3 screen.

Notice the names are the *feature's* names, not the database table's
(`agency_branding`, `agency_site_config`, `agency_navigation`). That is
deliberate: these strings end up in log lines, in API responses and in support
tickets, and "branding" is what a human says.

```ts
export function isRegenerationScope(value: string): value is RegenerationScope {
  return (REGENERATION_SCOPES as readonly string[]).includes(value);
}
```

`value is RegenerationScope` is TypeScript's **type predicate** syntax. It means:
"if this function returns `true`, the compiler may treat `value` as a
`RegenerationScope` from here on." It turns a runtime check into compile-time
knowledge.

### 5.2 Tags — and the multi-tenancy rule

```ts
export const SCOPE_TAG_PREFIX: Record<RegenerationScope, string> = {
  branding: "branding",
  siteConfig: "config",
  navigation: "nav",
};

export function scopeTag(scope: RegenerationScope, slug: string): string {
  return `${SCOPE_TAG_PREFIX[scope]}:${slug}`;
}
```

So a tag looks like `branding:himalayan-trails`.

**The slug is in every single tag, and that is the multi-tenancy rule of this
file** (Backend Guide §4). A bare tag of `branding` would be shared by every
agency on the platform, so one agency picking a new colour would purge two
hundred other agencies' caches — a cross-tenant side effect *and* a self-inflicted
stampede on our own origin. There is a test asserting two agencies' tag sets are
disjoint.

Why short prefixes (`nav`, not `agency-navigation-menu`)? Because tags travel in
an HTTP response header on **every public request**. Nine bytes per response is
free; twenty-two is not, at a few million responses.

```ts
export function tagsForScopes(slug: string, scopes: readonly RegenerationScope[]): string[] {
  const tags = new Set(scopes.map((scope) => scopeTag(scope, slug)));
  return [...tags].sort();
}
```

`new Set(...)` removes duplicates; `[...set]` turns it back into an array;
`.sort()` fixes the order. The sort is not cosmetic: this list ends up in a
response header, in a purge request body and in test assertions, and "sometimes
in a different order" makes all three flaky.

### 5.3 The page table

```ts
export interface SitePage {
  path: string;
  label: string;
  dependsOn: readonly RegenerationScope[];
}

const LAYOUT: readonly RegenerationScope[] = REGENERATION_SCOPES;

export const SITE_PAGES: readonly SitePage[] = [
  { path: "/",             label: "Home",         dependsOn: LAYOUT },
  { path: "/packages",     label: "Packages",     dependsOn: LAYOUT },
  { path: "/destinations", label: "Destinations", dependsOn: LAYOUT },
  { path: "/about",        label: "About",        dependsOn: LAYOUT },
  { path: "/contact",      label: "Contact",      dependsOn: LAYOUT },
  { path: "/blog",         label: "Blog",         dependsOn: LAYOUT },
];
```

Read `dependsOn` as: *"if any of these scopes changes, this page's HTML is
wrong."*

Today every page depends on all three, and that is not laziness — branding is the
theme, navigation is the header, and site config owns the announcement bar and
the coming-soon gate. All three live in the **layout** that wraps every page.

Two reasons the table still earns its place instead of being a constant "all
pages":

1. Tomorrow's scopes are *not* site-wide. When "a package was published" becomes
   a scope, it touches `/` and `/packages` and nothing else, and this is where
   that fact will be written down.
2. It is a list a human maintains. A page added to the renderer with no line here
   will never be purged by URL, and the failure is silent — one page on the site
   keeps last month's logo forever.

Note what is deliberately **absent**: `/packages/:slug`, `/blog/:slug`. Detail
pages are unbounded and unknowable from the backend. They are precisely why the
tag list, not this table, is the primary mechanism.

### 5.4 Hosts — and why a custom domain is a second cache

```ts
export function siteBaseDomain(): string {
  return process.env.SITE_BASE_DOMAIN || "funtush.io";
}
```

A **function**, not a `const`. A `const` is evaluated once, at import time. If a
test or a staging boot sets the variable after that import, the constant is
already frozen at the old value — which is the classic reason "it works locally
but the staging deploy purged production URLs". There is a test that sets the
variable mid-suite and asserts the next call follows it.

```ts
export function normalizeCustomDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let host = raw.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "");
  host = stripTrailingSlash(host);

  if (!host) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (!host.includes(".")) return null;

  return host;
}
```

`Agency.customDomain` is free text an agency typed months ago. Real values seen
in the wild: `https://www.x.com`, `www.x.com/`, `  WWW.X.COM `. All three mean
the same site; only one of them concatenates into a valid URL.

The character check is a **whitelist**, not a blacklist — same instinct as Day
3's `isSafeInternalPath`. Letters, digits, dots and hyphens are what a hostname
is made of. Anything else (a space, a slash, an `@`, a `?`) means the value is
not a hostname, and we return `null` rather than guessing. Returning `null` costs
one un-purged edge cache. Guessing costs a purge request aimed at a URL we
assembled out of somebody else's input.

The `includes(".")` check rejects `localhost` and single-word typos.

```ts
export function siteOrigins(agency: SiteHostContext): string[] {
  const origins = [`https://${agency.slug}.${siteBaseDomain()}`];

  const custom = normalizeCustomDomain(agency.customDomain);
  if (custom) origins.push(`https://${custom}`);

  return origins;
}
```

**A site with a mapped custom domain has two live caches, not one.** The
`*.funtush.io` subdomain keeps working after a custom domain is mapped — it is
what the dashboard links to and what DNS falls back to. Purging only the pretty
URL leaves the subdomain copy stale, and the subdomain is the URL the agency's
own staff have bookmarked. So they are the ones who see the old logo, and they
are the ones who file the ticket. Both origins, always.

### 5.5 Putting it together

```ts
export interface RegenerationTargets {
  tags: string[];      // the precise instruction
  apiUrls: string[];   // purge FIRST  (step 1)
  pageUrls: string[];  // purge LAST   (step 3)
  paths: string[];     // for a renderer that revalidates by path
}
```

**The split into `apiUrls` and `pageUrls` is the pipeline order, expressed as
data.** They could have been one list. Keeping them apart means getting the order
wrong requires typing the wrong field name, rather than mis-remembering a comment.

```ts
export function buildRegenerationTargets(
  agency: SiteHostContext,
  scopes: readonly RegenerationScope[],
): RegenerationTargets {
  if (scopes.length === 0) {
    return { tags: [], apiUrls: [], pageUrls: [], paths: [] };
  }

  const uniqueScopes = [...new Set(scopes)];
  const paths = affectedPagePaths(uniqueScopes);
  const apiOrigin = apiPublicOrigin();

  const apiUrls = uniqueScopes
    .map((scope) => `${apiOrigin}${apiPathForScope(scope, agency.slug)}`)
    .sort();

  const pageUrls = siteOrigins(agency)
    .flatMap((origin) => paths.map((path) => `${origin}${path}`))
    .sort();

  return { tags: tagsForScopes(agency.slug, uniqueScopes), apiUrls, pageUrls, paths };
}
```

`flatMap` is `map` followed by flattening one level: for each origin, build every
path, then merge the arrays into one flat list. With two origins and six pages
that is twelve URLs.

The early return matters: **an empty scope list yields empty everything, never
"everything"**. "Nothing changed" must not accidentally mean "purge the world".
That is one line of code and one test, and it is the kind of default that only
gets noticed when it is missing.

---

## 6. File 2 — `lib/cdn.ts` (telling the edge to forget)

One job: tell the CDN to forget things. Nothing in this file knows *why*
something is being purged, and nothing in it knows what "branding" is.

It is shaped like `lib/meilisearch.ts` from Week 3 Day 1, because that shape has
already proved itself against this exact class of dependency — an external HTTP
service that is optional in dev, mandatory in production, and must never take the
API down with it. Three rules:

1. **Check the configuration first, always.** With no CDN configured, every call
   returns `"skipped"` — quietly, with no network access. A developer on a laptop
   has no Cloudflare zone and should not need one to save a colour.
2. **It never throws.** Every failure comes back as a *value*.
3. **The token is never logged.**

### 6.1 Configuration

```ts
export function isCdnPurgeEnabled(): boolean {
  return Boolean(process.env.CDN_PURGE_URL && process.env.CDN_PURGE_TOKEN);
}
```

Both halves required. A URL with no token produces a `403` on every purge — a
failure that *looks* like an outage in the logs but is really a missing
environment variable, and it would be recorded on every single save on the
platform.

```ts
export function cdnPurgeTimeoutMs(): number {
  const raw = Number(process.env.CDN_PURGE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
}
```

The `Number.isFinite(raw) && raw > 0` guard is doing real work.
`Number("soon")` is `NaN`, and `AbortSignal.timeout(NaN)` fires **immediately** —
so a typo in one environment variable would silently break every purge on the
platform. There is a test for `"soon"`, `""`, `"0"` and `"-1"`.

### 6.2 Three statuses, not two

```ts
export type CdnPurgeStatus = "purged" | "skipped" | "failed";
```

- `"purged"` — the edge acknowledged it.
- `"skipped"` — **no CDN is configured.** Not a failure; nothing was expected to
  happen and nothing did.
- `"failed"` — a CDN *is* configured and it did not do what we asked. This is the
  only one worth retrying or alerting on.

Collapsing `skipped` into `failed` would make every local development save look
broken. Collapsing it into `purged` would make a production outage look like a
success. Hence three.

### 6.3 Chunking

```ts
export const MAX_URLS_PER_PURGE = 30;
export const MAX_TAGS_PER_PURGE = 30;
```

Cloudflare rejects a purge listing more than 30 URLs. Chunking *here* rather than
at the call site means no caller has to know the limit — and, the part that
actually bites, a site that grows past 30 pages does not start silently failing
to purge its newest ones.

```ts
export function buildPurgeBatches(urls, tags) {
  const urlChunks = chunk(urls, MAX_URLS_PER_PURGE);
  const tagChunks = chunk(tags, MAX_TAGS_PER_PURGE);
  const batchCount = Math.max(urlChunks.length, tagChunks.length);

  const batches = [];
  for (let i = 0; i < batchCount; i += 1) {
    batches.push({ files: urlChunks[i] ?? [], tags: tagChunks[i] ?? [] });
  }
  return batches;
}
```

This is a **zip**, not a cross product. The two lists are independent
instructions, not a matrix. Pairing chunk *i* of each sends every item exactly
once; a cross product would send every URL once per tag chunk — the same purge
many times, which is how a rate limit gets hit.

### 6.4 The call

```ts
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(batch),
  signal: AbortSignal.timeout(cdnPurgeTimeoutMs()),
});
```

`AbortSignal.timeout(ms)` is the built-in version of the old
`AbortController` + `setTimeout` + `clearTimeout` dance, and it cannot leak the
timer that the manual version leaks when the request wins the race.

**Why a timeout matters more than it looks:** without one, a CDN control plane
having a bad day does not *fail* — it **hangs**. And because the pipeline awaits
this before recording a result, a hang would turn a five-second incident at
Cloudflare into an unbounded pile of half-finished regenerations on our side.

```ts
if (!response.ok) {
  return { ...base, status: "failed", requests, durationMs: Date.now() - started,
           error: `CDN purge responded ${response.status}` };
}
```

The **status line only**. The body is deliberately not read: it might echo our
request back, and `error` ends up in an API response and possibly a support
ticket. The status code is enough to act on and cannot contain our token.

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : "Unknown CDN error";
  console.warn(`[cdn] purge failed${request.reason ? ` (${request.reason})` : ""}: ${message}`);
  return { ...base, status: "failed", requests, durationMs: Date.now() - started, error: message };
}
```

`AbortSignal.timeout` rejects with a `TimeoutError`; DNS and TLS problems arrive
here too. All of them mean one thing to the caller: *the edge was not told, try
again.*

---

## 7. File 3 — `lib/isr.ts` (telling the renderer to rebuild)

Same three rules as the CDN client, plus one concern the CDN client does not
have: **the request is signed**.

### 7.1 Why it is signed

The renderer's revalidate endpoint has to be reachable from the internet — it is
a webhook. And rebuilding a page is *expensive*: it re-fetches every API read
that page makes. An unauthenticated endpoint that triggers expensive work on
request is a denial-of-service button with a public URL.

So the body carries an HMAC-SHA256 signature, exactly like the payment webhooks
in Backend Guide §9.

> **What is an HMAC?** A keyed fingerprint. You feed it the message and a secret
> key, and it produces a hex string. Anyone holding the same secret can recompute
> it and confirm the message came from someone who also holds the secret, and
> that not one byte changed on the way. Without the secret you cannot forge it.

### 7.2 Signing the timestamp too

```ts
export function signRevalidatePayload(body: string, timestamp: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${digest}`;
}
```

Signing the body **alone** would let anyone who once captured a valid request
replay it forever. Binding the timestamp lets the renderer reject anything older
than a minute or two.

The dot is not decoration. Without a separator, a body ending in digits and a
timestamp beginning with digits can be re-split more than one way, so `("12",
"34")` and `("1", "234")` would hash identically — two different requests, one
signature. Every webhook spec (Stripe's included) avoids this the same way, and
there is a test asserting the two do not collide.

### 7.3 Sign the exact bytes you send

```ts
const body = JSON.stringify(payload);
const timestamp = Date.now().toString();

const response = await fetch(`${rendererUrl}${REVALIDATE_PATH}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-funtush-timestamp": timestamp,
    "x-funtush-signature": signRevalidatePayload(body, timestamp, secret),
  },
  body,
  signal: AbortSignal.timeout(revalidateTimeoutMs()),
});
```

The payload is serialised **once**, into `body`, and that exact string is both
signed and sent. Signing one serialisation and sending a freshly re-serialised
one is the single most common way a webhook signature ends up failing
verification for reasons nobody can reproduce — `JSON.stringify` is not
guaranteed to produce identical output for objects assembled differently.

The test recomputes the HMAC independently over `init.body` as it was actually
sent, rather than checking "a signature header exists".

### 7.4 The version field

```ts
version: number;
```

This is the `updatedAt` of the row that changed, in milliseconds.

It makes out-of-order delivery harmless. Two saves a second apart produce two
webhooks, and nothing guarantees they arrive in that order over a network. A
renderer that remembers the highest version it has published can drop the late
arrival, instead of rebuilding from data it already knows is older — which is the
difference between "eventually correct" and "correct, with a one-in-a-thousand
chance of the old logo coming back".

### 7.5 Tags **and** paths, always

```ts
tags: [...request.tags],
paths: [...request.paths],
```

Deliberate belt-and-braces, and cheap. A tag-aware renderer ignores `paths` and
rebuilds every page carrying the tag — including package detail pages nobody
could enumerate. A path-only renderer ignores `tags` and rebuilds the six pages
we *can* name, which is most of a site. Sending only what today's renderer
happens to support is how the fallback quietly stops existing.

### 7.6 A terse 200 is still a success

```ts
async function readRevalidatedList(response: Response): Promise<string[] | undefined> {
  try {
    const parsed = (await response.json()) as { revalidated?: unknown };
    if (!Array.isArray(parsed?.revalidated)) return undefined;
    return parsed.revalidated.filter((item): item is string => typeof item === "string");
  } catch {
    return undefined;
  }
}
```

The renderer *may* answer `{ "revalidated": ["/", "/packages"] }`. That is
nice-to-have telemetry attached to an operation that has **already succeeded** —
the renderer returned 200, the pages are rebuilding. Turning an unreadable body
into a failed regeneration would mean a retry, and therefore a second rebuild, as
a punishment for the renderer being brief.

---

## 8. File 4 — `services/regeneration.service.ts` (the hook itself)

This is the day's centre. Everything above is a tool; this is the thing that
decides what happens and when.

### 8.1 Two things it deliberately does not do

**It never touches the database.** It takes a slug, a custom domain and a version
from its caller. Two consequences: the Day 1–3 services import *it*, so a
database read here would be an import cycle; and its tests need no Prisma mock at
all.

**It never throws.** A save that committed successfully must report success even
if every CDN on earth is down. The data is correct; the caches will catch up.

### 8.2 The receipt

```ts
export interface RegenerationReceipt {
  id: string;
  agencyId: string;
  slug: string;
  scopes: RegenerationScope[];
  version: number;
  customDomain: string | null;
  status: RegenerationStatus;
  attempts: number;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  targets: RegenerationTargets;
  steps: {
    apiPurge?: CdnPurgeOutcome;
    renderer?: RevalidateOutcome;
    sitePurge?: CdnPurgeOutcome;
  };
  error?: string;
  supersededBy?: string;
}
```

A receipt is the record of one publish. It is what makes the second half of the
task — *"verify CDN cache invalidation fires precisely on save"* — actually
verifiable. A purge that happens inside a background promise, logs to stdout and
leaves no trace is a purge nobody can confirm happened.

Six statuses:

| Status | Meaning |
|---|---|
| `queued` | Created, waiting for the site's current pipeline to finish. |
| `running` | The pipeline is executing. |
| `succeeded` | Everything that was configured did its job. |
| `skipped` | Nothing is configured (dev/staging), so nothing happened. |
| `failed` | Something configured did not work, after all retries. |
| `superseded` | Folded into a newer receipt — see coalescing below. |

`skipped` and `failed` are kept apart for `lib/cdn.ts`'s reason: a laptop with no
CDN is not an incident, and a dashboard that cannot tell the two apart is a
dashboard that gets ignored.

### 8.3 Where state lives, and the honest limitation

```ts
const history = new Map<string, RegenerationReceipt[]>();
const inFlight = new Map<string, Promise<void>>();
const pending  = new Map<string, RegenerationReceipt>();
```

Three plain JavaScript `Map`s in module memory. Not Redis, not Postgres, not
Mongo — and that deserves a justification, because Backend Guide §3 is strict
about which store gets which data.

All three are **operational telemetry about work happening in this process**, not
business data. A receipt describes an HTTP call this Node process is making right
now; when the process dies, the call dies with it, and a stored record saying
`"running"` that outlives the thing that was running is worse than no record.
Postgres is for relational/transactional data and Mongo is for permanent records;
this is neither.

**The honest limitation, written down rather than discovered later:** with PM2
cluster mode (Backend Guide §2) there are several worker processes. So the
history endpoint shows whichever worker answered the request, and coalescing
dedupes within a worker rather than across the fleet. Both are acceptable — an
extra purge is harmless, and receipts are a debugging aid, not an audit trail. If
this ever needs to be fleet-wide, `inFlight` becomes a Redis lock and `history` a
capped Redis list; the shape of the file does not change.

Memory is bounded in two dimensions:

```ts
export const REGENERATION_HISTORY_LIMIT = 20;            // receipts per agency
export const REGENERATION_TRACKED_AGENCIES_LIMIT = 500;  // agencies in memory
```

```ts
while (history.size > REGENERATION_TRACKED_AGENCIES_LIMIT) {
  const oldest = history.keys().next().value;
  if (oldest === undefined) break;
  history.delete(oldest);
}
```

A JavaScript `Map` iterates in **insertion order**, so `keys().next().value` is
the least-recently-*added* agency. An API server running for a month across ten
thousand agencies must not accumulate ten thousand arrays.

### 8.4 One attempt at the pipeline

```ts
async function attemptPipeline(receipt: RegenerationReceipt): Promise<boolean> {
  const { targets } = receipt;
  const reason = `${receipt.scopes.join("+")} save (${receipt.slug})`;

  // ── Step 1: the JSON the renderer is about to read.
  receipt.steps.apiPurge = await purgeCdn({ urls: targets.apiUrls, reason });
  if (receipt.steps.apiPurge.status === "failed") {
    receipt.error = receipt.steps.apiPurge.error;
    return false;
  }

  // ── Step 2: rebuild the pages.
  receipt.steps.renderer = await revalidateSite({
    slug: receipt.slug,
    scopes: receipt.scopes,
    tags: targets.tags,
    paths: targets.paths,
    version: receipt.version,
  });
  if (receipt.steps.renderer.status === "failed") {
    receipt.error = receipt.steps.renderer.error;
    return false;
  }

  // ── Step 3: the HTML, now that the fresh version exists.
  receipt.steps.sitePurge = await purgeCdn({
    urls: targets.pageUrls,
    tags: targets.tags,
    reason,
  });
  if (receipt.steps.sitePurge.status === "failed") {
    receipt.error = receipt.steps.sitePurge.error;
    return false;
  }

  receipt.error = undefined;
  return true;
}
```

Three details worth stopping on.

**Step 1 purges by URL only, never by tag.** Look closely: `purgeCdn({ urls:
targets.apiUrls, reason })` — no `tags`. The tags are also stamped on the *page*
responses, so a tag purge here would drop the site's HTML **before** the rebuild
— reintroducing the exact ordering bug of §4 through the back door. We know the
three API URLs exactly, so a URL purge is both sufficient and precise. There is a
test asserting `first.tags` is `undefined`.

**Each step writes its outcome onto the receipt before the next is attempted.**
So a receipt for a pipeline that stopped at step 2 still shows step 1's result.
"The API purge succeeded and the renderer 502ed" is a different incident from
"the CDN token is wrong", and the difference is visible in one JSON response.

**`receipt.error = undefined` on success.** Without it, a pipeline that failed on
attempt 1 and succeeded on attempt 2 would carry a leftover error string on a
receipt whose status says `succeeded`.

### 8.5 Retries

```ts
export const MAX_REGENERATION_ATTEMPTS = 3;
export const REGENERATION_RETRY_DELAYS_MS: readonly number[] = [500, 2000];
```

Three attempts. The failures worth retrying are transient — a dropped connection,
a 502 from a control plane mid-deploy — and those clear in seconds. A genuinely
broken configuration (wrong token, wrong zone) fails identically on attempt
thirty, so more attempts would turn one wrong variable into a hundred requests a
minute against a service that is already rejecting us.

The delays list is one shorter than the attempt count, because delays go
*between* attempts.

**Why back off at all?** Every agency on the platform shares one CDN control
plane. If a hundred saves fail at the same moment — which is what a CDN incident
looks like — retrying immediately and in lockstep is a self-inflicted stampede on
a service that is already unwell.

```ts
receipt.status = "running";
receipt.startedAt = new Date().toISOString();

try {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    receipt.attempts = attempt;

    if (await attemptPipeline(receipt)) {
      const worked =
        didWork(receipt.steps.apiPurge) ||
        didWork(receipt.steps.renderer) ||
        didWork(receipt.steps.sitePurge);

      receipt.status = worked ? "succeeded" : "skipped";
      receipt.completedAt = new Date().toISOString();
      return receipt;
    }

    if (attempt < maxAttempts) await sleep(delays[attempt - 1] ?? 0);
  }

  receipt.status = "failed";
  ...
} catch (err) { ... }
```

The `worked` check is what stops an **unwired staging environment from looking
healthy**. If every step reported `"skipped"`, nothing is configured, and calling
that `"succeeded"` would be a lie that hides a missing environment variable.

The outer `try/catch` looks redundant — both clients promise never to throw. It
is there because if one ever *breaks* that promise, the alternative is an
unhandled promise rejection in a background task, which is how a Node process
dies of a cache purge. There is a test that makes the mock reject and asserts the
caller still gets a resolved receipt.

### 8.6 `queueRegeneration` — the hook the write paths call

```ts
export function queueRegeneration(
  input: QueueRegenerationInput,
  options: RegenerationRunOptions = {},
): RegenerationReceipt {
  const receipt = createReceipt(input);

  try {
    record(receipt);

    if (receipt.scopes.length === 0) {
      receipt.status = "skipped";
      receipt.completedAt = receipt.queuedAt;
      return receipt;
    }

    const running = inFlight.get(receipt.slug);
    if (running) {
      const waiting = pending.get(receipt.slug);
      pending.set(receipt.slug, waiting ? coalesce(waiting, receipt) : receipt);
      return receipt;
    }

    const promise = drain(receipt, options).finally(() => {
      inFlight.delete(receipt.slug);
    });

    inFlight.set(receipt.slug, promise);
    return receipt;
  } catch (err) {
    receipt.status = "failed";
    receipt.error = err instanceof Error ? err.message : "Could not queue regeneration";
    console.error(`[regeneration] could not queue "${receipt.slug}"`, err);
    return receipt;
  }
}
```

**Note it is not `async`.** It returns a receipt synchronously — no `await`
anywhere in the caller's path. That is guarantee number one: *the CDN cannot slow
the save down*.

The pipeline **does start immediately** (the first `purgeCdn` call is made before
this function returns, since `drain` runs synchronously up to its first `await`).
That is the "fires precisely on save" requirement, satisfied literally: no timer,
no queue worker polling every N seconds, no delay. The receipt in the PATCH
response typically reads `"running"`.

Guarantee number two: *the CDN cannot fail the save*. The whole body is wrapped,
and the background promise carries `.finally`, so nothing here produces a
rejected promise that nobody awaited.

The receipt object is **the same object the pipeline mutates**. That is why the
history endpoint can show `queued → running → succeeded` live, with no
bookkeeping to keep two copies in step.

### 8.7 Coalescing — why rapid saves collapse into one

An agency setting up its site saves branding, then the menu, then the top bar,
inside a minute. Running three full pipelines back to back for one site would
rebuild it three times and purge the same twelve URLs three times — and the first
two rebuilds are already obsolete when they finish.

```ts
function coalesce(older: RegenerationReceipt, newer: RegenerationReceipt): RegenerationReceipt {
  older.status = "superseded";
  older.supersededBy = newer.id;
  older.completedAt = new Date().toISOString();

  const scopes = [...new Set([...older.scopes, ...newer.scopes])];
  newer.scopes = scopes;
  newer.version = Math.max(older.version, newer.version);
  newer.targets = buildRegenerationTargets(
    { slug: newer.slug, customDomain: newer.customDomain },
    scopes,
  );

  return newer;
}
```

**The newer receipt survives and absorbs the older one's scopes**, not the other
way round. Why that direction? Because the newer receipt carries the newer
`version`, and publishing a lower version number than one already sent is exactly
how a renderer that de-duplicates by version ends up ignoring the change
entirely.

**Nothing is dropped.** The superseded receipt's scopes are all regenerated under
the surviving id, and it is marked `"superseded"` with a pointer, so the history
explains itself instead of showing a save that mysteriously never ran.

This is also why the receipt carries `customDomain`: rebuilding `targets` after a
merge needs the original input back. Re-deriving the host from the URLs already
in `targets` would mean parsing back out of a string we formatted — a small
cleverness with a real failure mode the day a mapped domain happens to look like
a subdomain.

```ts
async function drain(first: RegenerationReceipt, options: RegenerationRunOptions): Promise<void> {
  let current: RegenerationReceipt | undefined = first;

  while (current) {
    await runRegeneration(current, options);

    current = pending.get(current.slug);
    if (current) pending.delete(current.slug);
  }
}
```

A loop rather than recursion, so a site being saved repeatedly for a long time
cannot grow a stack frame per save. And "one pipeline per site at a time" is
enforced by the *shape* of the code rather than by a convention someone has to
remember.

Note the keying: `inFlight` and `pending` are keyed by **slug**, so one agency's
slow CDN response never delays another agency's publish. There is a test for
that.

### 8.8 `flushRegenerations`

```ts
export async function flushRegenerations(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight.values()]);
  }
}
```

Two real callers:

- **Tests**, which must assert on a finished receipt rather than racing it.
- **Graceful shutdown** — see §13.

`Promise.allSettled`, not `Promise.all`: this waits for *completion*, and one
pipeline rejecting must not stop it waiting for the others. The `while` loop
handles regenerations queued while the flush was already waiting.

---

## 9. File 5 — `controllers/regeneration.controller.ts`

Thin, like Days 1–3's. Two endpoints.

### 9.1 `GET /agencies/me/site/regeneration`

```ts
res.status(200).json({
  success: true,
  data: {
    capabilities: getRegenerationCapabilities(),
    history: getRegenerationHistory(agencyId, limit),
  },
});
```

`capabilities` is `{ rendererConfigured, cdnConfigured }` — and it is the part
that saves the support ticket. When an agency reports "my logo didn't update",
the first question is always whether the platform is wired to a renderer and a
CDN *at all*; on staging, or on a fresh production deploy where one variable was
missed, the answer is no. Reading that off an API response takes a second.
Inferring it from an absence of purges takes an afternoon.

The receipts also make the pipeline legible with **no CDN configured**, because
`targets` is computed from the data rather than from any response. A developer on
a laptop can see the exact URLs and tags a real deploy would purge. That is what
makes this feature testable before it is deployable.

```ts
const requested = Number(req.query.limit);
const limit =
  Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), REGENERATION_HISTORY_LIMIT)
    : REGENERATION_HISTORY_LIMIT;
```

Clamped rather than trusted. `?limit=1000000` on an in-memory list is not
dangerous today, but a route that accepts any number teaches clients to send any
number, and one day the list is not in memory.

Note there is no `agencyId` parameter anywhere. It comes from the session
(Backend Guide §4) — there is no code path that could name another tenant.

### 9.2 `POST /agencies/me/site/regeneration` — the Republish button

```ts
const agency = await getAgencyBrandContext(agencyId);

const regeneration = queueRegeneration({
  agencyId,
  slug: agency.slug,
  customDomain: agency.customDomain,
  scopes: REGENERATION_SCOPES,
});
```

**Every scope at once**, because the button exists for the case where the agency
does not know what is stale — it just knows the site looks wrong. Making it
choose "branding or navigation?" would be asking the person with the least
information to make the diagnosis.

**Nothing is written.** It is a POST because it has a side effect (it makes the
platform do work), not because it changes data — which is why it is safe to press
twice: two republishes produce the same site, and coalescing means an impatient
double-click costs one pipeline.

```ts
res.status(202).json({ success: true, message: "Site republish queued", regeneration });
```

**202 Accepted, not 200 OK.** The work is queued, not finished. A 200 would
promise the caller the site is already rebuilt — a promise this endpoint returns
too early to make.

---

## 10. File 6 — `routes/regeneration.routes.ts`

```ts
router
  .route("/agencies/me/site/regeneration")
  .get(authenticateWithRefreshToken, getMyRegenerations)
  .post(authenticateWithRefreshToken, checkAgencyStatus, postMyRegeneration);
```

Note the **asymmetry** — the guards differ per verb, and both directions are
tested:

- **GET** needs only authentication. A LOCKED agency is read-only (Backend Guide
  §6) but must still be able to see this, because the account most likely to be
  asking "why is my site wrong?" is the one that has just been locked.
- **POST** additionally needs `checkAgencyStatus`, because it makes the platform
  do work for a site that, for a LOCKED agency, is not being served at all.

The path is `/site/regeneration`, not `/regeneration`, because this is about the
agency's *published website*, not the agency record — and the next things that
belong beside it (`/site/domain`, `/site/seo`) read correctly in that namespace.

**No `tierGate`**, for Days 1–3's reason plus a stronger one: regeneration is not
a feature, it is the plumbing that makes *every* tier's saves take effect. A
Small-tier agency's colour change is exactly as entitled to reach its visitors as
a Large one's.

---

## 11. Wiring the hook into Days 1, 2 and 3

Each of the three write paths gained the same four lines, immediately after its
commit. Branding:

```ts
// ── Step 6: clean up what we replaced.
if (logoUrl) await discardReplacedFile(existing?.logoUrl);
if (faviconUrl) await discardReplacedFile(existing?.faviconUrl);

// ── Step 7: publish.
const regeneration = queueRegeneration({
  agencyId,
  slug: agency.slug,
  customDomain: agency.customDomain,
  scopes: ["branding"],
  version: saved.updatedAt,
});

return { ...resolveBranding(agency, saved as BrandingRow), regeneration };
```

### 11.1 Why the position in the function is the whole point

The hook is the **last** thing, after the database commit. Two reasons, and the
second is the sharper one:

1. A transaction that rolls back *after* a purge has fired leaves the renderer
   rebuilding pages from a menu that no longer exists — and the edge caching that
   phantom for a full cache lifetime.
2. **A rejected save must never purge a cache.** Every `throw` above this line —
   Day 1's tier 403, the image 400s, Day 2's coherence 400s, Day 3's menu 403 —
   leaves it unreached.

Why does (2) matter so much? A purge forces a rebuild of pages that did not
change. Firing one on invalid input means any client can make the platform
rebuild a site by sending a request it *knows* will be refused — an origin
stampede triggered by a 403, which is the shape of a denial-of-service bug rather
than merely wasted work. `regeneration.hooks.test.ts` asserts it for six
different rejection paths (403 tier, 400 coherence, 400 empty patch, 404 missing
agency, on all three screens).

### 11.2 Why `version: saved.updatedAt`

The saved row's own timestamp, not `Date.now()`. The version published is then
the version the database actually holds, rather than a slightly later moment that
drifts under load.

### 11.3 One extra column on the context loader

```ts
const agency = await db.agency.findUnique({
  where: { id: agencyId },
  select: {
    id: true, name: true, slug: true, status: true,
    customDomain: true,          // ← new on Day 4
    tier: { select: { name: true } },
  },
});
```

A mapped domain is a second live cache in front of the same site, so every
regeneration has to know about it. Added to `getAgencyBrandContext` rather than
fetched separately because all three write paths already call that function —
zero extra queries.

### 11.4 The response shape

```ts
const { regeneration, ...branding } = await updateAgencyBranding(agencyId, input, files);

res.status(200).json({
  success: true,
  message: "Branding updated",
  data: branding,
  cssVariables: brandingCssVariables(branding),
  regeneration,
});
```

The receipt is lifted **out of `data`** by destructuring. `data` is the agency's
saved settings; the receipt is an operational record of a background job. Mixing
them would put a field in the settings payload that every settings form has to
learn to ignore.

---

## 12. The `Cache-Tag` header — the other half of a tag purge

This is the easiest thing in the whole day to forget, and forgetting it produces
a feature that appears to work perfectly while doing nothing.

**A CDN can only purge by a tag the response told it about.** `tagsForScopes`
builds the purge request; the response header is what makes the purge request
*mean* something. Without the header, every tag-based purge returns `200 OK` and
clears nothing.

So each of the three public reads gained one line:

```ts
res.setHeader("Cache-Tag", cacheTagHeaderValue(slug, ["branding"]));
```

producing `Cache-Tag: branding:himalayan-trails`. Three tests were added to the
existing Day 1–3 route suites, including one asserting the tag is scoped to the
requested agency and not shared.

---

## 13. Graceful shutdown

```ts
const shutdown = (signal: string) => {
  console.log(`[shutdown] ${signal} received — draining regenerations`);
  server.close(() => {
    void flushRegenerations().finally(() => process.exit(0));
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

A regeneration pipeline runs *after* the HTTP response has been sent. So a deploy
that kills the worker mid-pipeline can stop it between "the API cache was purged"
and "the pages were rebuilt" — **the one state in this whole design that actually
serves something wrong** (an un-rebuilt page, with its JSON cache emptied so the
next rebuild is at least correct, but nothing scheduled to trigger one).

`server.close` stops accepting new connections while letting in-flight requests
finish, so the two drains are complementary: no new regenerations are queued, and
the queued ones are allowed to land. It costs a second or two per deploy.

---

## 14. Environment variables

All seven are **optional**. With none of them set the API behaves exactly as it
did on Day 3, plus a receipt that says `"skipped"`.

```bash
# Where the public white-label sites live: <slug>.funtush.io
SITE_BASE_DOMAIN="funtush.io"

# Where this API is reachable — the origin whose cached JSON is purged first.
API_PUBLIC_URL="https://api.funtush.com"

# The renderer that builds the static sites.
SITE_RENDERER_URL=
SITE_REVALIDATE_SECRET=
SITE_REVALIDATE_TIMEOUT_MS=10000

# The CDN purge API, e.g.
# https://api.cloudflare.com/client/v4/zones/<zone-id>/purge_cache
CDN_PURGE_URL=
CDN_PURGE_TOKEN=
CDN_PURGE_TIMEOUT_MS=5000
```

The two timeouts differ on purpose: a purge is a cache eviction (5 s is generous),
a revalidate can be a page render that re-fetches several endpoints (10 s).

---

## 15. How to verify it by hand

### With nothing configured (any laptop)

```bash
curl -X PATCH http://localhost:4000/agencies/me/branding \
  -H "x-refresh-token: <token>" -H "content-type: application/json" \
  -d '{"brandName":"Everest Co"}'
```

The response now carries a `regeneration` object. Look at `targets`: it lists the
exact URLs and tags a production deploy would purge, computed from the data — so
the pipeline is inspectable before a CDN exists.

```bash
curl http://localhost:4000/agencies/me/site/regeneration -H "x-refresh-token: <token>"
```

`capabilities` will read `{ rendererConfigured: false, cdnConfigured: false }` and
the receipt's status will be `"skipped"` — an honest report that the save was
correct and nothing was published.

### With a CDN configured

The same save produces `status: "succeeded"` and per-step outcomes:

```json
"steps": {
  "apiPurge":  { "status": "purged", "urls": 1, "requests": 1, "durationMs": 84 },
  "renderer":  { "status": "revalidated", "tags": 1, "paths": 6, "durationMs": 412 },
  "sitePurge": { "status": "purged", "urls": 6, "tags": 1, "requests": 1, "durationMs": 71 }
}
```

That is the "verify invalidation fires precisely on save" requirement, answered by
an API rather than by reading logs.

### Checking the tag label is being emitted

```bash
curl -sI http://localhost:4000/site/himalayan-trails/branding | grep -i cache-tag
# Cache-Tag: branding:himalayan-trails
```

### Republishing without changing anything

```bash
curl -X POST http://localhost:4000/agencies/me/site/regeneration -H "x-refresh-token: <token>"
# 202 Accepted
```

---

## 16. The tests, and what each one is protecting

**107 new tests across six files** (plus 4 added to the Day 1–3 route suites). Full API suite after Day 4:
**72 files / 1258 tests / 0 failures.** Lint clean. `tsc --noEmit`: 125
pre-existing errors elsewhere in the repo, **zero** in any Day 4 file.

| File | Tests | The bugs it exists to catch |
|---|---:|---|
| `data/staticPages.test.ts` | 24 | A tag without a slug (cross-tenant purge). An unstable tag order. A stored custom domain that is not a hostname. A doubled slash from a trailing-slash env var. "No scopes" meaning "everything". A module constant frozen at import. |
| `lib/cdn.test.ts` | 15 | A network call with no CDN configured. A `NaN` timeout from a typo'd env var. A cross product instead of a zip when chunking. Continuing after a failed batch. The token appearing in an error message. |
| `lib/isr.test.ts` | 17 | Signing different bytes from the ones sent. A replayable signature. The `("12","34")` vs `("1","234")` collision. A terse 200 treated as a failure. A doubled slash in the webhook URL. The secret appearing in a body or header. |
| `services/regeneration.service.test.ts` | 29 | **The pipeline order**, asserted with `invocationCallOrder`. Tags in step 1. Continuing after a failed step. A skipped pipeline reported as succeeded. A leftover error on a succeeded receipt. Two sites blocking each other. A coalesced receipt losing a scope, a version, or a custom domain. A background rejection. |
| `services/regeneration.hooks.test.ts` | 10 | The hook not firing on a real save. The hook firing on a **rejected** save (six rejection paths). The receipt not reaching the caller. |
| `routes/regeneration.routes.test.ts` | 12 | Missing auth. `checkAgencyStatus` on the wrong verb. An un-clamped `?limit`. 200 instead of 202. Reading another agency's history. |
| *(added to Day 1–3 route suites)* | 4 | The `Cache-Tag` header missing or shared between agencies. |

Two tests are worth reading in full if you read only two.

**The order test** — this is the day's central claim, asserted mechanically:

```ts
const apiPurgeOrder   = purgeCdnMock.mock.invocationCallOrder[0]!;
const revalidateOrder = revalidateSiteMock.mock.invocationCallOrder[0]!;
const sitePurgeOrder  = purgeCdnMock.mock.invocationCallOrder[1]!;

expect(apiPurgeOrder).toBeLessThan(revalidateOrder);
expect(revalidateOrder).toBeLessThan(sitePurgeOrder);
```

Vitest's `invocationCallOrder` is a global counter across all spies, so it can
compare calls made to *different* mocks. Asserting "was called" would pass on a
completely wrong pipeline.

**The non-blocking test** — the mock purge never resolves, so if
`queueRegeneration` awaited anything the test would hang:

```ts
const gate = deferred<...>();
purgeCdnMock.mockReturnValueOnce(gate.promise).mockResolvedValue(purged());

const receipt = queueBranding();

expect(purgeCdnMock).toHaveBeenCalledTimes(1);   // fired immediately on save
expect(receipt.status).toBe("running");
expect(receipt.completedAt).toBeUndefined();     // …but not awaited
```

---

## 17. Decisions and trade-offs

| Decision | Alternative rejected | Why |
|---|---|---|
| Three-step pipeline, strictly ordered | Purge everything at once | Purging the page HTML before the rebuild re-caches staleness for another full lifetime; rebuilding before the API purge bakes stale JSON into a page with a fresh timestamp. |
| Tags primary, URLs fallback | URLs only | A site has an unbounded number of detail pages; you cannot enumerate what you do not know. |
| Step 1 purges by URL only | Purge tags in step 1 too | The tags are on the page responses too — a tag purge there is the ordering bug through the back door. |
| Hook fires **after** the commit | Inside the transaction | A rollback after a purge leaves the renderer publishing a phantom; and a rejected save must not be able to trigger platform work. |
| Fire-and-forget with a receipt | `await` the pipeline in the request | A save must not take as long as Cloudflare does, and must not fail when Cloudflare does. |
| Coalesce per slug, newest wins | Run every save's pipeline | Three saves in a minute would rebuild the site three times, and the first two results are obsolete on arrival. Newest wins because it carries the newest version. |
| State in process memory | Redis or a `regeneration_log` table | It is telemetry about work *this process* is doing; a stored `"running"` that outlives the process is worse than no record. Limitation documented in §8.3. |
| No database migration | Persist receipts | Nothing here is relational, transactional, or a permanent record (Backend Guide §3). Adding a table would mean writing a row on every save of every agency, forever, for debugging data with a 20-item useful life. |
| `skipped` as a distinct status | Treat "unconfigured" as failure or success | Failure makes every laptop look broken; success makes a mis-deployed production look healthy. |
| Both origins purged | Custom domain only | The `*.funtush.io` URL stays live and is what agency staff have bookmarked. |
| Signed revalidate webhook | Open endpoint | Rebuilding pages on request is an expensive operation behind a public URL. |
| 3 attempts, 500 ms / 2 s backoff | Retry forever / no retry | Transient failures clear in seconds; a wrong token fails identically at attempt thirty, and lockstep retries stampede a CDN that is already unwell. |
| `Cache-Tag` on the public reads | Purge by URL only | Without the label, a tag purge succeeds and clears nothing — the most expensive bug shape, because it looks like it works. |

---

## 18. What I deliberately did NOT build

- **The renderer itself.** There is no front-end in this repo yet (`apps/web` is
  a stub). Day 4 builds the backend half of the contract: a signed webhook with a
  documented payload. When the renderer exists it implements
  `POST /api/revalidate`, verifies the HMAC over `` `${timestamp}.${body}` ``, and
  calls `revalidateTag`/`revalidatePath` for what it receives.
- **A persisted regeneration log.** See the table above. If receipts ever need to
  outlive a process, the change is `history` → a capped Redis list.
- **A cross-process lock.** Coalescing is per worker. An extra purge is harmless;
  a distributed lock for that is not worth its failure modes.
- **Purging on non-white-label writes.** Publishing a package should also
  regenerate `/` and `/packages`. That is a `"package"` scope, and
  `SITE_PAGES.dependsOn` is the table it drops into — deliberately left for the
  day that owns package publishing.
- **A rate limit on Republish.** Coalescing already collapses a double-click into
  one pipeline. A real limit belongs with the platform's existing
  `rateLimit.service.ts` when this endpoint is exposed in the UI.

---

## 19. How this meets the deliverable

> **On any branding/config/navigation change, trigger regeneration of the
> affected static pages (ISR from Week 3)**

All three Day 1–3 write paths call `queueRegeneration` immediately after their
commit, with the scope that changed. "Affected" is computed, not assumed:
`buildRegenerationTargets` derives the tags, the API URLs, the page URLs (across
both origins) and the paths from `SITE_PAGES.dependsOn`. The renderer is asked to
rebuild via a signed `POST /api/revalidate` carrying both tags and paths.
Asserted by `regeneration.hooks.test.ts` and `staticPages.test.ts`.

> **Verify CDN cache invalidation fires precisely on save — no stale branding
> ever served**

*Precisely on save*: `queueRegeneration` is synchronous and the first purge is
issued before it returns — no timer, no polling worker. *Fires on save only*: six
tests assert that a rejected save purges nothing. *Verify*: every publish produces
a receipt with per-step outcomes, readable at
`GET /agencies/me/site/regeneration` along with whether the platform is wired up
at all. *No stale branding*: all three caches are cleared, in the order that makes
each clearing stick, and the public reads emit `Cache-Tag` so a tag purge is not
a no-op.

> **Branding changes reflect on the live site within seconds, zero downtime**

*Within seconds*: the pipeline starts during the save; the three network calls
are bounded at 5 s + 10 s + 5 s and typically complete in well under a second.
*Zero downtime*: nothing is ever taken offline — no page is deleted and no cache
is emptied ahead of a rebuild. Every purge means "the next request re-fetches",
so the old page keeps serving until the new one exists. A visitor mid-save sees
the old site or the new site, never a 404 and never a spinner. And the save
itself is not slowed by, or failed by, anything the CDN does.

---

## 20. Appendix — API reference

### `GET /agencies/me/site/regeneration`

Recent publishes for the calling agency.

**Auth:** `x-refresh-token`. No status guard (a LOCKED agency may read).
**Query:** `?limit=` (1–20, default 20; anything else is clamped).
**Cache-Control:** `private, no-store`.

```json
{
  "success": true,
  "data": {
    "capabilities": { "rendererConfigured": true, "cdnConfigured": true },
    "history": [
      {
        "id": "3f2c…",
        "agencyId": "agency-1",
        "slug": "himalayan-trails",
        "scopes": ["branding"],
        "version": 1786000000000,
        "customDomain": "everest-treks.com",
        "status": "succeeded",
        "attempts": 1,
        "queuedAt": "2026-08-12T09:00:00.000Z",
        "startedAt": "2026-08-12T09:00:00.001Z",
        "completedAt": "2026-08-12T09:00:00.570Z",
        "targets": {
          "tags": ["branding:himalayan-trails"],
          "apiUrls": ["https://api.funtush.com/site/himalayan-trails/branding"],
          "pageUrls": [
            "https://everest-treks.com/", "https://everest-treks.com/about",
            "https://himalayan-trails.funtush.io/", "…"
          ],
          "paths": ["/", "/packages", "/destinations", "/about", "/contact", "/blog"]
        },
        "steps": {
          "apiPurge":  { "status": "purged",      "urls": 1,  "tags": 0, "requests": 1, "durationMs": 84 },
          "renderer":  { "status": "revalidated", "tags": 1,  "paths": 6, "durationMs": 412, "revalidated": ["/"] },
          "sitePurge": { "status": "purged",      "urls": 12, "tags": 1, "requests": 1, "durationMs": 71 }
        }
      }
    ]
  }
}
```

### `POST /agencies/me/site/regeneration`

Republish every scope. Writes nothing.

**Auth:** `x-refresh-token` + `checkAgencyStatus`.
**Body:** none. **Status:** `202 Accepted`.

```json
{ "success": true, "message": "Site republish queued", "regeneration": { "…": "as above" } }
```

### Changed responses on Days 1–3

| Endpoint | Change |
|---|---|
| `PATCH /agencies/me/branding` | New top-level `regeneration` field. |
| `PATCH /agencies/me/site-config` | New top-level `regeneration` field. |
| `PATCH /agencies/me/navigation` | New top-level `regeneration` field. |
| `GET /site/:slug/branding` | New `Cache-Tag: branding:<slug>` header. |
| `GET /site/:slug/config` | New `Cache-Tag: config:<slug>` header. |
| `GET /site/:slug/navigation` | New `Cache-Tag: nav:<slug>` header. |

### The renderer contract (for whoever builds `apps/web`)

`POST {SITE_RENDERER_URL}/api/revalidate`

| Header | Value |
|---|---|
| `content-type` | `application/json` |
| `x-funtush-timestamp` | ms epoch, as a string |
| `x-funtush-signature` | `sha256=` + HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` |

```json
{
  "slug": "himalayan-trails",
  "scopes": ["branding"],
  "tags": ["branding:himalayan-trails"],
  "paths": ["/", "/packages", "/destinations", "/about", "/contact", "/blog"],
  "version": 1786000000000,
  "sentAt": "2026-08-12T09:00:00.000Z"
}
```

The renderer should: verify the signature against the **raw** body with
`crypto.timingSafeEqual`; reject a timestamp older than ~2 minutes; ignore a
`version` lower than the highest already published for that slug; call
`revalidateTag` for each tag (and `revalidatePath` for each path if tags are not
supported); answer `200` with `{ "revalidated": [...] }`.

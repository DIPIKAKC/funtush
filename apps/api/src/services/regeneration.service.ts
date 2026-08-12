/**
 * ── The static site regeneration hook (White-label week · Day 4) ─────────────
 *
 * Days 1–3 ended at `db.…upsert()`. This is what happens in the second after
 * that: the saved row is turned into fresh HTML at the edge, so the agency's
 * live website matches the form it just submitted.
 *
 *   > **Deliverable:** *branding changes reflect on the live site within
 *   > seconds, zero downtime.*
 *
 * ── The pipeline, and why the order is the whole feature ─────────────────────
 *
 * Three steps, and swapping any two of them produces a bug that looks like
 * "sometimes it doesn't save":
 *
 *   **1. Purge the API reads.** Day 1–3's public endpoints answer with
 *   `Cache-Control: public, max-age=15…60`, so an edge in front of
 *   `api.funtush.com` may be holding the *old* branding JSON. This has to go
 *   first, because step 2 is about to read it.
 *
 *   **2. Revalidate the renderer.** The renderer re-fetches those endpoints and
 *   rebuilds the site's static pages. If step 1 had not run, it would faithfully
 *   rebuild the site from the stale JSON and stamp a fresh timestamp on it —
 *   the worst possible outcome, because now the wrong content looks new.
 *
 *   **3. Purge the site HTML.** Only now is the newly built page the one the
 *   edge will fetch. Purge earlier and the edge re-fetches the *not yet rebuilt*
 *   page and re-caches the staleness we were trying to clear, for another full
 *   cache lifetime.
 *
 * A failed step stops the pipeline instead of continuing, for exactly that
 * reason: half of this sequence is worse than none of it. The whole thing is
 * then retried.
 *
 * ── Zero downtime ────────────────────────────────────────────────────────────
 *
 * "Zero downtime" here is not a deployment strategy, it is a consequence of two
 * decisions:
 *
 *   - **Nothing is ever taken offline.** No page is deleted, no cache is emptied
 *     ahead of a rebuild. Every purge is "next request re-fetches", so the old
 *     page keeps serving until the new one exists. A visitor mid-save sees the
 *     old site or the new site, never a 404 and never a spinner.
 *   - **The save never waits for the edge.** `queueRegeneration` returns
 *     immediately and the pipeline runs after the response has been sent. The
 *     agency's PATCH is as fast as it was on Day 3 whether Cloudflare answers in
 *     20 ms or times out at 5 s.
 *
 * ── What this file deliberately does not do ──────────────────────────────────
 *
 * **It never touches the database.** It takes a slug, a custom domain and a
 * version from its caller. That keeps it free of the Day 1–3 services (which
 * import *it*, so a database read here would be an import cycle), and it means
 * its tests need no Prisma mock at all.
 *
 * **It never throws.** A save that committed successfully must report success
 * even if every CDN on earth is down; the data is correct and the caches will
 * catch up. Every failure is recorded on a receipt instead.
 */

import { randomUUID } from "node:crypto";
import {
  buildRegenerationTargets,
  type RegenerationScope,
  type RegenerationTargets,
  type SiteHostContext,
} from "../data/staticPages";
import { isCdnPurgeEnabled, purgeCdn, type CdnPurgeOutcome } from "../lib/cdn";
import { isRendererEnabled, revalidateSite, type RevalidateOutcome } from "../lib/isr";

/* ── 1. Tuning ───────────────────────────────────────────────────────────── */

/**
 * Three attempts total.
 *
 * The failures this retries are the transient kind — a dropped connection, a
 * 502 from a control plane mid-deploy — and those clear in seconds. A genuinely
 * broken configuration (wrong token, wrong zone) fails identically on attempt
 * thirty, so more attempts would only turn one wrong variable into a hundred
 * requests a minute against a CDN that is already rejecting us.
 */
export const MAX_REGENERATION_ATTEMPTS = 3;

/**
 * Waits *between* attempts, so the list is one shorter than the attempt count.
 *
 * Backing off matters here specifically because every agency on the platform
 * shares one CDN control plane. If a hundred saves all fail at the same moment
 * (which is what a CDN incident looks like), retrying immediately and in lockstep
 * is a self-inflicted stampede on a service that is already unwell.
 */
export const REGENERATION_RETRY_DELAYS_MS: readonly number[] = [500, 2000];

/** Receipts kept per agency, newest first. */
export const REGENERATION_HISTORY_LIMIT = 20;

/**
 * How many agencies' histories to keep in memory at once.
 *
 * The history is a debugging aid held in the process, so it needs a ceiling: an
 * API server that runs for a month and serves ten thousand agencies must not
 * accumulate ten thousand arrays. Oldest-first eviction, which for this data is
 * exactly right — nobody debugs a save from last Tuesday from an in-memory log.
 */
export const REGENERATION_TRACKED_AGENCIES_LIMIT = 500;

/* ── 2. Types ────────────────────────────────────────────────────────────── */

/**
 * Where a regeneration is in its life.
 *
 * `"skipped"` and `"failed"` are kept apart for the reason `lib/cdn.ts` gives:
 * a laptop with no CDN configured is not an incident, and a dashboard that
 * cannot tell the two apart is a dashboard that gets ignored.
 *
 * `"superseded"` is the coalescing case — this receipt's work was folded into a
 * newer one that had not started yet. Not a failure: its pages *are* being
 * regenerated, just under a different id, which `supersededBy` names.
 */
export type RegenerationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "skipped"
  | "failed"
  | "superseded";

/** The record of one regeneration — queued, in flight, or finished. */
export interface RegenerationReceipt {
  id: string;
  agencyId: string;
  slug: string;
  /** What the agency changed. More than one after coalescing. */
  scopes: RegenerationScope[];
  /** `updatedAt` of the saved row, in ms — see `RevalidatePayload.version`. */
  version: number;
  /**
   * The agency's mapped domain, or `null`.
   *
   * Kept on the receipt because coalescing has to rebuild `targets` from the
   * original inputs, and re-deriving the host out of the URLs already in
   * `targets` would mean parsing back out of a string we formatted — a small
   * cleverness with a real failure mode the day a mapped domain happens to look
   * like a subdomain. It is public information (it is the site's address), so
   * carrying it in an API response leaks nothing.
   */
  customDomain: string | null;
  status: RegenerationStatus;
  /** How many times the pipeline has been attempted. `0` while queued. */
  attempts: number;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Exactly what this regeneration covers. Readable with no CDN configured. */
  targets: RegenerationTargets;
  steps: {
    apiPurge?: CdnPurgeOutcome;
    renderer?: RevalidateOutcome;
    sitePurge?: CdnPurgeOutcome;
  };
  error?: string;
  /** Set on `"superseded"`: the id of the receipt that absorbed this one. */
  supersededBy?: string;
}

/** What a caller has to know to ask for a regeneration. */
export interface QueueRegenerationInput extends SiteHostContext {
  agencyId: string;
  /** What changed. One scope from a Day 1–3 save; several from a republish. */
  scopes: readonly RegenerationScope[];
  /**
   * The saved row's `updatedAt`. Optional because a caller whose write path
   * does not return the row (a mocked upsert, a multi-table transaction) should
   * not have to invent one — `Date.now()` is a correct-enough version stamp,
   * since it is still monotonic across saves.
   */
  version?: number | Date | null;
}

/** Knobs the tests turn. Production callers pass nothing. */
export interface RegenerationRunOptions {
  retryDelaysMs?: readonly number[];
  maxAttempts?: number;
}

/* ── 3. Process-local state ──────────────────────────────────────────────── */

/**
 * Why these live in module memory rather than Redis or Postgres.
 *
 * All three are **operational telemetry about work happening in this process**,
 * not business data. A receipt describes an HTTP call this Node process is
 * making right now; when the process dies, the call dies with it, and a record
 * saying "running" that outlives the thing that was running is worse than no
 * record. Backend Guide §3's rule — Postgres for relational/transactional,
 * Mongo for permanent records — points away from both: nothing here is either.
 *
 * The honest limitation, worth writing down rather than discovering: with PM2
 * cluster mode (Backend Guide §2) there are several processes, so the history
 * endpoint shows the *worker that answered the request*, and coalescing dedupes
 * within a worker rather than across the fleet. Both are fine — an extra purge
 * is harmless, and receipts are a debugging aid, not an audit trail. If this
 * ever needs to be fleet-wide, `inFlight` becomes a Redis lock and `history` a
 * capped Redis list; the shape of this file does not change.
 */
const history = new Map<string, RegenerationReceipt[]>();

/** slug → the pipeline currently running for that site. */
const inFlight = new Map<string, Promise<void>>();

/** slug → the one receipt waiting for the running pipeline to finish. */
const pending = new Map<string, RegenerationReceipt>();

/** Wipe all of it. Exported for tests, which must not leak state into each other. */
export function resetRegenerationState(): void {
  history.clear();
  inFlight.clear();
  pending.clear();
}

/* ── 4. Receipts ─────────────────────────────────────────────────────────── */

/** Accept a `Date`, a number, or nothing, and always end up with a number. */
function toVersion(value: number | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Date.now();
}

/**
 * Build a receipt — pure, so a test can assert the whole shape without running
 * anything or mocking a clock beyond `Date`.
 */
export function createReceipt(input: QueueRegenerationInput): RegenerationReceipt {
  const scopes = [...new Set(input.scopes)];

  return {
    id: randomUUID(),
    agencyId: input.agencyId,
    slug: input.slug,
    scopes,
    version: toVersion(input.version),
    customDomain: input.customDomain ?? null,
    status: "queued",
    attempts: 0,
    queuedAt: new Date().toISOString(),
    targets: buildRegenerationTargets(input, scopes),
    steps: {},
  };
}

/**
 * Put a receipt at the front of its agency's history.
 *
 * The stored object is **the same object the pipeline mutates**, not a copy.
 * That is deliberate: it means `GET /agencies/me/site/regeneration` shows a
 * regeneration transition `queued → running → succeeded` live, with no
 * bookkeeping to keep two copies in step. The cost is that callers must treat
 * what they read as a snapshot that can change under them — fine for a JSON
 * response, which is serialised the moment it is read.
 */
function record(receipt: RegenerationReceipt): void {
  const existing = history.get(receipt.agencyId) ?? [];
  history.set(receipt.agencyId, [receipt, ...existing].slice(0, REGENERATION_HISTORY_LIMIT));

  // `Map` iterates in insertion order, so the first key is the least recently
  // *added* agency. Re-setting an existing key does not move it, which is close
  // enough for an eviction policy whose only job is to bound memory.
  while (history.size > REGENERATION_TRACKED_AGENCIES_LIMIT) {
    const oldest = history.keys().next().value;
    if (oldest === undefined) break;
    history.delete(oldest);
  }
}

/** Newest-first receipts for one agency. Always an array, never `null`. */
export function getRegenerationHistory(
  agencyId: string,
  limit = REGENERATION_HISTORY_LIMIT,
): RegenerationReceipt[] {
  return (history.get(agencyId) ?? []).slice(0, limit);
}

/** The most recent receipt for one agency, or `null` if it has never saved. */
export function getLastRegeneration(agencyId: string): RegenerationReceipt | null {
  return history.get(agencyId)?.[0] ?? null;
}

/**
 * Is the platform actually wired up to a renderer and a CDN?
 *
 * Surfaced through the API so "why didn't my site update?" has an answer that
 * does not require SSH access to read environment variables.
 */
export function getRegenerationCapabilities() {
  return {
    rendererConfigured: isRendererEnabled(),
    cdnConfigured: isCdnPurgeEnabled(),
  };
}

/* ── 5. One attempt at the pipeline ──────────────────────────────────────── */

/** Did a step do anything at all? Used to decide `succeeded` vs `skipped`. */
function didWork(outcome?: { status: string }): boolean {
  return outcome !== undefined && outcome.status !== "skipped";
}

/**
 * Run the three steps once, recording each on the receipt as it completes.
 *
 * Returns `true` when nothing failed. A `"skipped"` step counts as success — it
 * means that integration is not configured, and an unconfigured integration
 * cannot be the reason a save is reported as broken.
 *
 * Each step writes its outcome onto `receipt.steps` **before** the next one is
 * attempted, so a receipt for a pipeline that stopped at step 2 shows step 1's
 * result. That is what makes a failure diagnosable: "the API purge succeeded and
 * the renderer 500ed" is a different incident from "the CDN token is wrong", and
 * the difference is visible in one JSON response.
 */
async function attemptPipeline(receipt: RegenerationReceipt): Promise<boolean> {
  const { targets } = receipt;
  const reason = `${receipt.scopes.join("+")} save (${receipt.slug})`;

  // ── Step 1: the JSON the renderer is about to read.
  //
  // By URL only, never by tag. The tags are also on the *page* responses, so a
  // tag purge here would drop the site's HTML before the rebuild — precisely the
  // ordering bug this pipeline exists to avoid.
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

/** `await sleep(ms)` — with `0` short-circuited so tests do not queue timers. */
function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the pipeline to a conclusion, retrying transient failures.
 *
 * Exported so tests can drive it directly and synchronously, and so a future
 * "retry this regeneration" admin button has a function to call. Everyday code
 * goes through `queueRegeneration`.
 *
 * Note there is no `throw` anywhere in here, including around the retry loop:
 * `attemptPipeline` returns a boolean because both clients already promise never
 * to throw. If one ever breaks that promise, the outer `try` turns it into a
 * failed receipt rather than an unhandled rejection that takes the process down
 * — the exact accident a background `void` promise is prone to.
 */
export async function runRegeneration(
  receipt: RegenerationReceipt,
  options: RegenerationRunOptions = {},
): Promise<RegenerationReceipt> {
  const maxAttempts = options.maxAttempts ?? MAX_REGENERATION_ATTEMPTS;
  const delays = options.retryDelaysMs ?? REGENERATION_RETRY_DELAYS_MS;

  receipt.status = "running";
  receipt.startedAt = new Date().toISOString();

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      receipt.attempts = attempt;

      if (await attemptPipeline(receipt)) {
        // Every step reported "skipped" ⇒ nothing is configured ⇒ this was a
        // no-op, and calling that "succeeded" would make an unwired staging
        // environment look healthy.
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
    receipt.completedAt = new Date().toISOString();
    console.error(
      `[regeneration] gave up on "${receipt.slug}" after ${receipt.attempts} attempts: ${receipt.error}`,
    );
    return receipt;
  } catch (err) {
    receipt.status = "failed";
    receipt.error = err instanceof Error ? err.message : "Unknown regeneration error";
    receipt.completedAt = new Date().toISOString();
    console.error(`[regeneration] unexpected failure for "${receipt.slug}"`, err);
    return receipt;
  }
}

/* ── 6. Queueing and coalescing ──────────────────────────────────────────── */

/**
 * Fold an older waiting receipt into a newer one.
 *
 * Coalescing exists because of how the settings screens are actually used: an
 * agency setting up its site saves branding, then the menu, then the top bar,
 * inside a minute. Running three full pipelines back to back for one site would
 * rebuild it three times and purge the same six URLs three times, and the first
 * two rebuilds are already obsolete when they finish.
 *
 * The **newer** receipt survives and absorbs the older one's scopes, rather than
 * the other way round, because the newer one carries the newer `version` — and
 * publishing a lower version number than one already sent is how a renderer that
 * de-duplicates by version ends up ignoring the change entirely.
 *
 * Nothing is dropped: the older receipt's scopes are all still regenerated, and
 * it is marked `"superseded"` with a pointer to the receipt that took over, so
 * the history explains itself.
 */
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

/**
 * The hook itself — call this immediately after a successful write.
 *
 * Returns **synchronously**: this is not an `async` function, so the caller gets
 * a receipt without so much as a microtask of delay. The first purge is fired
 * before the return — "precisely on save", not on a timer — but nothing is
 * awaited, so the receipt usually reads `"running"` in the PATCH response and
 * `"succeeded"` on the next poll. It is the *same object* the pipeline mutates,
 * so the caller can drop it straight into its HTTP response.
 *
 * Two guarantees this function owes its callers, both of which are the reason it
 * is shaped like this rather than being `await purgeCdn(...)` inlined into three
 * services:
 *
 *   1. **It cannot slow the save down.** No network call happens before it
 *      returns.
 *   2. **It cannot fail the save.** The whole body is wrapped, and the
 *      background promise has a `catch`, so nothing here can produce a rejected
 *      promise the caller never awaited — the classic way a background task takes
 *      down a Node process.
 */
export function queueRegeneration(
  input: QueueRegenerationInput,
  options: RegenerationRunOptions = {},
): RegenerationReceipt {
  const receipt = createReceipt(input);

  try {
    record(receipt);

    // Nothing to regenerate — an empty scope list means the caller had nothing
    // to say, and a purge of nothing is not worth a pipeline.
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
    // Reaching here means a bug in *this* file. The save still succeeded, so the
    // receipt is marked failed and the caller is never told about it.
    receipt.status = "failed";
    receipt.error = err instanceof Error ? err.message : "Could not queue regeneration";
    console.error(`[regeneration] could not queue "${receipt.slug}"`, err);
    return receipt;
  }
}

/**
 * Run one site's regenerations one after another until nothing is waiting.
 *
 * A loop rather than recursion so that a site being saved repeatedly for a long
 * time cannot grow a stack frame per save, and so "one pipeline per site at a
 * time" is enforced by the shape of the code rather than by a convention.
 */
async function drain(
  first: RegenerationReceipt,
  options: RegenerationRunOptions,
): Promise<void> {
  let current: RegenerationReceipt | undefined = first;

  while (current) {
    await runRegeneration(current, options);

    current = pending.get(current.slug);
    if (current) pending.delete(current.slug);
  }
}

/**
 * Wait for every in-flight regeneration to finish.
 *
 * Two callers, both real:
 *
 *   - **Tests**, which must assert on a finished receipt rather than racing it.
 *   - **Graceful shutdown**, where a deploy that SIGTERMs a worker mid-pipeline
 *     would otherwise leave a site whose API cache was purged and whose pages
 *     were never rebuilt — the one state in this design that actually serves
 *     something wrong.
 *
 * `Promise.allSettled`, not `Promise.all`: this waits for *completion*, and one
 * pipeline rejecting (which it should not, but) must not stop it waiting for the
 * others.
 */
export async function flushRegenerations(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight.values()]);
  }
}

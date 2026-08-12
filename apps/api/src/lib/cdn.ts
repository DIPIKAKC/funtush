/**
 * ── The CDN purge client (White-label week · Day 4) ──────────────────────────
 *
 * One job: tell the edge network to forget things. Nothing in this file knows
 * *why* something is being purged — that is `regeneration.service.ts`'s
 * business — and nothing in it knows what a "branding save" is.
 *
 * It is written in the shape `lib/meilisearch.ts` established on Week 3 Day 1,
 * because that shape has already proved itself against exactly this class of
 * dependency (an external HTTP service that is optional in dev, mandatory in
 * production, and must never take the API down with it):
 *
 *   - **`isCdnPurgeEnabled()` first, always.** With no CDN configured, every
 *     call returns `"skipped"` — quietly, with no network access and no scary
 *     log line. A developer running the API on a laptop has no Cloudflare zone
 *     and should not need one to save a colour.
 *   - **It never throws.** Every failure comes back as a value. The caller
 *     decides what a failed purge means; a `throw` here would decide for it, and
 *     the decision would be "the agency's save failed", which is a lie — the row
 *     is committed and the data is correct.
 *   - **The token is never logged.** Not on success, not in an error, not in a
 *     debug line. It is read straight out of the environment into a header.
 *
 * ── The wire format ──────────────────────────────────────────────────────────
 *
 * The body is Cloudflare's `POST /zones/{zone}/purge_cache` shape, which Fastly
 * and KeyCDN are close enough to that a change of provider is a change of two
 * field names rather than a rewrite:
 *
 * ```json
 * { "files": ["https://…/", "https://…/packages"], "tags": ["branding:xyz"] }
 * ```
 */

/* ── 1. Configuration ────────────────────────────────────────────────────── */

/**
 * Cloudflare rejects a purge listing more than 30 URLs. Chunking here rather
 * than at the call site means no caller has to know the limit, and — the part
 * that actually bites — a site that grows past 30 pages does not start silently
 * failing to purge its newest ones.
 */
export const MAX_URLS_PER_PURGE = 30;

/** Cloudflare's tag limit per request, for the same reason. */
export const MAX_TAGS_PER_PURGE = 30;

/** How long to wait before giving up on the purge API. */
export function cdnPurgeTimeoutMs(): number {
  const raw = Number(process.env.CDN_PURGE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
}

/**
 * Is a CDN purge endpoint configured?
 *
 * Both halves are required. A URL with no token produces a 403 on every purge —
 * a failure that looks like an outage in the logs but is really a missing
 * variable, and it would be recorded on every single save.
 */
export function isCdnPurgeEnabled(): boolean {
  return Boolean(process.env.CDN_PURGE_URL && process.env.CDN_PURGE_TOKEN);
}

/* ── 2. Result types ─────────────────────────────────────────────────────── */

/**
 * Three outcomes, and the distinction between the last two is the important one.
 *
 * - `"purged"` — the edge acknowledged it.
 * - `"skipped"` — no CDN is configured. **Not** a failure; nothing was expected
 *   to happen and nothing did.
 * - `"failed"` — a CDN is configured and it did not do what we asked. This is
 *   the only one worth retrying, alerting on, or showing an agency.
 *
 * Collapsing `skipped` into `failed` would make every local development save
 * look broken; collapsing it into `purged` would make a production outage look
 * like a success. Hence three.
 */
export type CdnPurgeStatus = "purged" | "skipped" | "failed";

export interface CdnPurgeOutcome {
  status: CdnPurgeStatus;
  /** How many URLs were listed (not how many the CDN admits to holding). */
  urls: number;
  /** How many tags were listed. */
  tags: number;
  /** HTTP requests actually sent — more than one when chunking kicked in. */
  requests: number;
  durationMs: number;
  /** Present only on `"failed"`. Safe to show an agency; never contains secrets. */
  error?: string;
}

export interface CdnPurgeRequest {
  urls?: readonly string[];
  tags?: readonly string[];
  /** Free-text, used only in log lines, e.g. `"branding save (himalayan-trails)"`. */
  reason?: string;
}

/* ── 3. Chunking ─────────────────────────────────────────────────────────── */

/** Split a list into fixed-size pieces. Exported because the tests pin it. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) return [items as T[]];

  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size) as T[]);
  }
  return out;
}

/**
 * Pair up URL chunks and tag chunks into as few requests as possible.
 *
 * Sending `{files, tags}` together is one request instead of two, and the CDN
 * treats the two lists independently, so pairing them is free. `zip`-style
 * pairing rather than a cross product: the lists are separate instructions, not
 * a matrix — pairing chunk *i* of each is what sends every item exactly once.
 */
export function buildPurgeBatches(
  urls: readonly string[],
  tags: readonly string[],
): Array<{ files: string[]; tags: string[] }> {
  const urlChunks = chunk(urls, MAX_URLS_PER_PURGE);
  const tagChunks = chunk(tags, MAX_TAGS_PER_PURGE);
  const batchCount = Math.max(urlChunks.length, tagChunks.length);

  const batches: Array<{ files: string[]; tags: string[] }> = [];
  for (let i = 0; i < batchCount; i += 1) {
    batches.push({ files: urlChunks[i] ?? [], tags: tagChunks[i] ?? [] });
  }
  return batches;
}

/* ── 4. The call ─────────────────────────────────────────────────────────── */

/**
 * Ask the CDN to drop these URLs and tags.
 *
 * Never throws — see the file header. Every path out of this function is a
 * `CdnPurgeOutcome`, including the ones that go through `catch`.
 *
 * The timeout matters more than it looks. Without one, a CDN control plane
 * having a bad day does not fail — it *hangs*, and because the caller awaits
 * this before recording a receipt, a hang would turn a five-second incident at
 * the CDN into an unbounded pile of half-finished regenerations on our side.
 * Five seconds, then it is a failure like any other and the retry logic upstairs
 * takes over.
 */
export async function purgeCdn(request: CdnPurgeRequest): Promise<CdnPurgeOutcome> {
  const urls = request.urls ?? [];
  const tags = request.tags ?? [];
  const started = Date.now();

  const base: Omit<CdnPurgeOutcome, "status"> = {
    urls: urls.length,
    tags: tags.length,
    requests: 0,
    durationMs: 0,
  };

  // Nothing to do is a success, not a skip: the caller asked for nothing and got
  // it. Distinguishing this from "no CDN configured" keeps the receipt honest.
  if (urls.length === 0 && tags.length === 0) {
    return { ...base, status: "purged", durationMs: 0 };
  }

  if (!isCdnPurgeEnabled()) {
    return { ...base, status: "skipped", durationMs: 0 };
  }

  const endpoint = process.env.CDN_PURGE_URL as string;
  const token = process.env.CDN_PURGE_TOKEN as string;
  const batches = buildPurgeBatches(urls, tags);

  let requests = 0;

  try {
    for (const batch of batches) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(batch),
        // `AbortSignal.timeout` is the built-in version of the
        // `AbortController` + `setTimeout` + `clearTimeout` dance, and it cannot
        // leak the timer the manual version leaks when the request wins the race.
        signal: AbortSignal.timeout(cdnPurgeTimeoutMs()),
      });

      requests += 1;

      if (!response.ok) {
        // The status line is enough to act on and cannot contain our token. The
        // body might echo the request back, so it is deliberately not read.
        return {
          ...base,
          status: "failed",
          requests,
          durationMs: Date.now() - started,
          error: `CDN purge responded ${response.status}`,
        };
      }
    }

    return { ...base, status: "purged", requests, durationMs: Date.now() - started };
  } catch (err) {
    // `AbortSignal.timeout` rejects with a `TimeoutError`; DNS and TLS problems
    // arrive here too. All of them mean the same thing to the caller: the edge
    // was not told, try again.
    const message = err instanceof Error ? err.message : "Unknown CDN error";
    console.warn(`[cdn] purge failed${request.reason ? ` (${request.reason})` : ""}: ${message}`);

    return {
      ...base,
      status: "failed",
      requests,
      durationMs: Date.now() - started,
      error: message,
    };
  }
}

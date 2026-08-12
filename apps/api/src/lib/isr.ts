/**
 * ── The ISR revalidation client (White-label week · Day 4) ───────────────────
 *
 * "ISR" is **Incremental Static Regeneration**: the site is served as
 * pre-rendered static HTML (fast, cacheable, survives the API being down), and
 * instead of rebuilding all of it on every deploy, individual pages are rebuilt
 * on demand when the data behind them changes. This file is the "on demand"
 * part — the phone call from the backend to the renderer that says *"the data
 * behind these pages changed; rebuild them."*
 *
 * Same three rules as `lib/cdn.ts`, for the same reasons: check the config
 * first, never throw, never log the secret.
 *
 * ── Why this is signed ───────────────────────────────────────────────────────
 *
 * The renderer's revalidate endpoint has to be reachable from the internet (it
 * is a webhook), and rebuilding a page is *expensive* — it re-fetches every API
 * read that page makes. An unauthenticated endpoint that triggers expensive work
 * on request is a denial-of-service button with a public URL.
 *
 * So the body is signed with a shared secret, HMAC-SHA256, exactly like the
 * payment webhooks in Backend Guide §9 — and the signature covers a
 * **timestamp** as well as the body. Signing the body alone would let anyone who
 * once captured a valid request replay it forever; binding the timestamp lets
 * the renderer reject anything older than a minute or two.
 *
 * `crypto.timingSafeEqual` belongs on the *verifying* side (the renderer), not
 * here — this end only produces the signature.
 */

import { createHmac } from "node:crypto";
import type { RegenerationScope } from "../data/staticPages";

/* ── 1. Configuration ────────────────────────────────────────────────────── */

/**
 * The renderer's webhook path.
 *
 * A constant rather than another environment variable: this is a contract
 * between two Funtush services, and a contract that can be different in every
 * environment is a contract nobody can debug.
 */
export const REVALIDATE_PATH = "/api/revalidate";

/**
 * Longer than the CDN's five seconds because the work is genuinely bigger — a
 * purge is a cache eviction, a revalidate can be a page render that re-fetches
 * several API endpoints. Still bounded: a rebuild that takes more than ten
 * seconds is a renderer problem, and waiting longer will not fix it.
 */
export function revalidateTimeoutMs(): number {
  const raw = Number(process.env.SITE_REVALIDATE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10000;
}

/** Is a renderer configured to talk to? Both halves required, as with the CDN. */
export function isRendererEnabled(): boolean {
  return Boolean(process.env.SITE_RENDERER_URL && process.env.SITE_REVALIDATE_SECRET);
}

/* ── 2. Types ────────────────────────────────────────────────────────────── */

export type RevalidateStatus = "revalidated" | "skipped" | "failed";

export interface RevalidateOutcome {
  status: RevalidateStatus;
  /** How many cache tags were sent. */
  tags: number;
  /** How many site-relative paths were sent. */
  paths: number;
  durationMs: number;
  /** What the renderer says it actually rebuilt, when it bothers to tell us. */
  revalidated?: string[];
  /** Present only on `"failed"`. Never contains the secret. */
  error?: string;
}

/** The payload the renderer receives. Kept flat — it is a wire format. */
export interface RevalidatePayload {
  /** Which site. The renderer maps this to a host itself. */
  slug: string;
  /** What changed, so the renderer can log something a human can read. */
  scopes: RegenerationScope[];
  /** The precise instruction — `revalidateTag(tag)` for each. */
  tags: string[];
  /** The fallback instruction — `revalidatePath(path)` for each. */
  paths: string[];
  /**
   * The version being published: the `updatedAt` of the row that changed, in
   * milliseconds.
   *
   * This is what makes out-of-order delivery harmless. Two saves a second apart
   * produce two webhooks, and nothing guarantees they arrive in that order over
   * a network. A renderer that remembers the highest version it has published
   * can drop the late arrival instead of rebuilding the site from data it
   * already knows is older — which is the difference between "eventually
   * correct" and "correct, with a one-in-a-thousand chance of the old logo
   * coming back".
   */
  version: number;
  /** ISO timestamp of when the backend sent this. */
  sentAt: string;
}

export interface RevalidateRequest {
  slug: string;
  scopes: readonly RegenerationScope[];
  tags: readonly string[];
  paths: readonly string[];
  version: number;
}

/* ── 3. Signing ──────────────────────────────────────────────────────────── */

/**
 * `sha256=<hex>` over `<timestamp>.<body>`.
 *
 * The dot is not decoration. Without a separator, a payload ending in digits and
 * a timestamp beginning with digits can be re-split in more than one way, so two
 * different (timestamp, body) pairs could hash identically — the standard
 * length-extension-adjacent footgun that every webhook spec (Stripe's included)
 * avoids the same way.
 *
 * Exported so a test can assert the exact bytes, and so the renderer's
 * verification code can be written against a function rather than a paragraph.
 */
export function signRevalidatePayload(
  body: string,
  timestamp: string,
  secret: string,
): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${digest}`;
}

/* ── 4. The call ─────────────────────────────────────────────────────────── */

/**
 * Ask the renderer to rebuild the pages behind these tags and paths.
 *
 * Never throws; every exit is a `RevalidateOutcome`.
 *
 * Sending **both** tags and paths is deliberate belt-and-braces, and cheap: the
 * renderer uses whichever it supports. A tag-aware renderer ignores `paths` and
 * rebuilds every page carrying the tag, including the package detail pages
 * nobody could enumerate; a path-only renderer ignores `tags` and rebuilds the
 * six pages we *can* name, which is most of a site. Sending only what today's
 * renderer happens to support is how the fallback quietly stops existing.
 */
export async function revalidateSite(request: RevalidateRequest): Promise<RevalidateOutcome> {
  const started = Date.now();
  const base = { tags: request.tags.length, paths: request.paths.length };

  if (request.tags.length === 0 && request.paths.length === 0) {
    return { ...base, status: "revalidated", durationMs: 0 };
  }

  if (!isRendererEnabled()) {
    return { ...base, status: "skipped", durationMs: 0 };
  }

  const rendererUrl = (process.env.SITE_RENDERER_URL as string).replace(/\/$/, "");
  const secret = process.env.SITE_REVALIDATE_SECRET as string;

  const payload: RevalidatePayload = {
    slug: request.slug,
    scopes: [...request.scopes],
    tags: [...request.tags],
    paths: [...request.paths],
    version: request.version,
    sentAt: new Date().toISOString(),
  };

  // Serialise **once** and send exactly these bytes. Signing one string and
  // sending a re-serialised one is the single most common way a webhook
  // signature ends up failing verification for reasons nobody can reproduce:
  // `JSON.stringify` is not guaranteed to produce identical output twice for
  // objects assembled differently.
  const body = JSON.stringify(payload);
  const timestamp = Date.now().toString();

  try {
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

    if (!response.ok) {
      return {
        ...base,
        status: "failed",
        durationMs: Date.now() - started,
        error: `Renderer responded ${response.status}`,
      };
    }

    return {
      ...base,
      status: "revalidated",
      durationMs: Date.now() - started,
      revalidated: await readRevalidatedList(response),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown renderer error";
    console.warn(`[isr] revalidate failed for "${request.slug}": ${message}`);

    return { ...base, status: "failed", durationMs: Date.now() - started, error: message };
  }
}

/**
 * Read the optional `{ "revalidated": [...] }` acknowledgement.
 *
 * Wrapped in its own try/catch and returning `undefined` on any surprise,
 * because this is **nice-to-have telemetry attached to an operation that has
 * already succeeded**. The renderer returned 200; the pages are rebuilding. A
 * renderer that answers `200 OK` with an empty body, or with HTML, has done its
 * job — turning that into a failed regeneration (and a retry, and a second
 * rebuild) would be the client punishing the server for being terse.
 */
async function readRevalidatedList(response: Response): Promise<string[] | undefined> {
  try {
    const parsed = (await response.json()) as { revalidated?: unknown };
    if (!Array.isArray(parsed?.revalidated)) return undefined;
    return parsed.revalidated.filter((item): item is string => typeof item === "string");
  } catch {
    return undefined;
  }
}

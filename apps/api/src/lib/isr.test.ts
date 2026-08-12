import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

/**
 * Unit tests for the ISR revalidation client (White-label week · Day 4).
 *
 * Same shape as `cdn.test.ts` — `fetch` is a spy, nothing touches a network —
 * but with one extra concern that the CDN client does not have: **the request is
 * signed**, and a signature that is right in the tests and wrong on the wire is
 * a webhook that fails in production for reasons nobody can reproduce locally.
 *
 * So the signing tests do not merely check "a signature header exists". They
 * recompute the HMAC independently, over the exact bytes that were sent.
 */

import {
  REVALIDATE_PATH,
  isRendererEnabled,
  revalidateSite,
  revalidateTimeoutMs,
  signRevalidatePayload,
} from "./isr";

const RENDERER = "https://render.funtush.com";
const SECRET = "shared-revalidate-secret";

const originalEnv = { ...process.env };
const fetchMock = vi.fn();

function ok(body: unknown = { revalidated: ["/"] }): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** The everyday request: one scope, the tags and paths it invalidates. */
const REQUEST = {
  slug: "himalayan-trails",
  scopes: ["branding"] as const,
  tags: ["branding:himalayan-trails"],
  paths: ["/", "/packages"],
  version: 1_700_000_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  process.env.SITE_RENDERER_URL = RENDERER;
  process.env.SITE_REVALIDATE_SECRET = SECRET;
  delete process.env.SITE_REVALIDATE_TIMEOUT_MS;
  fetchMock.mockResolvedValue(ok());
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

/* ── 1. Configuration ────────────────────────────────────────────────────── */

describe("isRendererEnabled", () => {
  it("needs both the URL and the secret", () => {
    expect(isRendererEnabled()).toBe(true);

    delete process.env.SITE_REVALIDATE_SECRET;
    // A renderer URL with no secret would mean sending unsigned requests, which
    // the renderer must reject — so this is "not configured", not "configured
    // insecurely".
    expect(isRendererEnabled()).toBe(false);
  });
});

describe("revalidateTimeoutMs", () => {
  it("defaults to ten seconds — longer than a purge, because a rebuild is", () => {
    expect(revalidateTimeoutMs()).toBe(10000);

    process.env.SITE_REVALIDATE_TIMEOUT_MS = "2500";
    expect(revalidateTimeoutMs()).toBe(2500);
  });
});

/* ── 2. Signing ──────────────────────────────────────────────────────────── */

describe("signRevalidatePayload", () => {
  it("signs the timestamp and the body together", () => {
    const expected = createHmac("sha256", SECRET).update("1700.{}").digest("hex");

    expect(signRevalidatePayload("{}", "1700", SECRET)).toBe(`sha256=${expected}`);
  });

  it("changes when the timestamp changes, with the body identical", () => {
    // This is what makes a captured request un-replayable: an attacker who
    // resends yesterday's body cannot produce today's signature.
    expect(signRevalidatePayload("{}", "1", SECRET)).not.toBe(
      signRevalidatePayload("{}", "2", SECRET),
    );
  });

  it("separates the two fields so they cannot be re-split", () => {
    // Without the dot, ("12", "34") and ("1", "234") would hash identically —
    // two different requests with one signature. The separator is the fix every
    // webhook spec uses.
    expect(signRevalidatePayload("34", "12", SECRET)).not.toBe(
      signRevalidatePayload("234", "1", SECRET),
    );
  });
});

/* ── 3. The call ─────────────────────────────────────────────────────────── */

describe("revalidateSite", () => {
  it("skips silently when no renderer is configured", async () => {
    delete process.env.SITE_RENDERER_URL;

    const outcome = await revalidateSite(REQUEST);

    expect(outcome.status).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the renderer's webhook path", async () => {
    await revalidateSite(REQUEST);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RENDERER}${REVALIDATE_PATH}`);
    expect(init.method).toBe("POST");
  });

  it("does not double the slash when the URL ends in one", async () => {
    process.env.SITE_RENDERER_URL = `${RENDERER}/`;

    await revalidateSite(REQUEST);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${RENDERER}${REVALIDATE_PATH}`);
  });

  it("sends tags AND paths, never one or the other", async () => {
    // Deliberate belt-and-braces: a tag-aware renderer rebuilds pages nobody
    // could enumerate; a path-only renderer rebuilds the ones we can name.
    // Sending only what today's renderer supports is how the fallback quietly
    // stops existing.
    await revalidateSite(REQUEST);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.tags).toEqual(REQUEST.tags);
    expect(body.paths).toEqual(REQUEST.paths);
    expect(body.slug).toBe(REQUEST.slug);
    expect(body.version).toBe(REQUEST.version);
    expect(body.scopes).toEqual(["branding"]);
  });

  it("signs the exact bytes it sends", async () => {
    // The bug this catches: signing one serialisation and sending another. It
    // passes every local test and fails every real verification.
    await revalidateSite(REQUEST);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const timestamp = headers["x-funtush-timestamp"];

    const recomputed = createHmac("sha256", SECRET)
      .update(`${timestamp}.${init.body as string}`)
      .digest("hex");

    expect(headers["x-funtush-signature"]).toBe(`sha256=${recomputed}`);
  });

  it("reports the pages the renderer says it rebuilt", async () => {
    fetchMock.mockResolvedValue(ok({ revalidated: ["/", "/packages"] }));

    const outcome = await revalidateSite(REQUEST);

    expect(outcome.status).toBe("revalidated");
    expect(outcome.revalidated).toEqual(["/", "/packages"]);
  });

  it("still succeeds when the renderer answers 200 with an unreadable body", async () => {
    // A 200 means the pages are rebuilding. Failing the regeneration because
    // the acknowledgement was terse would trigger a retry, and therefore a
    // second rebuild, as a punishment for the renderer being brief.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected end of JSON input");
      },
    } as unknown as Response);

    const outcome = await revalidateSite(REQUEST);

    expect(outcome.status).toBe("revalidated");
    expect(outcome.revalidated).toBeUndefined();
  });

  it("ignores a malformed acknowledgement rather than trusting it", async () => {
    fetchMock.mockResolvedValue(ok({ revalidated: "everything" }));

    const outcome = await revalidateSite(REQUEST);

    expect(outcome.status).toBe("revalidated");
    expect(outcome.revalidated).toBeUndefined();
  });

  it("reports a non-2xx as failed, and never throws", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);

    const outcome = await revalidateSite(REQUEST);

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("500");
  });

  it("turns a thrown network error into a failed outcome", async () => {
    fetchMock.mockRejectedValue(new Error("The operation was aborted due to timeout"));

    const outcome = await revalidateSite(REQUEST);

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("timeout");
  });

  it("never leaks the secret", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);

    const outcome = await revalidateSite(REQUEST);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(outcome.error).not.toContain(SECRET);
    // The secret proves the message; it is never *in* the message.
    expect(init.body as string).not.toContain(SECRET);
    expect(JSON.stringify(init.headers)).not.toContain(SECRET);
  });

  it("does nothing when there is nothing to revalidate", async () => {
    const outcome = await revalidateSite({ ...REQUEST, tags: [], paths: [] });

    expect(outcome.status).toBe("revalidated");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

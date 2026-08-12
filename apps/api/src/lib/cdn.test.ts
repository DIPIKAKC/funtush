import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the CDN purge client (White-label week · Day 4).
 *
 * `fetch` is replaced with a spy, so nothing here touches a network. What is
 * being tested is not "does Cloudflare work" — it is the three promises this
 * module makes to everything upstream of it:
 *
 *   1. **No configuration ⇒ no network call, no failure.** A developer with no
 *      CDN must be able to save branding.
 *   2. **It never throws.** Every failure comes back as a value, because the
 *      caller has already committed a database row and must not be told the save
 *      failed.
 *   3. **The token never escapes.** Not into an error message, not into a log.
 */

import {
  MAX_URLS_PER_PURGE,
  buildPurgeBatches,
  cdnPurgeTimeoutMs,
  chunk,
  isCdnPurgeEnabled,
  purgeCdn,
} from "./cdn";

const ENDPOINT = "https://api.cloudflare.com/client/v4/zones/zone123/purge_cache";
const TOKEN = "super-secret-cdn-token";

const originalEnv = { ...process.env };
const fetchMock = vi.fn();

/** A successful CDN response, minus everything this client does not read. */
function ok(body: unknown = { success: true }): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** A CDN response that failed with a status code. */
function notOk(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  process.env.CDN_PURGE_URL = ENDPOINT;
  process.env.CDN_PURGE_TOKEN = TOKEN;
  delete process.env.CDN_PURGE_TIMEOUT_MS;
  fetchMock.mockResolvedValue(ok());
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

/* ── 1. Configuration ────────────────────────────────────────────────────── */

describe("isCdnPurgeEnabled", () => {
  it("needs both the URL and the token", () => {
    expect(isCdnPurgeEnabled()).toBe(true);

    // A URL with no token is worse than no configuration: every purge returns
    // 403, so a missing environment variable turns into an apparent outage that
    // repeats on every single save.
    delete process.env.CDN_PURGE_TOKEN;
    expect(isCdnPurgeEnabled()).toBe(false);

    process.env.CDN_PURGE_TOKEN = TOKEN;
    delete process.env.CDN_PURGE_URL;
    expect(isCdnPurgeEnabled()).toBe(false);
  });
});

describe("cdnPurgeTimeoutMs", () => {
  it("defaults to five seconds and accepts an override", () => {
    expect(cdnPurgeTimeoutMs()).toBe(5000);

    process.env.CDN_PURGE_TIMEOUT_MS = "1500";
    expect(cdnPurgeTimeoutMs()).toBe(1500);
  });

  it("ignores nonsense rather than disabling the timeout", () => {
    // `Number("soon")` is NaN and `AbortSignal.timeout(NaN)` fires immediately —
    // a typo in an env var would silently break every purge on the platform.
    for (const bad of ["soon", "", "0", "-1"]) {
      process.env.CDN_PURGE_TIMEOUT_MS = bad;
      expect(cdnPurgeTimeoutMs()).toBe(5000);
    }
  });
});

/* ── 2. Chunking ─────────────────────────────────────────────────────────── */

describe("chunk", () => {
  it("splits evenly and keeps the remainder", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns nothing for an empty list", () => {
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("buildPurgeBatches", () => {
  it("pairs URL and tag chunks instead of multiplying them", () => {
    // Zip, not cross product. A cross product would send every URL once per tag
    // chunk — the same purge many times over, which is how a rate limit is hit.
    const urls = Array.from({ length: 45 }, (_, i) => `https://x.io/${i}`);
    const batches = buildPurgeBatches(urls, ["branding:x"]);

    expect(batches).toHaveLength(2);
    expect(batches[0]!.files).toHaveLength(MAX_URLS_PER_PURGE);
    expect(batches[0]!.tags).toEqual(["branding:x"]);
    // The second batch carries the leftover URLs and no tags — the tags were
    // already sent, and sending them twice would purge them twice.
    expect(batches[1]!.files).toHaveLength(15);
    expect(batches[1]!.tags).toEqual([]);
  });
});

/* ── 3. The call ─────────────────────────────────────────────────────────── */

describe("purgeCdn", () => {
  it("skips silently when no CDN is configured", async () => {
    delete process.env.CDN_PURGE_URL;

    const outcome = await purgeCdn({ urls: ["https://x.io/"] });

    expect(outcome.status).toBe("skipped");
    // The assertion that matters: not one network call was attempted.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an empty request as success, not as a skip", async () => {
    // "Nothing to purge" and "no CDN configured" look the same in a log and are
    // completely different incidents. Keeping them apart is why there are three
    // statuses instead of two.
    const outcome = await purgeCdn({ urls: [], tags: [] });

    expect(outcome.status).toBe("purged");
    expect(outcome.requests).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the URLs and tags in Cloudflare's shape, with the bearer token", async () => {
    await purgeCdn({ urls: ["https://x.io/"], tags: ["branding:x"] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({
      files: ["https://x.io/"],
      tags: ["branding:x"],
    });
    // Without this, a hanging CDN control plane hangs the pipeline forever.
    expect(init.signal).toBeDefined();
  });

  it("chunks past the provider's per-request limit", async () => {
    const urls = Array.from({ length: 65 }, (_, i) => `https://x.io/${i}`);

    const outcome = await purgeCdn({ urls });

    // 30 + 30 + 5. A site that grows past 30 pages must not silently stop
    // purging its newest ones.
    expect(outcome.requests).toBe(3);
    expect(outcome.status).toBe("purged");
  });

  it("reports a non-2xx as failed, and never throws", async () => {
    fetchMock.mockResolvedValue(notOk(403));

    const outcome = await purgeCdn({ urls: ["https://x.io/"] });

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("403");
  });

  it("stops after the first failed batch", async () => {
    // Continuing would send more doomed requests to a service that is already
    // rejecting us, and the retry upstairs will resend the whole set anyway.
    fetchMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(notOk(500));
    const urls = Array.from({ length: 65 }, (_, i) => `https://x.io/${i}`);

    const outcome = await purgeCdn({ urls });

    expect(outcome.status).toBe("failed");
    expect(outcome.requests).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("turns a thrown network error into a failed outcome", async () => {
    fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

    const outcome = await purgeCdn({ urls: ["https://x.io/"] });

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("ENOTFOUND");
  });

  it("never puts the token anywhere but the Authorization header", async () => {
    // The token is a platform-wide credential, and `error` ends up in an API
    // response, a log line and possibly a support ticket. Asserted rather than
    // assumed, because "obviously we don't log the token" is what every leaked
    // credential was protected by.
    fetchMock.mockResolvedValue(notOk(403));

    const outcome = await purgeCdn({ urls: ["https://x.io/"], reason: "branding save" });

    expect(outcome.error).not.toContain(TOKEN);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).not.toContain(TOKEN);
  });

  it("counts what it was asked to purge, not what it managed to send", async () => {
    fetchMock.mockResolvedValue(notOk(500));

    const outcome = await purgeCdn({ urls: ["https://x.io/a", "https://x.io/b"], tags: ["t"] });

    // A receipt has to say what was *meant* to be purged even when nothing was —
    // that is the difference between "we tried and failed" and "we never tried".
    expect(outcome.urls).toBe(2);
    expect(outcome.tags).toBe(1);
  });
});

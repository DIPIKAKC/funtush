import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the under-construction gate (White-label week · Day 2).
 *
 * The service is stubbed so this suite tests only what the middleware itself
 * decides: which status, which headers, whether `next()` runs.
 *
 * Every assertion here is about a decision that is invisible in normal use and
 * expensive when wrong — a 404 instead of a 503 costs an agency its search
 * ranking, a cached 503 makes the off switch look broken, and failing closed on
 * a database blip takes a live customer site down.
 */

const getSiteLiveness = vi.fn();

vi.mock("../services/siteConfig.service", () => ({
  getSiteLiveness: (...a: unknown[]) => getSiteLiveness(...a),
}));

import { requireSiteLive } from "./siteLive.middleware";

/** A minimal Express response double that records what was set. */
function mockRes() {
  const headers: Record<string, string> = {};
  const state = {
    status: 0,
    body: undefined as unknown,
    ended: false,
    headers,
  };

  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    status: (code: number) => {
      state.status = code;
      return res;
    },
    json: (body: unknown) => {
      state.body = body;
      state.ended = true;
    },
  };

  return { res, state };
}

function mockReq(slug?: string) {
  return { params: slug === undefined ? {} : { slug } };
}

const COMING_SOON = { headline: "Back in October", message: "We're rebuilding." };

beforeEach(() => {
  vi.clearAllMocks();
  getSiteLiveness.mockResolvedValue({ live: true, comingSoon: null });
});

describe("requireSiteLive", () => {
  it("calls next() for a live site", async () => {
    const next = vi.fn();
    const { res, state } = mockRes();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireSiteLive(mockReq("himalayan-trails") as any, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(state.status).toBe(0);
  });

  it("lowercases the slug before looking it up", async () => {
    // Hostnames are case-insensitive, so `HIMALAYAN-TRAILS.funtush.io` is the
    // same site. Without this, a capitalised deep link 404s.
    const next = vi.fn();
    const { res } = mockRes();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireSiteLive(mockReq("Himalayan-Trails") as any, res as any, next);

    expect(getSiteLiveness).toHaveBeenCalledWith("himalayan-trails");
  });

  it("answers 503, not 404, while the site is under construction", async () => {
    // The single most consequential line in the file. Google removes 404 URLs
    // from its index within days, so 404 would cost an agency its search
    // ranking over a weekend redesign. 503 is the documented "come back later"
    // and crawlers hold the URL.
    getSiteLiveness.mockResolvedValue({ live: false, comingSoon: COMING_SOON });
    const next = vi.fn();
    const { res, state } = mockRes();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireSiteLive(mockReq("himalayan-trails") as any, res as any, next);

    expect(state.status).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("sets Retry-After so a crawler knows when to come back", async () => {
    getSiteLiveness.mockResolvedValue({ live: false, comingSoon: COMING_SOON });
    const { res, state } = mockRes();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireSiteLive(mockReq("x") as any, res as any, vi.fn());

    expect(Number(state.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("refuses to let the 503 be cached", async () => {
    // 503 is the one status a CDN would love to cache. Construction mode is
    // switched off by a human who then immediately reloads their own site; a
    // cached 503 would show them the coming-soon page for the whole TTL and
    // they would report the toggle as broken.
    getSiteLiveness.mockResolvedValue({ live: false, comingSoon: COMING_SOON });
    const { res, state } = mockRes();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireSiteLive(mockReq("x") as any, res as any, vi.fn());

    expect(state.headers["Cache-Control"]).toBe("no-store");
  });

  it("carries the coming-soon copy in the 503 body", async () => {
    // So a renderer hitting a content route first — a deep link, a shared URL,
    // a reload — can draw the right page from this response alone.
    getSiteLiveness.mockResolvedValue({ live: false, comingSoon: COMING_SOON });
    const { res, state } = mockRes();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireSiteLive(mockReq("x") as any, res as any, vi.fn());

    expect(state.body).toMatchObject({
      underConstruction: true,
      comingSoon: COMING_SOON,
    });
  });

  it("answers 404 for an agency that is missing, suspended or locked", async () => {
    // Not live *and* no coming-soon copy is how the service reports those three
    // cases, and Day 1's rule is that they all look identical from outside.
    getSiteLiveness.mockResolvedValue({ live: false, comingSoon: null });
    const { res, state } = mockRes();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireSiteLive(mockReq("nope") as any, res as any, vi.fn());

    expect(state.status).toBe(404);
  });

  it("400s a route mounted without a :slug param", async () => {
    const { res, state } = mockRes();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireSiteLive(mockReq() as any, res as any, vi.fn());

    expect(state.status).toBe(400);
    expect(getSiteLiveness).not.toHaveBeenCalled();
  });

  it("fails OPEN when the liveness check itself throws", async () => {
    // The judgement call in this file. If Postgres blips, the choice is between
    // showing every visitor a coming-soon page for a site that is perfectly
    // live, or letting the request reach a handler with its own error handling.
    // Taking a paying customer's website down because a *guard* could not
    // confirm it was up is the worse outcome by a wide margin.
    getSiteLiveness.mockRejectedValue(new Error("connection terminated"));
    const next = vi.fn();
    const { res, state } = mockRes();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await requireSiteLive(mockReq("himalayan-trails") as any, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(state.status).toBe(0);
  });
});

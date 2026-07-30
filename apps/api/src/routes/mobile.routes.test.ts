import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the mobile routes.
 *
 * These go through a real Express app so they cover the parts unit tests
 * cannot: that the router is mounted, that the guards are attached in the right
 * order, that query validation returns the right status codes, and that the
 * mobile cache header is set.
 *
 * `@funtush/auth` is mocked so we can drive the "who is calling" dimension
 * directly instead of minting real JWTs — and so importing it does not open the
 * live Redis connection it creates at module load.
 */

const { authState, requireRoleSpy } = vi.hoisted(() => ({
  authState: { user: undefined as Record<string, unknown> | undefined },
  requireRoleSpy: vi.fn(),
}));

vi.mock("@funtush/auth", () => ({
  // Stand-in for the real bearer-token check: if the test set a user, the
  // request is authenticated; otherwise it 401s exactly like the real guard.
  requireAuth: (req: Record<string, unknown>, res: { status: (c: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (!authState.user) return res.status(401).json({ message: "No token provided" });
    req.user = authState.user;
    next();
  },
  requireRole: (roles: string[]) => {
    requireRoleSpy(roles);
    return (
      req: { user?: { role?: string } },
      res: { status: (c: number) => { json: (b: unknown) => void } },
      next: () => void
    ) => {
      if (!req.user?.role || !roles.includes(req.user.role)) {
        return res.status(403).json({ message: "Forbidden: role not allowed" });
      }
      next();
    };
  },
}));

const getTrekkerDashboard = vi.fn();
const getGuideDashboard = vi.fn();
const buildOfflinePackage = vi.fn();
const getOfflinePackageVersion = vi.fn();

vi.mock("../services/offlinePackage.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/offlinePackage.service")>();
  return {
    ...actual,
    buildOfflinePackage: (...a: unknown[]) => buildOfflinePackage(...a),
    getOfflinePackageVersion: (...a: unknown[]) => getOfflinePackageVersion(...a),
  };
});

vi.mock("../services/mobile.service", async (importOriginal) => {
  // Keep the real helpers (parseSection, TREK_SECTIONS) so validation is
  // genuinely exercised; only the two data-fetching functions are stubbed.
  const actual = await importOriginal<typeof import("../services/mobile.service")>();
  return {
    ...actual,
    getTrekkerDashboard: (...a: unknown[]) => getTrekkerDashboard(...a),
    getGuideDashboard: (...a: unknown[]) => getGuideDashboard(...a),
  };
});

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;
/** Roles passed to `requireRole` at module load, captured before any reset. */
let guardedRoles: string[][] = [];

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: mobileRoutes } = await import("./mobile.routes");

  // `requireRole(...)` is evaluated once, while the router module is imported —
  // snapshot it now, before `beforeEach` clears the spy.
  guardedRoles = requireRoleSpy.mock.calls.map((call) => call[0] as string[]);

  const app = express();
  app.use(express.json());
  app.use("/mobile", mobileRoutes);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(() => {
  if (server) server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = undefined;
  getTrekkerDashboard.mockResolvedValue({
    trekkerId: "trekker-1",
    section: "upcoming",
    counts: { upcoming: 1, active: 0, completed: 0 },
    data: [],
    meta: { total: 1, page: 1, limit: 10, pages: 1 },
  });
  getGuideDashboard.mockResolvedValue({
    guide: { userId: "user-7", agencyUserId: null, staffId: null },
    section: "upcoming",
    counts: { upcoming: 0, active: 0, completed: 0 },
    today: { date: "2026-07-27", total: 0, itinerary: [] },
    data: [],
    meta: { total: 0, page: 1, limit: 10, pages: 0 },
  });
  buildOfflinePackage.mockResolvedValue({
    bookingId: "booking-1",
    version: 3,
    generatedAt: "2026-07-28T09:30:00.000Z",
    contentUpdatedAt: "2026-07-28T09:30:00.000Z",
    status: "PAID",
    trek: { title: "Everest Base Camp", countryCode: "NP" },
    itinerary: [{ dayNumber: 1 }],
    packingList: [],
    emergency: { countryCode: "NP", contacts: [], trekkerEmergencyContact: null },
  });
  getOfflinePackageVersion.mockResolvedValue({
    bookingId: "booking-1",
    version: 3,
    contentUpdatedAt: "2026-07-28T09:30:00.000Z",
    status: "PAID",
  });
});

describe("GET /mobile/trekker/dashboard", () => {
  it("401s without a token", async () => {
    const res = await fetch(`${baseUrl}/mobile/trekker/dashboard`);
    expect(res.status).toBe(401);
  });

  it("403s when the caller is not a trekker", async () => {
    authState.user = { userId: "user-1", role: "AGENCY_ADMIN", roleType: "TENANT" };
    const res = await fetch(`${baseUrl}/mobile/trekker/dashboard`);
    expect(res.status).toBe(403);
  });

  it("returns the dashboard, defaults to the upcoming section, and sets a private cache header", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };

    const res = await fetch(`${baseUrl}/mobile/trekker/dashboard`);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
    expect(body.counts).toEqual({ upcoming: 1, active: 0, completed: 0 });

    const [userId, section, page] = getTrekkerDashboard.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(section).toBe("upcoming");
    expect(page).toEqual({ page: 1, limit: 10, skip: 0, take: 10 });
  });

  it("passes page/limit through and clamps limit to the mobile maximum", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };

    await fetch(`${baseUrl}/mobile/trekker/dashboard?page=2&limit=500`);

    expect(getTrekkerDashboard.mock.calls[0][2]).toEqual({
      page: 2,
      limit: 30,
      skip: 30,
      take: 30,
    });
  });

  it("400s on an unknown section", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };

    const res = await fetch(`${baseUrl}/mobile/trekker/dashboard?section=nope`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Invalid section");
    expect(getTrekkerDashboard).not.toHaveBeenCalled();
  });

  it("maps a service error's status onto the HTTP response", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };
    getTrekkerDashboard.mockRejectedValue(
      Object.assign(new Error("Trekker profile not found"), { status: 404 })
    );

    const res = await fetch(`${baseUrl}/mobile/trekker/dashboard`);
    expect(res.status).toBe(404);
  });
});

describe("GET /mobile/guide/dashboard", () => {
  it("401s without a token", async () => {
    const res = await fetch(`${baseUrl}/mobile/guide/dashboard`);
    expect(res.status).toBe(401);
  });

  it("403s for a trekker token", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };
    const res = await fetch(`${baseUrl}/mobile/guide/dashboard`);
    expect(res.status).toBe(403);
  });

  it("403s when the token carries no agency — an unscoped query would leak tenants", async () => {
    authState.user = { userId: "user-7", role: "GUIDE", roleType: "TENANT" };

    const res = await fetch(`${baseUrl}/mobile/guide/dashboard`);

    expect(res.status).toBe(403);
    expect(getGuideDashboard).not.toHaveBeenCalled();
  });

  it("passes the agency id from the token into the service", async () => {
    authState.user = {
      userId: "user-7",
      role: "GUIDE",
      roleType: "TENANT",
      agencyId: "agency-1",
    };

    const res = await fetch(`${baseUrl}/mobile/guide/dashboard?section=active`);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.today).toBeDefined();

    const [userId, agencyId, section] = getGuideDashboard.mock.calls[0];
    expect(userId).toBe("user-7");
    expect(agencyId).toBe("agency-1");
    expect(section).toBe("active");
  });
});

describe("GET /mobile/bookings/:id/offline-package", () => {
  const url = (suffix = "") => `${baseUrl}/mobile/bookings/booking-1/offline-package${suffix}`;

  it("401s without a token", async () => {
    const res = await fetch(url());
    expect(res.status).toBe(401);
  });

  it("403s a role that has no business here at all", async () => {
    authState.user = { userId: "user-1", role: "SUPER_ADMIN", roleType: "PLATFORM" };
    const res = await fetch(url());
    expect(res.status).toBe(403);
  });

  it("returns the bundle with an ETag and a private 5-minute cache header", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };

    const res = await fetch(url());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"v3"');
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(body.version).toBe(3);
    expect(body.itinerary).toHaveLength(1);

    const [bookingId, actor] = buildOfflinePackage.mock.calls[0]!;
    expect(bookingId).toBe("booking-1");
    expect(actor).toEqual({ userId: "user-1", role: "TREKKER", agencyId: undefined });
  });

  it("passes the agency id from a tenant token into the service", async () => {
    authState.user = {
      userId: "user-7",
      role: "GUIDE",
      roleType: "TENANT",
      agencyId: "agency-1",
    };

    await fetch(url());

    expect(buildOfflinePackage.mock.calls[0]![1]).toEqual({
      userId: "user-7",
      role: "GUIDE",
      agencyId: "agency-1",
    });
  });

  it("304s an up-to-date If-None-Match, with no body", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };

    const res = await fetch(url(), { headers: { "If-None-Match": '"v3"' } });

    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("304s a weak validator too", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };

    const res = await fetch(url(), { headers: { "If-None-Match": 'W/"v3"' } });
    expect(res.status).toBe(304);
  });

  it("304s ?knownVersion, for clients that keep the JSON but not the headers", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };

    const res = await fetch(url("?knownVersion=3"));
    expect(res.status).toBe(304);
  });

  it("sends the full bundle when the client's cached version is behind", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };

    const res = await fetch(url("?knownVersion=2"));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { version: number }).version).toBe(3);
  });

  it("maps a service 409 onto the HTTP response", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };
    buildOfflinePackage.mockRejectedValue(
      Object.assign(new Error("Offline package is only available once a booking is confirmed"), {
        status: 409,
      })
    );

    const res = await fetch(url());
    expect(res.status).toBe(409);
  });

  it("maps a service 404 onto the HTTP response", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };
    buildOfflinePackage.mockRejectedValue(
      Object.assign(new Error("Booking not found"), { status: 404 })
    );

    const res = await fetch(url());
    expect(res.status).toBe(404);
  });
});

describe("GET /mobile/bookings/:id/offline-package/version", () => {
  // A function, not a const: `baseUrl` is only known once `beforeAll` has
  // started the server, which happens after this block is collected.
  const url = () => `${baseUrl}/mobile/bookings/booking-1/offline-package/version`;

  it("401s without a token", async () => {
    const res = await fetch(url());
    expect(res.status).toBe(401);
  });

  it("returns only the counter, and forbids caching the answer", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };

    const res = await fetch(url());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(body).toEqual({
      bookingId: "booking-1",
      version: 3,
      contentUpdatedAt: "2026-07-28T09:30:00.000Z",
      status: "PAID",
    });
    // The probe must never fall through to the expensive handler.
    expect(buildOfflinePackage).not.toHaveBeenCalled();
  });

  it("does not 304 — a freshness probe must always answer", async () => {
    authState.user = { userId: "user-1", role: "TREKKER", roleType: "TREKKER" };

    const res = await fetch(url(), { headers: { "If-None-Match": '"v3"' } });
    expect(res.status).toBe(200);
  });
});

describe("route guards", () => {
  it("locks each route to the roles that own it", () => {
    expect(guardedRoles).toEqual([
      ["TREKKER"],
      ["GUIDE", "STAFF"],
      ["TREKKER", "GUIDE", "STAFF", "AGENCY_MODERATOR", "AGENCY_ADMIN"],
      ["TREKKER", "GUIDE", "STAFF", "AGENCY_MODERATOR", "AGENCY_ADMIN"],
    ]);
  });
});

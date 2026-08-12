import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * HTTP-level tests for the branding routes (White-label week · Day 1).
 *
 * These go through a real Express app, so they cover what the unit tests
 * structurally cannot: that the router is mounted at the paths the task
 * specifies, that the guards are attached and in the right order, that the
 * validation middleware actually runs, and that the public read is genuinely
 * public.
 *
 * The middleware is mocked so the "who is calling" dimension can be driven
 * directly — importing the real `refreshTokenAuthentication` would pull in
 * `@funtush/database` and try to talk to Postgres on every request.
 */

const { authState } = vi.hoisted(() => ({
  authState: { agencyId: undefined as string | undefined },
}));

vi.mock("../middleware/refreshTokenAuthentication", () => ({
  authenticateWithRefreshToken: (
    req: Record<string, unknown>,
    res: { status: (c: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!authState.agencyId) return res.status(401).json({ message: "Refresh token is required" });
    req.agencyId = authState.agencyId;
    next();
  },
}));

/** Records whether the status guard ran, so its presence can be asserted. */
const statusGuardSpy = vi.fn();

vi.mock("../middleware/agencyAccess.middleware", () => ({
  checkAgencyStatus: (_req: unknown, _res: unknown, next: () => void) => {
    statusGuardSpy();
    next();
  },
}));

const getAgencyBranding = vi.fn();
const getBrandingOptions = vi.fn();
const getPublicBrandingBySlug = vi.fn();
const updateAgencyBranding = vi.fn();

vi.mock("../services/branding.service", async (importOriginal) => {
  // Keep the pure helpers real (`brandingCssVariables`, `brandingStyleBlock`) so
  // the response body is genuinely produced by the code that ships; only the
  // four database-touching entry points are stubbed.
  const actual = await importOriginal<typeof import("../services/branding.service")>();
  return {
    ...actual,
    getAgencyBranding: (...a: unknown[]) => getAgencyBranding(...a),
    getBrandingOptions: (...a: unknown[]) => getBrandingOptions(...a),
    getPublicBrandingBySlug: (...a: unknown[]) => getPublicBrandingBySlug(...a),
    updateAgencyBranding: (...a: unknown[]) => updateAgencyBranding(...a),
  };
});

vi.mock("@funtush/database", () => ({ db: {} }));

let server: Server;
let baseUrl: string;

const THEME = {
  brandName: "Himalayan Trails",
  logoUrl: "https://cdn.funtush.com/uploads/logo.png",
  faviconUrl: null,
  primaryColor: "#0F766E",
  onPrimaryColor: "#FFFFFF",
  paletteId: "teal",
  fontFamily: "inter",
  fontStack: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  cardImageRatio: "RATIO_4_3",
  cardImageRatioValue: "4 / 3",
  currencyCode: "NPR",
  currencySymbol: "Rs",
  currencyDisplay: "SYMBOL",
  currencyExample: "Rs 1,200",
  colorPickerMode: "curated",
  updatedAt: new Date("2026-08-07T09:00:00.000Z"),
};

beforeAll(async () => {
  const express = (await import("express")).default;
  const { default: brandingRoutes } = await import("./branding.routes");

  const app = express();
  app.use(express.json());
  app.use("/", brandingRoutes);

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
  authState.agencyId = undefined;
  getAgencyBranding.mockResolvedValue(THEME);
  updateAgencyBranding.mockResolvedValue(THEME);
  getPublicBrandingBySlug.mockResolvedValue({ ...THEME, agencySlug: "himalayan-trails" });
  getBrandingOptions.mockResolvedValue({ tier: "SMALL", colorPickerMode: "curated", palette: [] });
});

/** PATCH with a JSON body — the no-file path through the same handler. */
function patchJson(body: unknown, token?: string) {
  return fetch(`${baseUrl}/agencies/me/branding`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-refresh-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

/**
 * `Response.json()` is typed `unknown` — correct, since the server could return
 * anything. A test does know the shape it asked for, so this narrows it in one
 * place instead of casting at every call site.
 */
async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/* ── Auth ───────────────────────────────────────────────────────────────── */

describe("auth on the dashboard endpoints", () => {
  it("401s every /agencies/me/branding route without a token", async () => {
    const paths = ["/agencies/me/branding", "/agencies/me/branding/options"];
    for (const path of paths) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status, path).toBe(401);
    }
    expect((await patchJson({ brandName: "Trails" })).status).toBe(401);
  });

  it("never reaches the service when the caller is anonymous", async () => {
    await patchJson({ brandName: "Trails" });
    expect(updateAgencyBranding).not.toHaveBeenCalled();
  });

  it("passes the session's agency id to the service, never a body field", async () => {
    authState.agencyId = "agency-1";
    // `agencyId` in the body is rejected outright by `.strict()`, which is the
    // strongest possible answer to "can a client name someone else's tenant?".
    const res = await patchJson({ brandName: "Trails", agencyId: "someone-else" }, "tok");
    expect(res.status).toBe(400);

    await patchJson({ brandName: "Trails" }, "tok");
    expect(updateAgencyBranding).toHaveBeenCalledWith("agency-1", { brandName: "Trails" }, {});
  });
});

/* ── The write ──────────────────────────────────────────────────────────── */

describe("PATCH /agencies/me/branding", () => {
  beforeEach(() => {
    authState.agencyId = "agency-1";
  });

  it("saves a valid JSON body and echoes the CSS variables back", async () => {
    const res = await patchJson({ primaryColor: "#0F766E", cardImageRatio: "RATIO_16_9" }, "tok");
    expect(res.status).toBe(200);

    const body = await readJson<{
      success: boolean;
      data: { brandName: string };
      cssVariables: Record<string, string>;
    }>(res);
    expect(body.success).toBe(true);
    expect(body.data.brandName).toBe("Himalayan Trails");
    // The live-preview payload: the settings screen can apply these without a
    // second round trip.
    expect(body.cssVariables["--brand-primary"]).toBe("#0F766E");
    expect(body.cssVariables["--brand-card-ratio"]).toBe("4 / 3");
  });

  it("runs the status guard before writing — a LOCKED account is read-only", async () => {
    await patchJson({ brandName: "Trails" }, "tok");
    expect(statusGuardSpy).toHaveBeenCalled();
  });

  it("does not run the status guard on the read", async () => {
    // A locked agency can still look at its own settings; §6 says locked is
    // read-only, not invisible.
    await fetch(`${baseUrl}/agencies/me/branding`, { headers: { "x-refresh-token": "tok" } });
    expect(statusGuardSpy).not.toHaveBeenCalled();
  });

  it("400s an invalid field before the service is called", async () => {
    const res = await patchJson({ primaryColor: "not-a-colour" }, "tok");
    expect(res.status).toBe(400);
    expect(updateAgencyBranding).not.toHaveBeenCalled();
  });

  it("400s an unknown field rather than silently ignoring it", async () => {
    const res = await patchJson({ primaryColour: "#FF0000" }, "tok");
    expect(res.status).toBe(400);
  });

  it("hands the service the normalised body, not the raw one", async () => {
    await patchJson({ primaryColor: "#0f766e", currencyCode: "usd" }, "tok");
    expect(updateAgencyBranding).toHaveBeenCalledWith(
      "agency-1",
      { primaryColor: "#0F766E", currencyCode: "USD" },
      {},
    );
  });

  it("passes a thrown service status straight through — 403 for a tier refusal", async () => {
    const err = Object.assign(new Error("Your plan includes the curated colour palette."), {
      status: 403,
    });
    updateAgencyBranding.mockRejectedValue(err);

    const res = await patchJson({ primaryColor: "#FF00AA" }, "tok");
    expect(res.status).toBe(403);
    expect((await readJson<{ message: string }>(res)).message).toMatch(/curated colour palette/);
  });

  it("never caches a settings response", async () => {
    const res = await patchJson({ brandName: "Trails" }, "tok");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

/* ── The public read — the white-label renderer's entry point ───────────── */

describe("GET /site/:slug/branding", () => {
  it("serves an anonymous visitor with no token at all", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/branding`);
    expect(res.status).toBe(200);
    expect((await readJson<{ data: { brandName: string } }>(res)).data.brandName).toBe(
      "Himalayan Trails",
    );
  });

  it("is publicly cacheable, unlike every dashboard route", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/branding`);
    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("etag")).toBeTruthy();
  });

  it("labels the response so Day 4's purge can find it", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/branding`);

    // A CDN can only purge by a tag the response told it about. Without this
    // header every tag-based purge succeeds and clears nothing — the most
    // expensive kind of bug, because it looks like it works.
    expect(res.headers.get("cache-tag")).toBe("branding:himalayan-trails");
  });

  it("scopes that label to one agency", async () => {
    // A shared tag would mean one agency's save purges every site on the
    // platform (Backend Guide §4).
    getPublicBrandingBySlug.mockResolvedValue({ ...THEME, agencySlug: "annapurna-base" });
    const res = await fetch(`${baseUrl}/site/annapurna-base/branding`);

    expect(res.headers.get("cache-tag")).toBe("branding:annapurna-base");
  });

  it("304s a repeat request carrying the same ETag", async () => {
    const first = await fetch(`${baseUrl}/site/himalayan-trails/branding`);
    const etag = first.headers.get("etag") as string;

    const second = await fetch(`${baseUrl}/site/himalayan-trails/branding`, {
      headers: { "if-none-match": etag },
    });
    expect(second.status).toBe(304);
  });

  it("changes the ETag when the branding is saved again", async () => {
    const first = await fetch(`${baseUrl}/site/himalayan-trails/branding`);
    getPublicBrandingBySlug.mockResolvedValue({
      ...THEME,
      agencySlug: "himalayan-trails",
      updatedAt: new Date("2026-08-08T10:00:00.000Z"),
    });
    const second = await fetch(`${baseUrl}/site/himalayan-trails/branding`);

    // If this ever stopped changing, an agency would save a new logo and see the
    // old one for as long as the cache lived.
    expect(second.headers.get("etag")).not.toBe(first.headers.get("etag"));
  });

  it("returns a real CSS block for ?format=css", async () => {
    const res = await fetch(`${baseUrl}/site/himalayan-trails/branding?format=css`);
    expect(res.headers.get("content-type")).toContain("text/css");

    const css = await res.text();
    expect(css).toContain(":root {");
    expect(css).toContain("--brand-primary: #0F766E;");
    expect(css).not.toMatch(/null|undefined/);
  });

  it("404s a slug the service refuses, without leaking why", async () => {
    getPublicBrandingBySlug.mockRejectedValue(
      Object.assign(new Error("Site not found"), { status: 404 }),
    );
    const res = await fetch(`${baseUrl}/site/locked-agency/branding`);
    expect(res.status).toBe(404);
    expect((await readJson<{ message: string }>(res)).message).toBe("Site not found");
  });
});

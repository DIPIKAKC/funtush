import type { Request, Response } from "express";
import {
  getTrekkerDashboard,
  getGuideDashboard,
  parseSection,
  TREK_SECTIONS,
} from "../services/mobile.service";
import { parsePagination } from "../utils/pagination";

/**
 * ── Mobile dashboard controllers (Mobile week · Day 1) ───────────────────────
 *
 * Controllers stay thin on purpose: read the request, validate it, call the
 * service, shape the HTTP response. All the business logic lives in
 * `mobile.service.ts`, which is why that file is the one covered by unit tests.
 */

/** Page size for mobile lists — smaller than the web default to save bandwidth. */
const MOBILE_DEFAULT_LIMIT = 10;
const MOBILE_MAX_LIMIT = 30;

/**
 * Tell caches (and the app's own HTTP layer) that this body is user-specific
 * and may be reused for 30 seconds. `private` forbids shared/CDN caches from
 * storing it — this is one trekker's booking data, it must never be served to
 * anyone else. The 30s window kills the duplicate requests a mobile screen
 * fires on quick tab switches without ever showing meaningfully stale data.
 */
function setMobileCacheHeaders(res: Response): void {
  res.set("Cache-Control", "private, max-age=30");
}

/** Turn a thrown service error into a status code + message, with no stack leak. */
function respondWithError(res: Response, err: unknown, route: string): void {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[${route}]`, err);
  res.status(status).json({ error: message });
}

/**
 * GET /mobile/trekker/dashboard?section=upcoming|active|completed&page=1&limit=10
 */
export async function trekkerDashboardController(req: Request, res: Response): Promise<void> {
  try {
    // `requireAuth` has already verified the JWT and populated `req.user`.
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const section = parseSection(req.query.section);
    if (!section) {
      res.status(400).json({
        error: `Invalid section. Expected one of: ${TREK_SECTIONS.join(", ")}`,
      });
      return;
    }

    const page = parsePagination(req.query as Record<string, unknown>, {
      defaultLimit: MOBILE_DEFAULT_LIMIT,
      maxLimit: MOBILE_MAX_LIMIT,
    });

    const dashboard = await getTrekkerDashboard(userId, section, page);

    setMobileCacheHeaders(res);
    res.json(dashboard);
  } catch (err) {
    respondWithError(res, err, "GET /mobile/trekker/dashboard");
  }
}

/**
 * GET /mobile/guide/dashboard?section=upcoming|active|completed&page=1&limit=10
 */
export async function guideDashboardController(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // A guide token must carry an agency. Without it we cannot scope the query
    // to one tenant, and an unscoped booking query is exactly the cross-tenant
    // leak Backend Guide §4 forbids — so refuse rather than guess.
    const agencyId = req.user?.agencyId;
    if (!agencyId) {
      res.status(403).json({ error: "Forbidden: token is not scoped to an agency" });
      return;
    }

    const section = parseSection(req.query.section);
    if (!section) {
      res.status(400).json({
        error: `Invalid section. Expected one of: ${TREK_SECTIONS.join(", ")}`,
      });
      return;
    }

    const page = parsePagination(req.query as Record<string, unknown>, {
      defaultLimit: MOBILE_DEFAULT_LIMIT,
      maxLimit: MOBILE_MAX_LIMIT,
    });

    const dashboard = await getGuideDashboard(userId, agencyId, section, page);

    setMobileCacheHeaders(res);
    res.json(dashboard);
  } catch (err) {
    respondWithError(res, err, "GET /mobile/guide/dashboard");
  }
}

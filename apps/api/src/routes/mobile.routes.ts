import { Router } from "express";
import { requireAuth, requireRole } from "@funtush/auth";
import {
  trekkerDashboardController,
  guideDashboardController,
} from "../controllers/mobile.controller";

/**
 * ── Mobile API routes (Mobile week · Day 1) ──────────────────────────────────
 *
 * Mounted at `/mobile` in `src/index.ts`.
 *
 * Why a separate `/mobile` prefix instead of reusing the web endpoints?
 * The web dashboard and the phone app want *different* payloads for the same
 * data: the web can afford a fat, deeply nested response, the phone cannot. A
 * separate namespace lets us tune payload size for mobile without ever risking
 * a breaking change to the web routes.
 *
 * Both routes are behind `requireAuth` (valid JWT) and then `requireRole`,
 * which checks the `role` claim inside that JWT.
 */
const router = Router();

/**
 * GET /mobile/trekker/dashboard
 * Trekkers only. A trekker's data is platform-level, so no agency scope here.
 */
router.get(
  "/trekker/dashboard",
  requireAuth,
  requireRole(["TREKKER"]),
  trekkerDashboardController
);

/**
 * GET /mobile/guide/dashboard
 * Guides only. `GUIDE` is the intended role; `STAFF` is accepted because
 * agencies currently onboard guides through the staff invite flow, which issues
 * a `STAFF` role with a guide role-record attached. The controller still scopes
 * every query to the caller's own agency and their own assigned treks, so a
 * non-guide staff member simply gets an empty dashboard.
 */
router.get(
  "/guide/dashboard",
  requireAuth,
  requireRole(["GUIDE", "STAFF"]),
  guideDashboardController
);

export default router;

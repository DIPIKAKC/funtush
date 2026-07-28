import { Router } from "express";
import { requireAuth, requireRole } from "@funtush/auth";
import {
  trekkerDashboardController,
  guideDashboardController,
} from "../controllers/mobile.controller";
import {
  offlinePackageController,
  offlinePackageVersionController,
} from "../controllers/offlinePackage.controller";

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

/* ── Offline itinerary caching (Mobile week · Day 2) ─────────────────────── */

/**
 * The roles allowed to *reach* these two routes.
 *
 * This list is deliberately broad — a trekker, their guide, and the agency staff
 * who manage the trek all legitimately open the same booking. `requireRole` only
 * answers "is this a kind of user that could ever read an offline package?".
 *
 * The narrower question — "is this booking *yours*?" — cannot be answered from
 * the token alone, because it depends on the booking row. That check lives in
 * `assertOfflinePackageAccess` in the service, which is also the only place that
 * can enforce the tenant rule from Backend Guide §4. Two guards, two questions.
 */
const OFFLINE_PACKAGE_ROLES = [
  "TREKKER",
  "GUIDE",
  "STAFF",
  "AGENCY_MODERATOR",
  "AGENCY_ADMIN",
];

/**
 * GET /mobile/bookings/:id/offline-package/version
 *
 * Registered **before** the route below it. Express matches routes in
 * declaration order, and `/:id/offline-package` would not swallow this path
 * anyway — but keeping the more specific path first is the habit that stops the
 * next person from being bitten when someone adds a wildcard.
 */
router.get(
  "/bookings/:id/offline-package/version",
  requireAuth,
  requireRole(OFFLINE_PACKAGE_ROLES),
  offlinePackageVersionController
);

/**
 * GET /mobile/bookings/:id/offline-package
 * The full bundle the app writes to device storage at booking confirmation.
 */
router.get(
  "/bookings/:id/offline-package",
  requireAuth,
  requireRole(OFFLINE_PACKAGE_ROLES),
  offlinePackageController
);

export default router;

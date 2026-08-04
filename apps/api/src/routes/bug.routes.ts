import { requireAuth, requireRole } from "@funtush/auth";

import { Router } from "express";
import { requireSuperAdminRole } from "../middleware/requireSuperAdminRole.middleware";
import {
  submitBugController,
  getAgencyBugsController,
  setBugPriorityController,
  assignBugController,
  addBugHintController,
  resolveBugController,
} from "../controllers/bugReport.controller";

const router = Router();

// /agencies/me/bugs
router.post("/", requireAuth, requireRole(["AGENCY_ADMIN"]), submitBugController);
router.get("/", requireAuth, requireRole(["AGENCY_ADMIN"]), getAgencyBugsController);

// /admin/bugs/:id/priority
router.patch("/:id/priority", requireAuth, requireSuperAdminRole, setBugPriorityController);
// /admin/bugs/:id/assign
router.patch("/:id/assign", requireAuth, requireSuperAdminRole, assignBugController);
// /admin/bugs/:id/hint
router.post("/:id/hint", requireAuth, requireSuperAdminRole, addBugHintController);
// /admin/bugs/:id/resolve
router.patch("/:id/resolve", requireAuth, requireSuperAdminRole, resolveBugController);

export default router;
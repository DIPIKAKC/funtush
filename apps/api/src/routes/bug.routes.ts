import express from "express";
import { submitBugController, getAgencyBugsController } from "../controllers/bugReport.controller";
import { requireAuth, requireRole } from "@funtush/auth";

const router = express.Router();

// /agencies/me/bugs
router.post("/", requireAuth, requireRole(["AGENCY_ADMIN"]), submitBugController);
router.get("/", requireAuth, requireRole(["AGENCY_ADMIN"]), getAgencyBugsController);

export default router;
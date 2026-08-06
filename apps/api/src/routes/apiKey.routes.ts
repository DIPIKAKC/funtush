import express from "express";
import { createApiKeyController, listApiKeysController, revokeApiKeyController } from "../controllers/apiKey.controller";
import { requireAuth, requireRole } from "@funtush/auth";

const router = express.Router();

// /agencies/me/api-keys
router.post("/", requireAuth, requireRole(["AGENCY_ADMIN"]), createApiKeyController);
router.get("/", requireAuth, requireRole(["AGENCY_ADMIN"]), listApiKeysController);
router.delete("/:id", requireAuth, requireRole(["AGENCY_ADMIN"]), revokeApiKeyController);

export default router;
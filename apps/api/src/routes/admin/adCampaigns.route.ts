/**
 * Admin ad-campaign routes.
 *
 * Mount this under /admin/ad-campaigns behind requireAdmin (see admin/index.ts).
 * Lives under src/routes/admin/.
 *
 * NOTE: requireAdmin (the outer gate applied in admin/index.ts) currently
 * has a dev-only bypass and isn't fully wired (see its TEMP LOCAL BYPASS
 * comment). Since approve/reject/pause can push a real campaign live on
 * Meta and spend budget, those three routes carry their own independent
 * auth gate (requireAuth + requireSuperAdminRole) so they can't fire
 * without a verified platform-admin JWT, regardless of requireAdmin's
 * current state.
 */

import { Router, Response, Request } from "express";
import { requireAuth } from "@funtush/auth";
import { requireSuperAdminRole } from "../../middleware/requireSuperAdminRole.middleware";
import {
  getPendingCampaigns,
  getActiveCampaigns,
  approveCampaign,
  rejectCampaign,
  pauseCampaign,
  CampaignError,
} from "../../services/adCampaign.service";

const router = Router();

// GET /admin/ad-campaigns/pending — queue from Large-tier agencies
router.get("/pending", async (_req, res) => {
  try {
    const data = await getPendingCampaigns();
    res.json({ data, total: data.length });
  } catch (err) {
    handle(err, res);
  }
});

// GET /admin/ad-campaigns/active — running campaigns with impressions/clicks/spend
router.get("/active", async (_req, res) => {
  try {
    const data = await getActiveCampaigns();
    res.json({ data, total: data.length });
  } catch (err) {
    handle(err, res);
  }
});

// PATCH /admin/ad-campaigns/:id/approve — push live via Meta (Google: TODO)
router.patch(
  "/:id/approve",
  requireAuth,
  requireSuperAdminRole,
  async (req: Request<{ id: string }>, res) => {
    try {
      const campaign = await approveCampaign(req.params.id);
      res.json({ data: campaign });
    } catch (err) {
      handle(err, res);
    }
  }
);

// PATCH /admin/ad-campaigns/:id/reject — body: { reason }
router.patch(
  "/:id/reject",
  requireAuth,
  requireSuperAdminRole,
  async (req: Request<{ id: string }>, res) => {
    try {
      const { reason } = req.body;
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ error: "reason is required and must be a string" });
      }
      const campaign = await rejectCampaign(req.params.id, reason);
      res.json({ data: campaign });
    } catch (err) {
      handle(err, res);
    }
  }
);

// PATCH /admin/ad-campaigns/:id/pause — stop a running campaign immediately
router.patch(
  "/:id/pause",
  requireAuth,
  requireSuperAdminRole,
  async (req: Request<{ id: string }>, res) => {
    try {
      const campaign = await pauseCampaign(req.params.id);
      res.json({ data: campaign });
    } catch (err) {
      handle(err, res);
    }
  }
);

function handle(err: unknown, res: Response) {
  if (err instanceof CampaignError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error("[ad-campaigns]", err);
  return res.status(500).json({ error: "Internal server error" });
}

export default router;
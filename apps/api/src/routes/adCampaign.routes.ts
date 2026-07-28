import { Router } from 'express';
import { authenticateWithRefreshToken } from '../middleware/refreshTokenAuthentication';
import { checkAgencyStatus } from '../middleware/agencyAccess.middleware';
import type { AgencyRequest } from '../types/auth-request';

const router = Router();

// POST /agencies/me/ad-campaigns/generate
router.post(
  '/generate',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { generateAdCampaign } = await import('../services/adCampaignService');
      const result = await generateAdCampaign(agencyId);

      res.status(201).json({
        success: true,
        message: 'Ad campaign created with 3 creative variations',
        data: result,
      });
    } catch (err) {
      console.error('Ad campaign generation error:', err);
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to generate campaign',
      });
    }
  }
);

// GET /agencies/me/ad-campaigns
router.get(
  '/',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { getCampaigns } = await import('../services/adCampaignService');
      const campaigns = await getCampaigns(agencyId);

      res.json({
        success: true,
        data: campaigns,
      });
    } catch (err) {
      console.error('Failed to fetch campaigns:', err);
      res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
  }
);

// GET /agencies/me/ad-campaigns/:id
router.get(
  '/:id',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { id } = req.params as { id: string }; 
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { getCampaign } = await import('../services/adCampaignService');
      const campaign = await getCampaign(id, agencyId);

      res.json({
        success: true,
        data: campaign,
      });
    } catch (err) {
      console.error('Failed to fetch campaign:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to fetch campaign',
      });
    }
  }
);

// POST /agencies/me/ad-campaigns/:id/targeting
router.post(
  '/:id/targeting',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { id } = req.params as { id: string };
      const agencyId = req.agencyId;
      const targetingParams = req.body;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { updateTargetingParams } = await import(
        '../services/targetingBuilderService'
      );
      const updated = await updateTargetingParams(id, agencyId, targetingParams);

      res.json({
        success: true,
        message: 'Targeting parameters updated',
        data: updated,
      });
    } catch (err) {
      console.error('Targeting update error:', err);
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to update targeting',
      });
    }
  }
);

// POST /agencies/me/ad-campaigns/:id/submit
router.post(
  '/:id/submit',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { id } = req.params as { id: string };
      const agencyId = req.agencyId;

      if (!agencyId) {
        return res.status(401).json({ error: 'Agency not found' });
      }

      const { submitCampaignForApproval } = await import(
        '../services/targetingBuilderService'
      );
      const submitted = await submitCampaignForApproval(id, agencyId);

      res.json({
        success: true,
        message: 'Campaign submitted for admin review',
        data: submitted,
      });
    } catch (err) {
      console.error('Campaign submission error:', err);
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to submit campaign',
      });
    }
  }
);

// GET /agencies/me/ad-campaigns/targeting/options
router.get(
  '/targeting/options',
  authenticateWithRefreshToken,
  checkAgencyStatus,
  async (req: AgencyRequest, res) => {
    try {
      const { getTargetingOptions } = await import(
        '../services/targetingBuilderService'
      );
      const options = await getTargetingOptions();

      res.json({
        success: true,
        data: options,
      });
    } catch (err) {
      console.error('Failed to fetch targeting options:', err);
      res.status(500).json({ error: 'Failed to fetch targeting options' });
    }
  }
);

export default router;
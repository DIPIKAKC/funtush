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

export default router;
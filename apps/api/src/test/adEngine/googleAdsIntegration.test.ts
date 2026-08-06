import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db, Prisma } from '@funtush/database';
import {
  approveCampaign,
  rejectCampaign,
  pauseCampaign,
  CampaignError,
} from '../../services/adCampaign.service';
import { syncAndGetCampaignPerformance } from '../../services/adPerformanceService';

// approve/reject/pause/performance logic, not real Meta/Google API calls.
vi.mock('../../lib/adPlatforms', () => ({
  pushCampaignLive: vi.fn(),
  pausePlatformCampaign: vi.fn(async () => { }),
  fetchCampaignMetrics: vi.fn(),
}));

// Mock notifications so approve/reject don't try to send real emails/SMS.
vi.mock('../../services/notificationService', () => ({
  notificationService: {
    sendEmailNotification: vi.fn(async () => ({ success: true })),
    sendNotification: vi.fn(async () => ({ success: true, method: 'sms' })),
  },
}));

import { pushCampaignLive, fetchCampaignMetrics } from '../../lib/adPlatforms';

describe('DAY 4: Google Ads Integration & Performance Sync', () => {
  const mockAgencyId = 'agency_googleads_' + Date.now();
  const mockTierId = 'tier_googleads_' + Date.now();

  async function createPendingCampaign(overrides: Partial<Prisma.AdCampaignUncheckedCreateInput> = {}) {
    return db.adCampaign.create({
      data: {
        agencyId: mockAgencyId,
        status: 'PENDING_APPROVAL',
        imageUrls: ['https://example.com/img.jpg'],
        copyText: 'Trek Nepal with us',
        targetingParams: {},
        dailyBudgetCents: 1500,
        ...overrides,
      },
    });
  }

  beforeAll(async () => {
    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'GoogleAds Test ' + Date.now(),
        maxStaff: 10,
        maxGuides: 5,
        monthlyPrice: 2000,
        features: JSON.stringify(['ads']),
      },
    });

    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'GoogleAds Test Agency',
        email: 'googleads_' + Date.now() + '@test.com',
        slug: 'googleads-test-' + Date.now(),
        tierId: mockTierId,
      },
    });
  });

  afterAll(async () => {
    await db.adPerformanceDaily.deleteMany({
      where: { campaign: { agencyId: mockAgencyId } },
    });
    await db.adCampaign.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.agency.deleteMany({ where: { id: mockAgencyId } });
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
  });

  describe('approveCampaign — Google push-live', () => {
    it('stores both metaCampaignId and googleCampaignId when both platforms succeed', async () => {
      vi.mocked(pushCampaignLive).mockResolvedValueOnce({
        metaCampaignId: 'meta_123',
        googleCampaignId: 'google_456',
        googleSearchCampaignId: null,
      });

      const campaign = await createPendingCampaign();
      const approved = await approveCampaign(campaign.id);

      expect(approved.status).toBe('ACTIVE');
      expect(approved.metaCampaignId).toBe('meta_123');
      expect(approved.googleCampaignId).toBe('google_456');
      expect(approved.approvedAt).not.toBeNull();
    });

    it('still approves and goes live on Meta even if Google push-live returns null (not configured/failed)', async () => {
      vi.mocked(pushCampaignLive).mockResolvedValueOnce({
        metaCampaignId: 'meta_789',
        googleCampaignId: null,
        googleSearchCampaignId: null,
      });

      const campaign = await createPendingCampaign();
      const approved = await approveCampaign(campaign.id);

      expect(approved.status).toBe('ACTIVE');
      expect(approved.metaCampaignId).toBe('meta_789');
      expect(approved.googleCampaignId).toBeNull();
    });

    it('leaves the campaign in PENDING_APPROVAL if the platform push throws', async () => {
      vi.mocked(pushCampaignLive).mockRejectedValueOnce(
        new Error('Meta API error: something went wrong')
      );

      const campaign = await createPendingCampaign();

      await expect(approveCampaign(campaign.id)).rejects.toThrow(CampaignError);

      const unchanged = await db.adCampaign.findUnique({ where: { id: campaign.id } });
      expect(unchanged?.status).toBe('PENDING_APPROVAL');
      expect(unchanged?.metaCampaignId).toBeNull();
    });

    it('rejects approving a campaign that is not PENDING_APPROVAL', async () => {
      const campaign = await createPendingCampaign({ status: 'ACTIVE' });

      await expect(approveCampaign(campaign.id)).rejects.toThrow(CampaignError);
    });
  });

  describe('rejectCampaign', () => {
    it('requires a rejection reason', async () => {
      const campaign = await createPendingCampaign();

      await expect(rejectCampaign(campaign.id, '')).rejects.toThrow(
        'Rejection reason is required'
      );
    });

    it('rejects with a reason and stores it', async () => {
      const campaign = await createPendingCampaign();

      const rejected = await rejectCampaign(campaign.id, 'Creative does not meet quality guidelines');

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Creative does not meet quality guidelines');
      expect(rejected.rejectedAt).not.toBeNull();
    });
  });

  describe('pauseCampaign', () => {
    it('rejects pausing a campaign that is not ACTIVE', async () => {
      const campaign = await createPendingCampaign(); // still PENDING_APPROVAL

      await expect(pauseCampaign(campaign.id)).rejects.toThrow(CampaignError);
    });

    it('pauses an ACTIVE campaign on both platforms', async () => {
      const campaign = await createPendingCampaign({
        status: 'ACTIVE',
        metaCampaignId: 'meta_active_1',
        googleCampaignId: 'google_active_1',
      });

      const paused = await pauseCampaign(campaign.id);

      expect(paused.status).toBe('PAUSED');
      expect(paused.pausedAt).not.toBeNull();
    });
  });

  describe('syncAndGetCampaignPerformance', () => {
    it('rejects fetching performance for another agency\'s campaign', async () => {
      const campaign = await createPendingCampaign({
        status: 'ACTIVE',
        metaCampaignId: 'meta_perf_1',
      });

      await expect(
        syncAndGetCampaignPerformance(campaign.id, 'someone-elses-agency-id')
      ).rejects.toThrow('Campaign not found or unauthorized');
    });

    it('upserts a per-platform AdPerformanceDaily row and returns aggregated totals', async () => {
      vi.mocked(fetchCampaignMetrics).mockResolvedValueOnce({
        meta: { impressions: 1000, clicks: 40, spend: 12.5 },
        google: { impressions: 600, clicks: 15, spend: 8.25 },
      });

      const campaign = await createPendingCampaign({
        status: 'ACTIVE',
        metaCampaignId: 'meta_perf_2',
        googleCampaignId: 'google_perf_2',
      });

      const result = await syncAndGetCampaignPerformance(campaign.id, mockAgencyId);

      expect(result.totals.impressions).toBe(1600);
      expect(result.totals.clicks).toBe(55);
      expect(result.totals.spend).toBeCloseTo(20.75);

      expect(result.byPlatform.META.impressions).toBe(1000);
      expect(result.byPlatform.GOOGLE.impressions).toBe(600);

      const rows = await db.adPerformanceDaily.findMany({ where: { campaignId: campaign.id } });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.platform).sort()).toEqual(['GOOGLE', 'META']);
    });

    it('re-syncing the same day updates rather than duplicates the row', async () => {
      vi.mocked(fetchCampaignMetrics).mockResolvedValueOnce({
        meta: { impressions: 100, clicks: 5, spend: 2 },
        google: { impressions: 0, clicks: 0, spend: 0 },
      });

      const campaign = await createPendingCampaign({
        status: 'ACTIVE',
        metaCampaignId: 'meta_perf_3',
      });

      await syncAndGetCampaignPerformance(campaign.id, mockAgencyId);

      vi.mocked(fetchCampaignMetrics).mockResolvedValueOnce({
        meta: { impressions: 250, clicks: 12, spend: 5.5 },
        google: { impressions: 0, clicks: 0, spend: 0 },
      });

      const secondResult = await syncAndGetCampaignPerformance(campaign.id, mockAgencyId);

      const rows = await db.adPerformanceDaily.findMany({ where: { campaignId: campaign.id } });
      expect(rows).toHaveLength(1); // same day -> updated, not duplicated
      expect(rows[0].impressions).toBe(250);
      expect(secondResult.totals.impressions).toBe(250);
    });

    it('does not call fetchCampaignMetrics for a campaign with no platform IDs yet', async () => {
      vi.mocked(fetchCampaignMetrics).mockClear();

      const campaign = await createPendingCampaign(); // no metaCampaignId/googleCampaignId

      const result = await syncAndGetCampaignPerformance(campaign.id, mockAgencyId);

      expect(fetchCampaignMetrics).not.toHaveBeenCalled();
      expect(result.totals).toEqual({ impressions: 0, clicks: 0, spend: 0 });
    });
  });
});
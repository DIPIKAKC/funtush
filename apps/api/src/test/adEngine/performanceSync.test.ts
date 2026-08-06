import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '@funtush/database';
import { syncAndGetCampaignPerformance } from '../../services/adPerformanceService';

vi.mock('../../lib/adPlatforms', () => ({
  fetchCampaignMetrics: vi.fn(async () => ({
    meta: { impressions: 100, clicks: 5, spend: 50 },
    google: { impressions: 80, clicks: 4, spend: 40 },
  })),
}));

describe('Performance Sync (DAY 4)', () => {
  const mockAgencyId = 'agency_perf_' + Date.now();
  const mockTierId = 'tier_perf_' + Date.now();
  let campaignId: string;

  beforeAll(async () => {
    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'Perf Test',
        maxStaff: 10,
        maxGuides: 5,
        monthlyPrice: 2000,
        features: JSON.stringify(['ads']),
      },
    });

    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'Perf Test Agency',
        email: 'perf_' + Date.now() + '@test.com',
        slug: 'perf-test-' + Date.now(),
        tierId: mockTierId,
      },
    });

    const campaign = await db.adCampaign.create({
      data: {
        agencyId: mockAgencyId,
        status: 'ACTIVE',
        imageUrls: ['https://example.com/img.jpg'],
        copyText: 'Test',
        targetingParams: {},
        dailyBudgetCents: 5000,
        metaCampaignId: 'meta_123',
        googleCampaignId: 'google_456',
      },
    });
    campaignId = campaign.id;
  });

  afterAll(async () => {
    await db.adPerformanceDaily.deleteMany({ where: { campaignId } });
    await db.adCampaign.deleteMany({ where: { id: campaignId } });
    await db.agency.deleteMany({ where: { id: mockAgencyId } });
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
  });

  it('should sync performance data from Meta and Google', async () => {
    await syncAndGetCampaignPerformance(campaignId, mockAgencyId);

    const metaRow = await db.adPerformanceDaily.findFirst({
      where: { campaignId, platform: 'META' },
    });
    const googleRow = await db.adPerformanceDaily.findFirst({
      where: { campaignId, platform: 'GOOGLE' },
    });

    expect(metaRow).toBeTruthy();
    expect(metaRow?.impressions).toBe(100);
    expect(metaRow?.clicks).toBe(5);

    expect(googleRow).toBeTruthy();
    expect(googleRow?.impressions).toBe(80);
  });

  it('should upsert on duplicate date (one row per platform per day)', async () => {
    await syncAndGetCampaignPerformance(campaignId, mockAgencyId);
    await syncAndGetCampaignPerformance(campaignId, mockAgencyId);

    const count = await db.adPerformanceDaily.count({ where: { campaignId } });

    expect(count).toBe(2); 
  });
});
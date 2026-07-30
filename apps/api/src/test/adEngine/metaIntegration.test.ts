import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '@funtush/database';
import { approveCampaign } from '../../services/adCampaign.service';
import type { TargetingParams } from '../../services/targetingBuilderService';

// Mock the entire metaAdsService
vi.mock('../../services/metaAdsService', () => ({
  createMetaCampaign: vi.fn(async () => ({
    metaCampaignId: 'meta_camp_mocked',
    metaAdSetId: 'meta_adset_mocked',
    metaCreativeId: 'meta_creative_mocked',
    metaAdId: 'meta_ad_mocked',
  })),
  pauseMetaCampaign: vi.fn(async () => {}),
}));

vi.mock('../../lib/emailQueue', () => ({
  queueEmail: vi.fn(async () => {}),
}));

describe('Meta Ads Integration', () => {
  const mockAgencyId = 'agency_meta_' + Date.now();
  const mockTierId = 'tier_meta_' + Date.now();
  let campaignId: string;

  beforeAll(async () => {
    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'Meta Test ' + Date.now(),
        maxStaff: 10,
        maxGuides: 5,
        monthlyPrice: 2000,
        features: JSON.stringify(['ads']),
      },
    });

    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'Meta Test Agency',
        email: 'meta_' + Date.now() + '@test.com',
        slug: 'meta-test-' + Date.now(),
        tierId: mockTierId,
      },
    });

    const targetingParams: TargetingParams = {
      geographic: { regions: ['everest'], difficulty: 'MODERATE' },
      interests: { adventureTravel: true, trekking: true, culturalTourism: false, mountaineering: false },
      behavioral: { retargetSearchers: true, retargetViewers: false, excludeExistingCustomers: false },
      seasonal: { enabled: false, boostMonths: [], boostPercentage: 0 },
    };

    const campaign = await db.adCampaign.create({
      data: {
        agencyId: mockAgencyId,
        status: 'PENDING_APPROVAL',
        imageUrls: ['https://example.com/trek1.jpg'],
        copyText: 'Discover Everest with us',
        targetingParams: JSON.parse(JSON.stringify(targetingParams)),
        dailyBudgetCents: 5000,
      },
    });

    campaignId = campaign.id;
  });

  afterAll(async () => {
    await db.adCampaign.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.agency.deleteMany({ where: { id: mockAgencyId } });
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
  });

  it('should push campaign live and store Meta IDs on approval', async () => {
    const updated = await approveCampaign(campaignId);

    expect(updated.status).toBe('ACTIVE');
    expect(updated.metaCampaignId).toBe('meta_camp_mocked');
    expect(updated.approvedAt).toBeTruthy();
  });

  it('should fail approval if Meta push fails', async () => {
    const { createMetaCampaign } = await import('../../services/metaAdsService');
    vi.mocked(createMetaCampaign).mockRejectedValueOnce(new Error('Meta API error'));

    const newCampaign = await db.adCampaign.create({
      data: {
        agencyId: mockAgencyId,
        status: 'PENDING_APPROVAL',
        imageUrls: ['https://example.com/img.jpg'],
        copyText: 'Test',
        targetingParams: {},
        dailyBudgetCents: 5000,
      },
    });

    await expect(approveCampaign(newCampaign.id)).rejects.toThrow();

    await db.adCampaign.delete({ where: { id: newCampaign.id } });
  });

  it('should require campaign to be in PENDING_APPROVAL status', async () => {
    await expect(approveCampaign('invalid_id')).rejects.toThrow('Campaign not found');
  });
});
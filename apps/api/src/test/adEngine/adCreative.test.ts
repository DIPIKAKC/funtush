import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@funtush/database';
import { generateAdCampaign } from '../../services/adCampaignService';
import { generateCreativeVariations } from '../../utils/creativeGenerator';

describe('Ad Creative Generation', () => {
  const mockAgencyId = 'agency_ads_' + Date.now();
  const mockTierId = 'tier_ads_' + Date.now();

  beforeAll(async () => {
    // Create subscription tier
    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'Ads Test Tier ' + Date.now(),
        maxStaff: 10,
        maxGuides: 5,
        monthlyPrice: 2000,
        features: JSON.stringify(['ads_feature']),
      },
    });

    // Create agency
    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'Ads Test Agency',
        email: 'ads_' + Date.now() + '@test.com',
        slug: 'ads-test-' + Date.now(),
        tierId: mockTierId,
      },
    });

    // Create agency profile with logo
    await db.agencyProfile.create({
      data: {
        agencyId: mockAgencyId,
        logo: 'https://example.com/logo.png',
        description: 'Professional trekking agency',
      },
    });

    // Create test packages with itineraries
    for (let i = 1; i <= 3; i++) {
      const pkg = await db.trekPackage.create({
        data: {
          agencyId: mockAgencyId,
          title: `Test Trek ${i}`,
          slug: `test-trek-${i}-${Date.now()}`,
          description: `This is a test trek number ${i}`,
          durationDays: 5 + i,
          pricePerPerson: 1000 + i * 100,
          difficulty: i === 1 ? 'EASY' : i === 2 ? 'MODERATE' : 'CHALLENGING',
          maxGroupSize: 10,
          status: 'PUBLISHED',
        },
      });

      // Add itineraries with photos
      for (let day = 1; day <= 3; day++) {
        await db.trekItinerary.create({
          data: {
            packageId: pkg.id,
            dayNumber: day,
            location: `Location ${day}`,
            description: `Day ${day} description`,
            photos: [
              `https://example.com/photo-${i}-${day}-1.jpg`,
              `https://example.com/photo-${i}-${day}-2.jpg`,
            ],
          },
        });
      }
    }
  });

  afterAll(async () => {
    await db.adCampaign.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.trekItinerary.deleteMany({
      where: { package: { agencyId: mockAgencyId } },
    });
    await db.trekPackage.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.agencyProfile.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.agency.deleteMany({ where: { id: mockAgencyId } }); // DELETE FIRST
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } }); // THEN TIERS
  });

  interface CreativeVariation {
    variant: number;
    title: string;
    copyText: string;
    imageUrls: string[];
  }

  describe('Creative Generation', () => {
    it('should generate 3 creative variations from package data', async () => {
      const result = await generateAdCampaign(mockAgencyId);

      const creatives = (result.targetingParams as Record<string, unknown>)
        .creativeVariations as CreativeVariation[];
      expect(creatives).toHaveLength(3);
      creatives.forEach((creative, idx) => {
        expect(creative.variant).toBe(idx + 1);
        expect(creative.title).toBeTruthy();
        expect(creative.copyText).toBeTruthy();
        expect(Array.isArray(creative.imageUrls)).toBe(true);
      });
    });

    it('should use agency logo and name in creatives', async () => {
      const result = await generateAdCampaign(mockAgencyId);

      const creatives = (result.targetingParams as Record<string, unknown>)
        .creativeVariations as CreativeVariation[];
      const fullCopy = creatives.map((c) => c.copyText).join(' ');
      expect(fullCopy).toContain('Ads Test Agency');
    });

    it('should include package photos in imageUrls', async () => {
      const result = await generateAdCampaign(mockAgencyId);

      const creatives = (result.targetingParams as Record<string, unknown>)
        .creativeVariations as CreativeVariation[];
      const allImages = creatives.flatMap((c) => c.imageUrls);
      expect(allImages.length).toBeGreaterThan(0);
      allImages.forEach((img: string) => {
        expect(img).toContain('https://example.com/photo');
      });
    });

    it('should vary creative copy by tone', () => {
      const testData = {
        agencyLogo: 'https://example.com/logo.png',
        agencyName: 'Test Agency',
        packages: [
          {
            title: 'Everest Base Camp',
            description: 'Trek to the base of Mt. Everest',
            difficulty: 'CHALLENGING',
            durationDays: 14,
            pricePerPerson: 1500,
            photos: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
          },
        ],
      };

      const creatives = generateCreativeVariations(testData);

      expect(creatives[0].copyText).toContain('thrill');
      expect(creatives[1].copyText).toContain('$');
      expect(creatives[2].copyText).toContain('expert');
    });

    it('should create campaign in DRAFT status', async () => {
      const result = await generateAdCampaign(mockAgencyId);

      const campaign = await db.adCampaign.findUnique({
        where: { id: result.id },
      });

      expect(campaign?.status).toBe('PENDING_APPROVAL');
      expect(campaign?.agencyId).toBe(mockAgencyId);
    });

    it('should store targeting params with creative variants', async () => {
      const result = await generateAdCampaign(mockAgencyId);

      const campaign = await db.adCampaign.findUnique({
        where: { id: result.id },
      });

      const targeting = campaign?.targetingParams as Record<string, unknown>;
      expect(targeting.creativeVariations as CreativeVariation[]).toHaveLength(3);
      expect(targeting.packageIds).toBeTruthy();
    });

    it('should fail if no published packages exist', async () => {
      const noPackageAgencyId = 'no_pkg_' + Date.now();

      await db.agency.create({
        data: {
          id: noPackageAgencyId,
          name: 'No Packages Agency',
          email: 'nopkg_' + Date.now() + '@test.com',
          slug: 'no-pkg-' + Date.now(),
          tierId: mockTierId,
        },
      });

      await expect(generateAdCampaign(noPackageAgencyId)).rejects.toThrow(
        'No published packages found'
      );

      await db.agency.delete({ where: { id: noPackageAgencyId } });
    });
  });

  describe('Campaign Creation', () => {
    it('should store all creative data in campaign', async () => {
      const campaign = await generateAdCampaign(mockAgencyId);

      const stored = await db.adCampaign.findUnique({
        where: { id: campaign.id },
      });

      expect(stored?.imageUrls.length).toBeGreaterThan(0);
      expect(stored?.copyText).toBeTruthy();
      expect(stored?.targetingParams).toBeTruthy();
    });

    it('should include creative variants in targetingParams', async () => {
      const campaign = await generateAdCampaign(mockAgencyId);

      const stored = await db.adCampaign.findUnique({
        where: { id: campaign.id },
      });

      const targeting = stored?.targetingParams as Record<string, unknown>;
      const creativeVariations = targeting.creativeVariations as Array<Record<string, unknown>>;
      expect(creativeVariations).toHaveLength(3);
      creativeVariations.forEach((cv) => {
        expect(cv.variant).toBeTruthy();
        expect(cv.title).toBeTruthy();
        expect(cv.copyText).toBeTruthy();
      });
    });
  });
});
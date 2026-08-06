import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db, Prisma } from '@funtush/database';

import {
  updateTargetingParams,
  submitCampaignForApproval,
  getTargetingOptions,
  type TargetingParams,
} from '../../services/targetingBuilderService';

// Mock notification service — path + shape must match the real module
vi.mock('../../services/notificationService', () => ({
  notificationService: {
    sendNotificationToAdmins: vi.fn(async () => ({ success: true })),
  },
}));

describe('Targeting Parameters & Admin Review', () => {
  const mockAgencyId = 'agency_targeting_' + Date.now();
  const mockTierId = 'tier_targeting_' + Date.now();
  let campaignId: string;
  let destinationId: string;

  beforeAll(async () => {
    // Setup subscription tier
    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'Targeting Test ' + Date.now(),
        maxStaff: 10,
        maxGuides: 5,
        monthlyPrice: 2000,
        features: JSON.stringify(['ads']),
      },
    });

    // Setup agency
    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'Targeting Test Agency',
        email: 'targeting_' + Date.now() + '@test.com',
        slug: 'targeting-test-' + Date.now(),
        tierId: mockTierId,
      },
    });

    // Setup agency profile
    await db.agencyProfile.create({
      data: {
        agencyId: mockAgencyId,
        logo: 'https://example.com/logo.png',
      },
    });

    // Create destination for targeting options
    // Create destination for targeting options
    const destination = await db.trekDestination.create({
      data: {
        id: 'dest_testing_' + Date.now(),
        agencyId: mockAgencyId,
        name: 'Test Destination',
        region: 'Everest Region',
        altitudeM: 5364,
        bestSeason: 'Spring',
      },
    });

    destinationId = destination.id;

    destinationId = destination.id;

    // Create test packages
    await db.trekPackage.create({
      data: {
        agencyId: mockAgencyId,
        title: 'Test Trek',
        slug: 'test-trek-' + Date.now(),
        durationDays: 5,
        pricePerPerson: 1000,
        difficulty: 'MODERATE',
        maxGroupSize: 10,
        status: 'PUBLISHED',
      },
    });

    // Create campaign
    const campaign = await db.adCampaign.create({
      data: {
        agencyId: mockAgencyId,
        status: 'PENDING',
        imageUrls: ['https://example.com/img.jpg'],
        copyText: 'Test ad copy',
        targetingParams: {},
      },
    });

    campaignId = campaign.id;
  });

  afterAll(async () => {
    await db.adCampaign.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.trekPackage.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.trekDestination.deleteMany({ where: { id: destinationId } });
    await db.agencyProfile.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.agency.deleteMany({ where: { id: mockAgencyId } });
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
  });

  describe('Targeting Builder', () => {
    it('should get available targeting options', async () => {
      const options = await getTargetingOptions();

      expect(options).toHaveProperty('regions');
      expect(options).toHaveProperty('difficulties');
      expect(options).toHaveProperty('interests');
      expect(Array.isArray(options.regions)).toBe(true);
      expect(Array.isArray(options.difficulties)).toBe(true);
      expect(Array.isArray(options.interests)).toBe(true);
    });

    it('should update targeting params', async () => {
      const targetingParams: TargetingParams = {
        geographic: {
          regions: [destinationId],
          difficulty: 'MODERATE',
        },
        interests: {
          adventureTravel: true,
          trekking: true,
          culturalTourism: false,
          mountaineering: false,
        },
        behavioral: {
          retargetSearchers: true,
          retargetViewers: false,
          excludeExistingCustomers: false,
        },
        seasonal: {
          enabled: true,
          boostMonths: [5, 6, 7, 8, 9], // May-September
          boostPercentage: 25,
        },
      };

      const updated = await updateTargetingParams(
        campaignId,
        mockAgencyId,
        targetingParams
      );

      expect(updated.status).toBe('PENDING');
      expect(updated.targetingParams).toEqual(targetingParams);
    });

    it('should validate geographic targeting', async () => {
      const invalidParams: TargetingParams = {
        geographic: {
          regions: [], // Empty regions
          difficulty: 'MODERATE',
        },
        interests: {
          adventureTravel: true,
          trekking: false,
          culturalTourism: false,
          mountaineering: false,
        },
        behavioral: {
          retargetSearchers: false,
          retargetViewers: false,
          excludeExistingCustomers: false,
        },
        seasonal: {
          enabled: false,
          boostMonths: [],
          boostPercentage: 0,
        },
      };

      await expect(
        updateTargetingParams(campaignId, mockAgencyId, invalidParams)
      ).rejects.toThrow('At least one region must be selected');
    });

    it('should validate interests targeting', async () => {
      const noInterestParams: TargetingParams = {
        geographic: {
          regions: [destinationId],
          difficulty: 'EASY',
        },
        interests: {
          adventureTravel: false,
          trekking: false,
          culturalTourism: false,
          mountaineering: false,
        },
        behavioral: {
          retargetSearchers: false,
          retargetViewers: false,
          excludeExistingCustomers: false,
        },
        seasonal: {
          enabled: false,
          boostMonths: [],
          boostPercentage: 0,
        },
      };

      await expect(
        updateTargetingParams(campaignId, mockAgencyId, noInterestParams)
      ).rejects.toThrow('At least one interest must be selected');
    });

    it('should validate seasonal boost percentage', async () => {
      const invalidSeasonalParams: TargetingParams = {
        geographic: {
          regions: [destinationId],
          difficulty: 'MODERATE',
        },
        interests: {
          adventureTravel: true,
          trekking: false,
          culturalTourism: false,
          mountaineering: false,
        },
        behavioral: {
          retargetSearchers: false,
          retargetViewers: false,
          excludeExistingCustomers: false,
        },
        seasonal: {
          enabled: true,
          boostMonths: [5, 6],
          boostPercentage: 100, // Invalid: should be 10-50
        },
      };

      await expect(
        updateTargetingParams(campaignId, mockAgencyId, invalidSeasonalParams)
      ).rejects.toThrow('Boost percentage must be between 10-50%');
    });

    it('should support behavioral retargeting', async () => {
      const behavioralParams: TargetingParams = {
        geographic: {
          regions: [destinationId],
          difficulty: 'CHALLENGING',
        },
        interests: {
          adventureTravel: false,
          trekking: true,
          culturalTourism: false,
          mountaineering: true,
        },
        behavioral: {
          retargetSearchers: true, // Marketplace searchers
          retargetViewers: true, // Package viewers
          excludeExistingCustomers: true,
        },
        seasonal: {
          enabled: false,
          boostMonths: [],
          boostPercentage: 0,
        },
      };

      const updated = await updateTargetingParams(
        campaignId,
        mockAgencyId,
        behavioralParams
      );

      expect(updated.targetingParams).toEqual(behavioralParams);
    });
  });

  describe('Campaign Submission', () => {
    it('should submit campaign for admin approval', async () => {
      // First set targeting params
      const targetingParams: TargetingParams = {
        geographic: {
          regions: [destinationId],
          difficulty: 'MODERATE',
        },
        interests: {
          adventureTravel: true,
          trekking: true,
          culturalTourism: false,
          mountaineering: false,
        },
        behavioral: {
          retargetSearchers: true,
          retargetViewers: false,
          excludeExistingCustomers: false,
        },
        seasonal: {
          enabled: false,
          boostMonths: [],
          boostPercentage: 0,
        },
      };

      await updateTargetingParams(campaignId, mockAgencyId, targetingParams);

      // Submit for approval
      const submitted = await submitCampaignForApproval(campaignId, mockAgencyId);

      expect(submitted.status).toBe('PENDING_APPROVAL');
    });

    it('should fail submission if no targeting params set', async () => {
      // Create new campaign without targeting params
      const newCampaign = await db.adCampaign.create({
        data: {
          agencyId: mockAgencyId,
          status: 'PENDING',
          imageUrls: ['https://example.com/img.jpg'],
          copyText: 'Test ad copy',
          targetingParams: {}, // Empty targeting params
        },
      });

      await expect(
        submitCampaignForApproval(newCampaign.id, mockAgencyId)
      ).rejects.toThrow('Campaign must have targeting parameters');

      // Cleanup
      await db.adCampaign.delete({ where: { id: newCampaign.id } });
    });

    it('should prevent submission of already-approved campaign', async () => {
      // Create campaign and manually set to APPROVED (simulate already approved)
      const approvedCampaign = await db.adCampaign.create({
        data: {
          agencyId: mockAgencyId,
          status: 'APPROVED',
          imageUrls: ['https://example.com/img.jpg'],
          copyText: 'Test ad copy',
          targetingParams: { regions: [destinationId] } as unknown as Prisma.InputJsonValue,
        },
      });

      await expect(
        submitCampaignForApproval(approvedCampaign.id, mockAgencyId)
      ).rejects.toThrow('Can only submit PENDING campaigns');

      // Cleanup
      await db.adCampaign.delete({ where: { id: approvedCampaign.id } });
    });

    it('should notify admins on submission', async () => {
      const { notificationService } = await import(
        '../../services/notificationService'
      );

      const targetingParams: TargetingParams = {
        geographic: {
          regions: [destinationId],
          difficulty: 'EASY',
        },
        interests: {
          adventureTravel: true,
          trekking: false,
          culturalTourism: false,
          mountaineering: false,
        },
        behavioral: {
          retargetSearchers: false,
          retargetViewers: false,
          excludeExistingCustomers: false,
        },
        seasonal: {
          enabled: false,
          boostMonths: [],
          boostPercentage: 0,
        },
      };

      const newCampaign = await db.adCampaign.create({
        data: {
          agencyId: mockAgencyId,
          status: 'PENDING',
          imageUrls: ['https://example.com/img.jpg'],
          copyText: 'Test ad copy',
          targetingParams: targetingParams as unknown as Prisma.InputJsonValue,
        },
      });

      await submitCampaignForApproval(newCampaign.id, mockAgencyId);

      expect(notificationService.sendNotificationToAdmins).toHaveBeenCalled();

      // Cleanup
      await db.adCampaign.delete({ where: { id: newCampaign.id } });
    });
  });

  describe('Authorization', () => {
    it('should prevent other agencies from updating campaigns', async () => {
      const otherAgencyId = 'other_agency_' + Date.now();

      await db.agency.create({
        data: {
          id: otherAgencyId,
          name: 'Other Agency',
          email: 'other_' + Date.now() + '@test.com',
          slug: 'other-' + Date.now(),
          tierId: mockTierId,
        },
      });

      const targetingParams: TargetingParams = {
        geographic: {
          regions: [destinationId],
          difficulty: 'MODERATE',
        },
        interests: {
          adventureTravel: true,
          trekking: false,
          culturalTourism: false,
          mountaineering: false,
        },
        behavioral: {
          retargetSearchers: false,
          retargetViewers: false,
          excludeExistingCustomers: false,
        },
        seasonal: {
          enabled: false,
          boostMonths: [],
          boostPercentage: 0,
        },
      };

      await expect(
        updateTargetingParams(campaignId, otherAgencyId, targetingParams)
      ).rejects.toThrow('Campaign not found or unauthorized');

      await db.agency.delete({ where: { id: otherAgencyId } });
    });
  });
});
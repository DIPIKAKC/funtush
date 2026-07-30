import { db, Prisma } from '@funtush/database';

export interface TargetingParams {
  geographic: {
    regions: string[]; 
    difficulty: 'EASY' | 'MODERATE' | 'CHALLENGING' | 'DIFFICULT' | 'ALL';
  };
  interests: {
    adventureTravel: boolean;
    trekking: boolean;
    culturalTourism: boolean;
    mountaineering: boolean;
  };
  behavioral: {
    retargetSearchers: boolean; 
    retargetViewers: boolean; 
    excludeExistingCustomers: boolean;
  };
  seasonal: {
    enabled: boolean;
    boostMonths: number[]; // 1-12 (peak season months)
    boostPercentage: number; 
  };
}

export async function updateTargetingParams(
  campaignId: string,
  agencyId: string,
  targetingParams: TargetingParams
) {
  // Verify campaign ownership
  const campaign = await db.adCampaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign || campaign.agencyId !== agencyId) {
    throw new Error('Campaign not found or unauthorized');
  }

  if (campaign.status !== 'PENDING') {
    throw new Error('Can only edit targeting params for PENDING campaigns');
  }

  // Validate targeting params
  validateTargetingParams(targetingParams);

  // Update campaign
const updated = await db.adCampaign.update({
    where: { id: campaignId },
    data: {
      targetingParams: targetingParams as unknown as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });

  return updated;
}

export async function submitCampaignForApproval(
  campaignId: string,
  agencyId: string
) {
  // Get campaign
  const campaign = await db.adCampaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign || campaign.agencyId !== agencyId) {
    throw new Error('Campaign not found or unauthorized');
  }

  if (campaign.status !== 'PENDING') {
    throw new Error('Can only submit PENDING campaigns');
  }

  // Validate campaign has targeting params
  if (!campaign.targetingParams || Object.keys(campaign.targetingParams).length === 0) {
    throw new Error('Campaign must have targeting parameters before submission');
  }

  // Update status to PENDING_APPROVAL
  const updated = await db.adCampaign.update({
    where: { id: campaignId },
    data: {
      status: 'PENDING_APPROVAL',
      updatedAt: new Date(),
    },
  });

  // Get agency for notification
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
  });

  if (!agency) {
    throw new Error('Agency not found');
  }

  // Trigger admin notification
  await notifyAdminForReview(campaign.id, agency.name);

  return updated;
}

function validateTargetingParams(params: TargetingParams): void {
  // Validate geographic
  if (!params.geographic) {
    throw new Error('Geographic targeting required');
  }

  if (!Array.isArray(params.geographic.regions) || params.geographic.regions.length === 0) {
    throw new Error('At least one region must be selected');
  }

  // Validate interests
  if (!params.interests) {
    throw new Error('Interests targeting required');
  }

  const hasAnyInterest = Object.values(params.interests).some((v) => v === true);
  if (!hasAnyInterest) {
    throw new Error('At least one interest must be selected');
  }

  // Validate behavioral
  if (!params.behavioral) {
    throw new Error('Behavioral targeting required');
  }

  // Validate seasonal
  if (params.seasonal?.enabled) {
    if (!Array.isArray(params.seasonal.boostMonths) || params.seasonal.boostMonths.length === 0) {
      throw new Error('Boost months must be specified when seasonal boost is enabled');
    }

    if (params.seasonal.boostPercentage < 10 || params.seasonal.boostPercentage > 50) {
      throw new Error('Boost percentage must be between 10-50%');
    }
  }
}

async function notifyAdminForReview(campaignId: string, agencyName: string): Promise<void> {
  try {
    const { notificationService } = await import('./notificationService');

    await notificationService.sendNotificationToAdmins({
      type: 'AD_CAMPAIGN_PENDING_REVIEW',
      title: 'New Ad Campaign for Review',
      message: `${agencyName} has submitted an ad campaign for approval.`,
      data: {
        campaignId,
        agencyName,
        timestamp: new Date().toISOString(),
      },
      priority: 'HIGH',
    });
  } catch (err) {
    console.error('Failed to notify admins:', err);
    // Don't fail the submission if notification fails
  }
}

export async function getTargetingOptions() {
  // Get all destination regions for targeting
  const regions = await db.trekDestination.findMany({
    select: {
      id: true,
      name: true,
    },
  });

  return {
    regions: regions.map((r) => ({
      id: r.id,
      label: r.name,
    })),
    difficulties: [
      { value: 'EASY', label: 'Easy' },
      { value: 'MODERATE', label: 'Moderate' },
      { value: 'CHALLENGING', label: 'Challenging' },
      { value: 'DIFFICULT', label: 'Difficult' },
      { value: 'ALL', label: 'All Levels' },
    ],
    interests: [
      { value: 'adventureTravel', label: 'Adventure Travel' },
      { value: 'trekking', label: 'Trekking' },
      { value: 'culturalTourism', label: 'Cultural Tourism' },
      { value: 'mountaineering', label: 'Mountaineering' },
    ],
  };
}
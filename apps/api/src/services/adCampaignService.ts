import { db } from '@funtush/database';
import { generateCreativeVariations, type AdCreative } from '../utils/creativeGenerator';

export async function generateAdCampaign(agencyId: string) {
  // Get agency profile
  const agencyProfile = await db.agencyProfile.findUnique({
    where: { agencyId },
  });

  // Get agency
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
  });

  if (!agency) {
    throw new Error('Agency not found');
  }

  // Get top 5 published packages
  const packages = await db.trekPackage.findMany({
    where: {
      agencyId,
      status: 'PUBLISHED',
    },
    include: {
      itineraries: {
        select: {
          photos: true,
        },
      },
    },
    take: 5,
    orderBy: { createdAt: 'desc' },
  });

  if (packages.length === 0) {
    throw new Error('No published packages found. Create and publish packages first.');
  }

  // Transform packages for creative generator
  const creativeData = {
    agencyLogo: agencyProfile?.logo || undefined,
    agencyName: agency.name,
    packages: packages.map((pkg) => ({
      title: pkg.title,
      description: pkg.description,
      difficulty: pkg.difficulty,
      durationDays: pkg.durationDays,
      pricePerPerson: Number(pkg.pricePerPerson),
      photos: pkg.itineraries.flatMap((it) => it.photos).slice(0, 5),
    })),
  };

  // Generate 3 creative variations
  const creatives = generateCreativeVariations(creativeData);

  const allCopyText = creatives.map((c) => `${c.title}\n${c.copyText}`).join('\n---\n');

  // Create AdCampaign in DRAFT status
  const campaign = await db.adCampaign.create({
    data: {
      agencyId,
      status: 'PENDING',
      imageUrls: creatives.flatMap((c) => c.imageUrls),
      copyText: allCopyText,
      targetingParams: {
        creativeVariations: creatives.map((c, idx) => ({
          variant: idx + 1,
          title: c.title,
          images: c.imageUrls,
          copy: c.copyText,
        })),
        packageIds: packages.map((p) => p.id),
        generatedAt: new Date().toISOString(),
      },
    },
  });

  return {
    id: campaign.id,
    status: campaign.status,
    creatives: creatives.map((c) => ({
      variant: c.variant,
      title: c.title,
      imageUrls: c.imageUrls,
      copyText: c.copyText,
    })),
  };
}

export async function getCampaigns(agencyId: string) {
  return db.adCampaign.findMany({
    where: { agencyId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getCampaign(campaignId: string, agencyId: string) {
  const campaign = await db.adCampaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign || campaign.agencyId !== agencyId) {
    throw new Error('Campaign not found');
  }

  return campaign;
}
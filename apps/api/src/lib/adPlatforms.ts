import {
  createMetaCampaign,
  pauseMetaCampaign,
  type CampaignForMeta,
} from "../services/metaAdsService";
import type { TargetingParams } from "../services/targetingBuilderService";

export interface CampaignCreative {
  campaignId: string;
  agencyName: string;
  imageUrls: string[];
  copyText: string;
  dailyBudgetCents: number;
  targetingParams: unknown; 
}

export interface PlatformIds {
  metaCampaignId: string;
  googleCampaignId: string | null;
}

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
  spend: number;
}

export async function pushCampaignLive(
  creative: CampaignCreative
): Promise<PlatformIds> {
  const metaResult = await createMetaCampaign({
    id: creative.campaignId,
    copyText: creative.copyText,
    imageUrls: creative.imageUrls,
    dailyBudgetCents: creative.dailyBudgetCents,
    targetingParams: creative.targetingParams as TargetingParams,
    agencyName: creative.agencyName,
  } satisfies CampaignForMeta);

  // TODO: real Google Ads API call — create Campaign -> AdGroup -> Ad
  const googleCampaignId: string | null = null;

  return {
    metaCampaignId: metaResult.metaCampaignId,
    googleCampaignId,
  };
}

export async function pausePlatformCampaign(ids: PlatformIds): Promise<void> {
  if (ids.metaCampaignId) {
    await pauseMetaCampaign(ids.metaCampaignId);
  }

  // TODO: Google — campaignOperations.update status = PAUSED
  if (ids.googleCampaignId) {
    console.warn(
      `[adPlatforms] googleCampaignId ${ids.googleCampaignId} present but Google Ads pause is not yet implemented`
    );
  }
}

/**
 * Fetch fresh delivery metrics for a live campaign. Meta side is still a
 * stub — wire this to Meta's /insights endpoint when ready to pull real
 * impressions/clicks/spend for the periodic sync job mentioned in
 * adCampaign.service.ts's getActiveCampaigns().
 */
export async function fetchCampaignMetrics(
  ids: PlatformIds
): Promise<CampaignMetrics> {
  // TODO: Meta   — GET /{campaign-id}/insights (impressions, clicks, spend)
  // TODO: Google — searchStream metrics.impressions, clicks, cost_micros
  void ids;
  return { impressions: 0, clicks: 0, spend: 0 };
}
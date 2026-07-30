import {
  createMetaCampaign,
  pauseMetaCampaign,
  fetchMetaCampaignMetrics,
  type CampaignForMeta,
} from "../services/metaAdsService";

import {
  createGoogleCampaign,
  createGoogleSearchCampaign,
  pauseGoogleCampaign,
  fetchGoogleCampaignMetrics,
  type CampaignForGoogle,
} from "../services/googleAdsService";

import type { TargetingParams } from "../services/targetingBuilderService";

export interface CampaignCreative {
  campaignId: string;
  agencyName: string;
  imageUrls: string[];
  copyText: string;
  dailyBudgetCents: number;
  targetingParams: unknown;
}

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
  spend: number;
}

export interface PlatformMetricsBreakdown {
  meta: CampaignMetrics;
  google: CampaignMetrics;
}

export interface PlatformIds {
  metaCampaignId: string | null;
  googleCampaignId: string | null;
  googleSearchCampaignId: string | null;
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

  let googleCampaignId: string | null = null;
  let googleSearchCampaignId: string | null = null;

  try {
    const googleResult = await createGoogleCampaign({
      id: creative.campaignId,
      copyText: creative.copyText,
      dailyBudgetCents: creative.dailyBudgetCents,
      targetingParams: creative.targetingParams as TargetingParams,
      agencyName: creative.agencyName,
    } satisfies CampaignForGoogle);

    googleCampaignId = googleResult.googleCampaignId;
  } catch (err) {
    console.warn(
      `[adPlatforms] Google Display push-live skipped/failed for campaign ${creative.campaignId}:`,
      err instanceof Error ? err.message : err
    );
  }

  try {
    const googleSearchResult = await createGoogleSearchCampaign({
      id: creative.campaignId,
      copyText: creative.copyText,
      dailyBudgetCents: creative.dailyBudgetCents,
      targetingParams: creative.targetingParams as TargetingParams,
      agencyName: creative.agencyName,
    } satisfies CampaignForGoogle);

    googleSearchCampaignId = googleSearchResult.googleSearchCampaignId;
  } catch (err) {
    console.warn(
      `[adPlatforms] Google Search push-live skipped/failed for campaign ${creative.campaignId}:`,
      err instanceof Error ? err.message : err
    );
  }

  return {
    metaCampaignId: metaResult.metaCampaignId,
    googleCampaignId,
    googleSearchCampaignId,
  };
}

export async function pausePlatformCampaign(
  ids: PlatformIds
): Promise<void> {
  if (ids.metaCampaignId) {
    await pauseMetaCampaign(ids.metaCampaignId);
  }

  if (ids.googleCampaignId) {
    try {
      await pauseGoogleCampaign(ids.googleCampaignId);
    } catch (err) {
      console.error(
        `[adPlatforms] Failed to pause Google Display campaign ${ids.googleCampaignId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (ids.googleSearchCampaignId) {
    try {
      await pauseGoogleCampaign(ids.googleSearchCampaignId);
    } catch (err) {
      console.error(
        `[adPlatforms] Failed to pause Google Search campaign ${ids.googleSearchCampaignId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

export async function fetchCampaignMetrics(
  ids: PlatformIds,
  date: string
): Promise<PlatformMetricsBreakdown> {
  const meta = ids.metaCampaignId
    ? await fetchMetaCampaignMetrics(ids.metaCampaignId, date)
    : { impressions: 0, clicks: 0, spend: 0 };

  const googleDisplay =
    ids.googleCampaignId
      ? await fetchGoogleCampaignMetrics(ids.googleCampaignId, date)
      : { impressions: 0, clicks: 0, spend: 0 };

  const googleSearch =
    ids.googleSearchCampaignId
      ? await fetchGoogleCampaignMetrics(ids.googleSearchCampaignId, date)
      : { impressions: 0, clicks: 0, spend: 0 };

  const google = {
    impressions:
      googleDisplay.impressions + googleSearch.impressions,
    clicks:
      googleDisplay.clicks + googleSearch.clicks,
    spend:
      googleDisplay.spend + googleSearch.spend,
  };

  return {
    meta,
    google,
  };
}
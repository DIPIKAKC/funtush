import type { TargetingParams } from './targetingBuilderService';

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_PAGE_ID = process.env.META_PAGE_ID || '';

function getAdAccountId(): string {
  const raw = process.env.META_AD_ACCOUNT_ID || '';
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

interface MetaApiError {
  error?: { message: string; type: string; code: number; error_subcode?: number };
}

async function metaPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    params.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  params.append('access_token', META_ACCESS_TOKEN);

  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = (await res.json()) as T & MetaApiError;

  if (!res.ok || data.error) {
    throw new Error(
      `Meta API error [${path}]: ${data.error?.message || res.statusText} (code: ${data.error?.code})`
    );
  }

  return data;
}

/**
 * Search Meta's interest targeting catalog for a keyword and return the best-match interest ID.
 * Required because Meta interest targeting needs real numeric IDs, not free-text labels.
 */
async function findInterestId(keyword: string): Promise<{ id: string; name: string } | null> {
  const params = new URLSearchParams({
    type: 'adinterest',
    q: keyword,
    access_token: META_ACCESS_TOKEN,
  });

  const res = await fetch(`${GRAPH_BASE}/search?${params.toString()}`);
  const data = (await res.json()) as { data?: { id: string; name: string }[] } & MetaApiError;

  if (data.error) {
    console.warn(`[META] Interest search failed for "${keyword}": ${data.error.message}`);
    return null;
  }

  return data.data?.[0] ?? null;
}

async function buildMetaTargeting(params: TargetingParams) {
  const interestKeywords: string[] = [];
  if (params.interests.adventureTravel) interestKeywords.push('Adventure travel');
  if (params.interests.trekking) interestKeywords.push('Hiking');
  if (params.interests.culturalTourism) interestKeywords.push('Cultural tourism');
  if (params.interests.mountaineering) interestKeywords.push('Mountaineering');

  const interestResults = await Promise.all(interestKeywords.map(findInterestId));
  const interests = interestResults
    .filter((r): r is { id: string; name: string } => r !== null)
    .map((r) => ({ id: r.id, name: r.name }));

  return {
    geo_locations: {
      // Meta needs country/region/city codes, not raw destination names.
      // Falls back to Nepal at the country level until region names are
      // mapped to Meta's location-search IDs (see TODO below).
      countries: ['NP'],
    },
    flexible_spec: interests.length > 0 ? [{ interests }] : undefined,
    // TODO: behavioral retargeting (Funtush marketplace searchers/viewers) and
    // lookalike audiences require a Meta Custom Audience built from a pixel or
    // uploaded customer list — not available from targetingParams alone.
    // That's a separate integration (Meta Conversions API / Custom Audiences),
    // likely a follow-up ticket rather than part of this initial push-live step.
  };
}

/**
 * Pauses a live campaign on Meta's side (sets Campaign status to PAUSED).
 */
export async function pauseMetaCampaign(metaCampaignId: string): Promise<void> {
  if (!META_ACCESS_TOKEN) {
    throw new Error('Meta API not configured: META_ACCESS_TOKEN must be set');
  }

  await metaPost<{ success: boolean }>(metaCampaignId, {
    status: 'PAUSED',
  });
}

export interface MetaCampaignResult {
  metaCampaignId: string;
  metaAdSetId: string;
  metaCreativeId: string;
  metaAdId: string;
}

export interface CampaignForMeta {
  id: string;
  copyText: string;
  imageUrls: string[];
  dailyBudgetCents: number;
  targetingParams: TargetingParams;
  agencyName: string;
}

/**
 * Creates the full Meta object hierarchy for an approved campaign:
 * Campaign -> AdSet -> AdCreative -> Ad
 */
export async function createMetaCampaign(
  campaign: CampaignForMeta
): Promise<MetaCampaignResult> {
  if (!META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_ID || !META_PAGE_ID) {
    throw new Error(
      'Meta API not configured: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, and META_PAGE_ID must all be set'
    );
  }

  const adAccountId = getAdAccountId();

  // 1. Campaign
  const campaignRes = await metaPost<{ id: string }>(`${adAccountId}/campaigns`, {
    name: `Funtush - ${campaign.agencyName} - ${campaign.id}`,
    objective: 'OUTCOME_TRAFFIC',
    status: 'PAUSED', // start paused; flip to ACTIVE only after a manual/automated sanity check
    special_ad_categories: [],
  });

  // 2. AdSet
  const targeting = await buildMetaTargeting(campaign.targetingParams);

  const adSetRes = await metaPost<{ id: string }>(`${adAccountId}/adsets`, {
    name: `AdSet - ${campaign.id}`,
    campaign_id: campaignRes.id,
    daily_budget: campaign.dailyBudgetCents,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting,
    status: 'PAUSED',
  });

  // 3. Ad Creative
  const creativeRes = await metaPost<{ id: string }>(`${adAccountId}/adcreatives`, {
    name: `Creative - ${campaign.id}`,
    object_story_spec: {
      page_id: META_PAGE_ID,
      link_data: {
        image_url: campaign.imageUrls[0],
        message: campaign.copyText,
        link: `https://funtush.com/agencies/${campaign.agencyName}`, // TODO: replace with real deep link if agency slug/package URL is available
        call_to_action: { type: 'LEARN_MORE' },
      },
    },
  });

  // 4. Ad
  const adRes = await metaPost<{ id: string }>(`${adAccountId}/ads`, {
    name: `Ad - ${campaign.id}`,
    adset_id: adSetRes.id,
    creative: { creative_id: creativeRes.id },
    status: 'PAUSED',
  });

  return {
    metaCampaignId: campaignRes.id,
    metaAdSetId: adSetRes.id,
    metaCreativeId: creativeRes.id,
    metaAdId: adRes.id,
  };
}
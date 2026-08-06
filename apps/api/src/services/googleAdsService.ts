interface GoogleAdsMutateResponse {
  results?: Array<{ resourceName?: string }>;
}

interface GoogleAdsSearchStreamChunk {
  results?: Array<{
    metrics?: {
      impressions?: string | number;
      clicks?: string | number;
      costMicros?: string | number;
    };
  }>;
}

export type TargetingParams = {
  geographic?: { regions: string[] };
  interests?: { adventureTravel: boolean; trekking: boolean };
  behavioral?: Record<string, unknown>;
  seasonal?: Record<string, unknown>;
};

export type CampaignForGoogle = {
  id: string;
  copyText: string;
  dailyBudgetCents: number;
  agencyName: string;
  targetingParams: TargetingParams;
};

type GoogleCampaignResult = {
  googleCampaignId: string;
  googleAdGroupId: string;
  googleAdId: string;
};

type GoogleMetrics = {
  impressions: number;
  clicks: number;
  spend: number;
};

const GOOGLE_CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID || '';
const GOOGLE_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || '';

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export async function createGoogleCampaign(
  campaignData: CampaignForGoogle
): Promise<GoogleCampaignResult> {
  if (!GOOGLE_CUSTOMER_ID || !GOOGLE_DEVELOPER_TOKEN) {
    throw new Error('Google Ads API not configured');
  }

  try {
    const campaignId = await createCampaign(campaignData);
    const adGroupId = await createAdGroup(campaignId, campaignData.id);
    const googleAdId = await createDisplayAd(adGroupId, campaignData);

    await addTargetingCriteria(adGroupId, campaignData.targetingParams);

    return {
      googleCampaignId: campaignId,
      googleAdGroupId: adGroupId,
      googleAdId,
    };
  } catch (err) {
    console.error('[GOOGLE_ADS] Campaign creation failed:', err);
    throw new Error(
      `Google Ads campaign creation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function createGoogleSearchCampaign(
  campaignData: CampaignForGoogle
): Promise<{ googleSearchCampaignId: string }> {
  if (!GOOGLE_CUSTOMER_ID || !GOOGLE_DEVELOPER_TOKEN) {
    throw new Error('Google Ads API not configured');
  }

  try {
    const campaignId = await createSearchCampaign(campaignData);
    const adGroupId = await createSearchAdGroup(campaignId, campaignData.id);
    await createResponsiveSearchAd(adGroupId, campaignData);
    await addSearchKeywords(adGroupId, campaignData);

    return { googleSearchCampaignId: campaignId };
  } catch (err) {
    console.error('[GOOGLE_ADS] Search campaign creation failed:', err);
    throw new Error(
      `Google Ads search campaign creation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function createSearchCampaign(
  campaignData: CampaignForGoogle
): Promise<string> {
  const customerId = formatCustomerId(GOOGLE_CUSTOMER_ID);

  // Create campaign budget first
  const budgetResource = await createOrGetBudget(
    customerId,
    `Budget_${campaignData.id}_${Date.now()}`,
    Math.floor(campaignData.dailyBudgetCents * 10000)
  );

  const campaignOperation = {
    create: {
      name: `Funtush_Search_${campaignData.id}_${Date.now()}`,
      advertisingChannelType: 'SEARCH',
      status: 'ENABLED',

      campaignBudget: budgetResource,

      biddingStrategyConfiguration: {
        biddingStrategyType: 'MANUAL_CPC',
      },

      startDate: new Date()
        .toISOString()
        .split('T')[0]
        .replace(/-/g, ''),
    },
  };

  const response = await callGoogleAdsApi<GoogleAdsMutateResponse>(
    'POST',
    `/customers/${customerId}/campaigns:mutate`,
    {
      operations: [campaignOperation],
    }
  );

  const campaignResourceName = response?.results?.[0]?.resourceName;

  if (!campaignResourceName) {
    throw new Error('Failed to create Google search campaign');
  }

  return campaignResourceName.split('/').pop() || '';
}

async function createSearchAdGroup(campaignId: string, funtushCampaignId: string): Promise<string> {
  const customerId = formatCustomerId(GOOGLE_CUSTOMER_ID);
  const campaignResourceName = `customers/${customerId}/campaigns/${campaignId}`;

  const adGroupOperation = {
    create: {
      name: `SearchAdGroup_${funtushCampaignId}`,
      campaignResource: campaignResourceName,
      status: 'ENABLED',
      type: 'SEARCH_STANDARD',
      cpcBidMicros: 100000,
    },
  };

  const response = await callGoogleAdsApi<GoogleAdsMutateResponse>(
    'POST',
    `/customers/${customerId}/adGroups:mutate`,
    { operations: [adGroupOperation] }
  );

  const adGroupResourceName = response?.results?.[0]?.resourceName;
  if (!adGroupResourceName) throw new Error('Failed to create search ad group');

  return adGroupResourceName.split('/').pop() || '';
}

async function createResponsiveSearchAd(
  adGroupId: string,
  campaignData: CampaignForGoogle
): Promise<string> {
  const customerId = formatCustomerId(GOOGLE_CUSTOMER_ID);
  const adGroupResourceName = `customers/${customerId}/adGroups/${adGroupId}`;

  const headlines = [
    campaignData.agencyName.slice(0, 30),
    'Book Your Trek Today',
    'Expert Guided Treks',
  ];

  const descriptions = [
    campaignData.copyText.slice(0, 90),
    'Trusted local trekking agency in Nepal.',
  ];

  const adOperation = {
    create: {
      adGroupResource: adGroupResourceName,
      responsiveSearchAd: {
        headlines: headlines.map((text) => ({ text })),
        descriptions: descriptions.map((text) => ({ text })),
      },
      status: 'ENABLED',
    },
  };

  const response = await callGoogleAdsApi<GoogleAdsMutateResponse>(
    'POST',
    `/customers/${customerId}/ads:mutate`,
    { operations: [adOperation] }
  );

  const adResourceName = response?.results?.[0]?.resourceName;
  if (!adResourceName) throw new Error('Failed to create responsive search ad');

  return adResourceName.split('/').pop() || '';
}

async function addSearchKeywords(
  adGroupId: string,
  campaignData: CampaignForGoogle
): Promise<void> {
  const customerId = formatCustomerId(GOOGLE_CUSTOMER_ID);
  const adGroupResourceName = `customers/${customerId}/adGroups/${adGroupId}`;

  const keywordTexts = [
    `${campaignData.agencyName} trekking`,
    'nepal trekking tours',
    'everest base camp trek',
    'guided himalayan trek',
  ];

  const operations = keywordTexts.map((text) => ({
    create: {
      adGroupResource: adGroupResourceName,
      keyword: {
        text,
        matchType: 'BROAD',
      },
    },
  }));

  try {
    await callGoogleAdsApi<GoogleAdsMutateResponse>(
      'POST',
      `/customers/${customerId}/adGroupCriteria:mutate`,
      { operations }
    );
  } catch (err) {
    console.error('[GOOGLE_ADS] Keyword creation failed:', err);
  }
}

export async function pauseGoogleCampaign(googleCampaignId: string): Promise<void> {
  if (!googleCampaignId) {
    throw new Error('Google campaign ID is required');
  }

  if (!GOOGLE_CUSTOMER_ID) {
    throw new Error('Google Ads API not configured');
  }

  try {
    const customerId = formatCustomerId(GOOGLE_CUSTOMER_ID);
    const campaignResourceName = `customers/${customerId}/campaigns/${googleCampaignId}`;

    await callGoogleAdsApi('POST', `/${campaignResourceName}:pause`, {});

    console.log(`[GOOGLE_ADS] Campaign ${googleCampaignId} paused`);
  } catch (err) {
    console.error('[GOOGLE_ADS] Campaign pause failed:', err);
    throw new Error(
      `Google Ads campaign pause failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function fetchGoogleCampaignMetrics(
  googleCampaignId: string,
  date: string
): Promise<GoogleMetrics> {
  if (!googleCampaignId) {
    throw new Error('Google campaign ID is required');
  }

  if (!GOOGLE_CUSTOMER_ID) {
    console.warn('[GOOGLE_ADS] API not configured, returning zero metrics');
    return { impressions: 0, clicks: 0, spend: 0 };
  }

  try {
    const customerId = formatCustomerId(GOOGLE_CUSTOMER_ID);
    const query = `
      SELECT
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros
      FROM campaign
      WHERE campaign.id = ${googleCampaignId}
        AND segments.date = '${date}'
    `;

    const response = await callGoogleAdsApi<GoogleAdsSearchStreamChunk[]>(
      'POST',
      `/customers/${customerId}/googleAds:searchStream`,
      { query }
    );

    if (!response || response.length === 0) {
      return { impressions: 0, clicks: 0, spend: 0 };
    }

    const metrics = response[0]?.results?.[0]?.metrics || {};

    return {
      impressions: Number(metrics.impressions) || 0,
      clicks: Number(metrics.clicks) || 0,
      spend: (Number(metrics.costMicros) || 0) / 1_000_000, // micros to dollars
    };
  } catch (err) {
    console.error('[GOOGLE_ADS] Metrics fetch failed:', err);
    return { impressions: 0, clicks: 0, spend: 0 };
  }
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  // Reuse cached token while it still has >60s of life left
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Google Ads OAuth credentials not configured');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as { error?: string; error_description?: string };
    throw new Error(
      `Google OAuth token refresh failed: ${error.error_description || error.error || response.statusText}`
    );
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

async function createOrGetBudget(
  customerId: string,
  budgetName: string,
  amountMicros: number
): Promise<string> {
  const response = await callGoogleAdsApi<GoogleAdsMutateResponse>(
    'POST',
    `/customers/${customerId}/campaignBudgets:mutate`,
    {
      operations: [
        {
          create: {
            name: budgetName,
            deliveryMethod: 'STANDARD',
            amountMicros,
            explicitlyShared: false,
          },
        },
      ],
    }
  );

  const resource = response?.results?.[0]?.resourceName;

  if (!resource) {
    throw new Error('Failed to create Google campaign budget');
  }

  return resource;
}

async function createCampaign(campaignData: CampaignForGoogle): Promise<string> {
  const customerId = formatCustomerId(GOOGLE_CUSTOMER_ID);

  const campaignOperation = {
    create: {
      name: `Funtush_${campaignData.id}_${Date.now()}`,
      advertisingChannelType: 'DISPLAY',
      status: 'ENABLED',
      dailyBudgetMicros: campaignData.dailyBudgetCents * 10000,
      biddingStrategyConfiguration: {
        biddingStrategyType: 'MANUAL_CPC',
      },
      startDate: new Date().toISOString().split('T')[0].replace(/-/g, ''),
    },
  };

  const response = await callGoogleAdsApi<GoogleAdsMutateResponse>(
    'POST',
    `/customers/${customerId}/campaigns:mutate`,
    { operations: [campaignOperation] }
  );

  const campaignResourceName = response?.results?.[0]?.resourceName;
  if (!campaignResourceName) throw new Error('Failed to create Google campaign');

  return campaignResourceName.split('/').pop() || '';
}

async function createAdGroup(campaignId: string, funtushCampaignId: string): Promise<string> {
  const customerId = formatCustomerId(GOOGLE_CUSTOMER_ID);
  const campaignResourceName = `customers/${customerId}/campaigns/${campaignId}`;

  const adGroupOperation = {
    create: {
      name: `AdGroup_${funtushCampaignId}`,
      campaignResource: campaignResourceName,
      status: 'ENABLED',
      type: 'DISPLAY_STANDARD',
      cpcBidMicros: 100000,
    },
  };

  const response = await callGoogleAdsApi<GoogleAdsMutateResponse>(
    'POST',
    `/customers/${customerId}/adGroups:mutate`,
    { operations: [adGroupOperation] }
  );

  const adGroupResourceName = response?.results?.[0]?.resourceName;
  if (!adGroupResourceName) throw new Error('Failed to create ad group');

  return adGroupResourceName.split('/').pop() || '';
}

async function createDisplayAd(
  adGroupId: string,
  campaignData: CampaignForGoogle
): Promise<string> {
  const customerId = formatCustomerId(GOOGLE_CUSTOMER_ID);
  const adGroupResourceName = `customers/${customerId}/adGroups/${adGroupId}`;

  const mediaId = await uploadImage(campaignData.copyText);

  const adOperation = {
    create: {
      adGroupResource: adGroupResourceName,
      displayUploadAd: {
        mediaBundle: {
          mediaResource: `customers/${customerId}/media/${mediaId}`,
        },
      },
      status: 'ENABLED',
    },
  };

  const response = await callGoogleAdsApi<GoogleAdsMutateResponse>(
    'POST',
    `/customers/${customerId}/ads:mutate`,
    { operations: [adOperation] }
  );

  const adResourceName = response?.results?.[0]?.resourceName;
  if (!adResourceName) throw new Error('Failed to create display ad');

  return adResourceName.split('/').pop() || '';
}

async function uploadImage(copyText: string): Promise<string> {
  const customerId = formatCustomerId(GOOGLE_CUSTOMER_ID);

  try {
    const mediaOperation = {
      create: {
        name: `image_${Date.now()}`,
        type: 'IMAGE',
        imageData: Buffer.from(copyText).toString('base64'),
      },
    };

    const response = await callGoogleAdsApi<GoogleAdsMutateResponse>(
      'POST',
      `/customers/${customerId}/media:mutate`,
      { operations: [mediaOperation] }
    );

    const mediaResourceName = response?.results?.[0]?.resourceName;
    if (!mediaResourceName) throw new Error('Failed to upload image');

    return mediaResourceName.split('/').pop() || '';
  } catch (err) {
    console.error('[GOOGLE_ADS] Image upload failed:', err);
    throw new Error(`Image upload failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function addTargetingCriteria(
  adGroupId: string,
  targetingParams: TargetingParams
): Promise<void> {
  const customerId = formatCustomerId(GOOGLE_CUSTOMER_ID);
  const adGroupResourceName = `customers/${customerId}/adGroups/${adGroupId}`;

  const operations = [];

  if (targetingParams.geographic?.regions?.includes('Everest')) {
    operations.push({
      create: {
        adGroupResource: adGroupResourceName,
        geoTargetConstant: 'geoTargetConstants/1023191',
      },
    });
  }

  if (targetingParams.interests?.adventureTravel || targetingParams.interests?.trekking) {
    operations.push({
      create: {
        adGroupResource: adGroupResourceName,
        userInterest: 'userInterestConstants/103',
      },
    });
  }

  if (operations.length === 0) return;

  try {
    await callGoogleAdsApi<GoogleAdsMutateResponse>(
      'POST',
      `/customers/${customerId}/adGroupCriteria:mutate`,
      { operations }
    );
  } catch (err) {
    console.error('[GOOGLE_ADS] Targeting criteria creation failed:', err);
  }
}

async function callGoogleAdsApi<T = unknown>(
  method: string,
  endpoint: string,
  payload: unknown
): Promise<T> {
  const baseUrl = 'https://googleads.googleapis.com/v18';
  const url = `${baseUrl}${endpoint}`;

  const accessToken = await getAccessToken();

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': GOOGLE_DEVELOPER_TOKEN,
    },
    body: method !== 'GET' ? JSON.stringify(payload) : undefined,
  });

  if (!response.ok) {
    const error = (await response.json()) as { error?: { message?: string } };
    throw new Error(`Google Ads API error: ${error.error?.message || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function formatCustomerId(customerId: string): string {
  return customerId.replace(/-/g, '');
}
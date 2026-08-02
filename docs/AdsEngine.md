# Ads Engine

## Overview

Implemented an end-to-end ad campaign engine that turns agency package content into campaign creatives, lets agencies refine targeting, requires admin review before launch, pushes approved campaigns to Meta and Google, and syncs daily performance data back into the database. The system is built around a gated approval workflow so campaigns never go live before a super-admin approves them.

> **Note:** Campaign creation starts from agency package content. The engine automatically pulls the agency logo, published package photos, package copy, and package metadata to generate ad variations. Approval is the release gate: no live platform push happens until the campaign is explicitly approved by an admin.

## Features

### Day 1: Ad Creative Generation

Implemented automatic creative generation from published package data so agencies can create ads without writing copy manually.

#### Creative Generation Flow

1. Agency requests campaign generation.
2. System loads the agency record and all published packages.
3. It collects itinerary photos from the package content.
4. It builds 3 creative variations with different copy angles.
5. The campaign is stored in `PENDING_APPROVAL` so it can be reviewed before launch.

#### Creative Inputs

- Agency name
- Agency logo
- Published package title and description
- Package duration and price
- Package difficulty
- Itinerary photos

#### Creative Output

- 3 creative variations
- Campaign headline/title per variation
- Copy text with different tones
- Image URL sets based on package photos
- Stored creative content in `imageUrls`, `copyText`, and `targetingParams.creativeVariations`

#### Campaign Record Shape

The campaign record stores:

- `id`
- `agencyId`
- `status`
- `imageUrls`
- `copyText`
- `targetingParams`
- `dailyBudgetCents`
- platform IDs after approval

### Day 2: Targeting Parameters

Implemented a targeting builder so agencies can define who should see the campaign before submission for review.

#### Targeting Builder

- Geographic targeting by destination regions
- Interest targeting such as adventure travel and trekking
- Behavioral retargeting for marketplace searchers who did not book
- Seasonal boost flag and boost configuration

#### Submission Flow

1. Agency attaches targeting parameters to the campaign.
2. Campaign is validated for required targeting data.
3. Campaign status is moved to `PENDING_APPROVAL`.
4. Super-admin review queue is notified.

#### Submission Guarantees

- Campaign must belong to the requesting agency
- Campaign must contain targeting parameters
- Already approved campaigns cannot be resubmitted
- Submission is only allowed for pending campaigns

### Day 3: Meta Marketing API Integration

Implemented the admin approval workflow that pushes approved campaigns live on Meta before the campaign becomes active.

#### Approval Flow

1. Admin opens the pending campaign queue.
2. Admin approves a pending campaign.
3. System calls the platform push layer.
4. Meta campaign IDs are stored on the campaign record.
5. Campaign status changes to `ACTIVE` only after a successful push.

#### Stored Platform Data

- `metaCampaignId`
- `googleCampaignId`
- `googleSearchCampaignId`
- `approvedAt`

#### Safety Behavior

- Approval only works for `PENDING_APPROVAL` campaigns
- Push failures leave the campaign pending rather than active
- Rejected campaigns stay blocked from launch

### Day 4: Google Ads API Integration

Implemented support for Google Ads push-live and performance tracking so approved campaigns can run on both Meta and Google.

#### Live Push Behavior

- Google Display campaigns are created on approval
- Google Search campaigns are also created on approval
- If Google push is unavailable, the campaign can still continue with available platform IDs

#### Performance Sync

The performance endpoint pulls daily metrics from both platforms and stores them in `AdPerformanceDaily`.

#### Performance Flow

1. Agency requests campaign performance.
2. System verifies the campaign belongs to the agency.
3. It fetches daily metrics from Meta and Google.
4. Metrics are upserted into `AdPerformanceDaily`.
5. Aggregated totals are returned to the caller.

#### Performance Metrics Stored

- Impressions
- Clicks
- Spend
- Platform-specific rows for Meta and Google

### Day 5: Testing

Implemented comprehensive tests for the full ad workflow, including creative generation, approval gating, platform synchronization, and pause/reject behavior.

#### Test Coverage Goals

- Creative generation produces valid variations from package data
- Campaigns only push live after admin approval
- Performance sync pulls correct data from both platforms
- Pause and reject flows correctly stop or block campaigns

#### Test Scope

- Unit-style service tests for creative generation
- Admin approval and platform integration tests
- Performance sync and upsert tests
- Pause, reject, and authorization tests

## Environment Variables
 
The ad engine's platform integrations are configured entirely through environment variables — no credentials are hardcoded. These must be set before the Meta and Google push-live paths, and the performance sync job, can function against real platform APIs.
 
```dotenv
# Meta Ads
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
META_PAGE_ID=
META_API_VERSION=v21.0
 
# Google Ads
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_API_VERSION=v24
```

## Database Models

| Model | Purpose |
|--------|---------|
| `AdCampaign` | Stores campaign content, targeting, status, budgets, and platform IDs |
| `AdPerformanceDaily` | Stores daily impression, click, and spend data by platform |
| `Agency` | Owns campaigns and package content used for generation |
| `TrekPackage` | Source content for campaign copy and targeting |
| `TrekItinerary` | Source of package photos used in creatives |
| `AgencyProfile` | Source of agency branding such as logo |

## API Endpoints

### Campaign Creation and Review

#### `POST /agencies/me/ad-campaigns/generate`

Creates a new ad campaign from the agency's published package content.

**Response**

- Campaign ID
- Stored creative data
- Targeting parameters
- Campaign status

#### `POST /agencies/me/ad-campaigns/:id/targeting`

Attaches or updates targeting parameters for a campaign.

**Response**

- Updated campaign
- Targeting parameters

#### `POST /agencies/me/ad-campaigns/:id/submit`

Submits the campaign for super-admin review.

**Response**

- Campaign status changed to `PENDING_APPROVAL`
- Admin review notification triggered

### Campaign Retrieval

#### `GET /agencies/me/ad-campaigns`

Returns all campaigns for the authenticated agency.

#### `GET /agencies/me/ad-campaigns/:id`

Returns a single campaign if it belongs to the authenticated agency.

#### `GET /agencies/me/ad-campaigns/:id/performance`

Syncs and returns campaign performance metrics for Meta and Google.

**Response**

- Total impressions, clicks, and spend
- Platform breakdown
- Daily performance rows

#### `GET /agencies/me/ad-campaigns/targeting/options`

Returns available targeting choices for regions, difficulty levels, and interests.

### Admin Review Actions

#### `GET /admin/ad-campaigns/pending`

Returns campaigns awaiting review.

#### `GET /admin/ad-campaigns/active`

Returns campaigns currently running with stored delivery metrics.

#### `PATCH /admin/ad-campaigns/:id/approve`

Approves a pending campaign and pushes it live to ad platforms.

#### `PATCH /admin/ad-campaigns/:id/reject`

Rejects a pending campaign with a required rejection reason.

#### `PATCH /admin/ad-campaigns/:id/pause`

Pauses an active campaign on connected platforms.

## Authentication & Security

### Agency APIs

Require:

- `X-Refresh-Token` header
- An active agency account
- Agency ownership checks on campaign access and modification

### Admin APIs

- Protected by `requireAuth`
- Protected by `requireSuperAdminRole`
- Campaign approval, rejection, and pausing are restricted to super-admin review paths

### Platform Safety

- Campaigns remain `PENDING_APPROVAL` until approval succeeds
- Approval failures do not activate the campaign
- Rejected campaigns cannot be pushed live
- Pause only works for `ACTIVE` campaigns
- Unauthorized performance access is rejected


## Automated Test Coverage

The ad engine includes automated coverage for creative generation, admin approval workflows, performance sync, and pause/reject safety behavior.

| Test Suite | 
|--------|
| Ad Creative Generation |
| Admin Approval and Platform Integration | 
| Performance Sync | 
| Targeting and Submission | 
| Route / Service Integration | Included in the main API suite |

Coverage includes:

- 3-variation creative generation from package data
- Agency branding and itinerary photo selection
- Campaign submission gating
- Meta and Google push-live behavior
- Rejection reason handling
- Pause behavior for active campaigns only
- Daily performance upserts from both platforms
- Authorization checks for cross-agency access


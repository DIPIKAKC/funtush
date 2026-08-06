## Bug Reporting Flow

# DAY 1 — Bug Reporting

## Overview

Implemented the Bug Reporting module, allowing agencies to submit platform bug reports (with optional screenshots) and view their own paginated bug history. All reports are stored in the `REPORTED` state and are isolated per agency to ensure tenant security.

## 1. Bug Submission

### 1.1 Submit Bug

**`POST /agencies/me/bugs`**

Agency admins can submit bug reports by providing a title, description, optional reproduction steps, and an optional screenshot URL.

#### Validation
- `title` must be a non-empty string after trimming
- `description` must be a non-empty string after trimming

#### Processing
- Trims input before persisting
- Creates a new `BugReport` with `status: REPORTED`
- Leaves `priority` and `resolutionNote` unset
- Uses the existing `POST /upload` endpoint for screenshot uploads

#### Implementation
- `apps/api/src/services/bugReport.service.ts` → `submitBug`
- `apps/api/src/controllers/bugReport.controller.ts` → `submitBugController`
- `apps/api/src/routes/bug.routes.ts`

## 2. Bug History & Tracking

### 2.1 List Agency Bugs

**`GET /agencies/me/bugs?status={REPORTED|IN_PROGRESS|RESOLVED}&page=&limit=`**

Returns a paginated list of the authenticated agency's bug reports, optionally filtered by status and ordered newest first.

#### Tenant Isolation
- Queries are always scoped to `req.user.agencyId`
- Agencies can only access their own bug reports

#### Implementation
- `apps/api/src/services/bugReport.service.ts` → `getAgencyBugs`
- `apps/api/src/controllers/bugReport.controller.ts` → `getAgencyBugsController`

## 3. Data Model

### Models
- `BugReport`

### Migration
- `20260803111737_add_bug_report`

## 4. Testing Summary

**Test file**
- `apps/api/src/test/bugReporting/bugReport.test.ts`

**Covered Tests**
- Bug submission
- Input validation
- Tenant isolation
- Pagination and status filtering

**Result**
-  Passed

# DAY 2 — Bug Workflow & Hints

## Overview

Implemented the complete bug lifecycle for platform staff, including priority management, assignment, agency-visible hints, and resolution with email and push notifications.

## 1. Set Bug Priority

### 1.1 Update Priority

**`PATCH /admin/bugs/:id/priority`**

Allows Super Admins to assign a priority level to a reported bug.

#### Validation
- Priority must be a valid `BugPriority`
- Bug must exist

#### Processing
- Updates the `priority` field
- Does not modify the bug status

#### Implementation
- `apps/api/src/services/bugReport.service.ts` → `setBugPriority`
- `apps/api/src/controllers/bugReport.controller.ts` → `setBugPriorityController`
- `apps/api/src/routes/bug.routes.ts`

## 2. Assign Bug

### 2.1 Assign to Platform Staff

**`PATCH /admin/bugs/:id/assign`**

Assigns a bug to a Platform Admin or Platform Support user.

#### Validation
- Assignee must exist
- Assignee role must be `PLATFORM_ADMIN` or `PLATFORM_SUPPORT`
- Bug must exist
- Agency users cannot be assigned

#### Processing
- Updates `assigneeId`
- Automatically changes status from `REPORTED` to `IN_PROGRESS`
- Preserves existing `IN_PROGRESS` or `RESOLVED` status

#### Implementation
- `apps/api/src/services/bugReport.service.ts` → `assignBug`
- `apps/api/src/controllers/bugReport.controller.ts` → `assignBugController`

## 3. Add Bug Hint

### 3.1 Add Hint

**`POST /admin/bugs/:id/hint`**

Allows platform staff to attach hints or workarounds visible to the reporting agency.

#### Validation
- Hint note must be non-empty after trimming
- Bug must exist

#### Processing
- Trims hint text before persisting
- Creates a new `BugHint`
- Supports multiple hints on a bug
- Sends email notification to the reporting agency

#### Implementation
- `apps/api/src/services/bugReport.service.ts` → `addBugHint`
- `apps/api/src/controllers/bugReport.controller.ts` → `addBugHintController`

## 4. Resolve Bug

### 4.1 Resolve Bug

**`PATCH /admin/bugs/:id/resolve`**

Marks a bug as resolved, stores the resolution note, and notifies the reporting agency.

#### Validation
- Resolution note must be non-empty after trimming
- Bug must exist
- Cannot resolve an already resolved bug

#### Processing
- Updates status to `RESOLVED`
- Saves the trimmed `resolutionNote`
- Sends email notification
- Sends push notification when an FCM token is available

#### Implementation
- `apps/api/src/services/bugReport.service.ts` → `resolveBug`
- `apps/api/src/controllers/bugReport.controller.ts` → `resolveBugController`

## 5. Data Model

### Models
- `BugReport` 
- `BugHint`

### Enums
- `UserRole`
- `BugPriority`
- `BugStatus`

### Migration
- `20260804124221_add_platform_roles`

## 6. Testing Summary

**Test file**
- `apps/api/src/test/bugReporting/bugWorkflow.test.ts`

**Covered Tests**
- Priority updates
- Bug assignment
- Bug hints
- Bug resolution

**Result**
-  Passed

# DAY 3 — API Key Management (Large Tier)
 
## Overview
 
Implemented the API Key Management module, allowing Large tier agencies to generate, manage, and authenticate external API requests using scoped API keys. Keys are cryptographically hashed, shown once at creation, and support read-only and read-write scopes. The middleware validates keys, respects scope restrictions, and tracks usage via `lastUsedAt` timestamps.
 
## 1. API Key Creation
 
### 1.1 Generate API Key
 
**`POST /agencies/me/api-keys`**
 
Allows AGENCY_ADMIN users to generate a new API key for external service authentication.
 
#### Validation
- Requires AGENCY_ADMIN role
- Agency must have LARGE subscription tier
- `name` must be non-empty after trimming
- `scope` must be either `READ_ONLY` or `READ_WRITE`
#### Processing
- Trims name before persisting
- Generates 32-byte random secret → `funtush_live_{hex}`
- Creates key hash using `hashToken()` for storage
- Returns raw key **once only** at creation
- Creates key prefix (first 20 chars) for dashboard display
- Defaults scope to `READ_ONLY` if omitted
#### Security
- Raw key never stored in database
- Only `keyHash` persisted for verification
- Key is never returned on subsequent list calls
- Prefix shown in dashboard for identification without exposing full key
#### Implementation
- `apps/api/src/services/apiKey.service.ts` → `createApiKey`
- `apps/api/src/controllers/apiKey.controller.ts` → `createApiKeyController`
- `apps/api/src/routes/apiKey.routes.ts`
## 2. API Key Management
 
### 2.1 List Agency Keys
 
**`GET /agencies/me/api-keys`**
 
Returns all API keys for the authenticated agency (AGENCY_ADMIN only).
 
#### Tenant Isolation
- Queries scoped to `req.user.agencyId`
- Never exposes `keyHash` or raw key
- Includes `keyPrefix`, `scope`, `lastUsedAt`, `revoked` status
#### Ordering
- Descending creation order (newest first)
#### Implementation
- `apps/api/src/services/apiKey.service.ts` → `listApiKeys`
- `apps/api/src/controllers/apiKey.controller.ts` → `listApiKeysController`
### 2.2 Revoke API Key
 
**`DELETE /agencies/me/api-keys/:id`**
 
Instantly revokes an API key, preventing further authentication.
 
#### Validation
- Key must exist
- Key must belong to authenticated agency (403 if different)
- Cannot revoke already revoked key (409)
#### Processing
- Sets `revoked: true`
- No transition period — revocation is immediate
- Revoked keys return `null` on authentication
#### Implementation
- `apps/api/src/services/apiKey.service.ts` → `revokeApiKey`
- `apps/api/src/controllers/apiKey.controller.ts` → `revokeApiKeyController`
## 3. API Key Authentication & Middleware
 
### 3.1 Authenticate Requests
 
**Middleware: `requireApiKey`**
 
Validates incoming API requests using the `X-Api-Key` header.
 
#### Processing
- Extracts raw key from `X-Api-Key` header
- Hashes key with `hashToken()` for comparison
- Looks up key in database by `keyHash`
- Validates key is active (not revoked)
- Attaches `{ agencyId, scope, keyId }` to `req.apiKeyAuth`
- Updates `lastUsedAt` timestamp (awaited for test reliability)
#### Error Handling
- 401 if header missing
- 401 if key not found or revoked
- 403 if scope insufficient for requested operation
#### Scope Enforcement
- Use `requireWriteScope` middleware for write operations
- READ_ONLY keys blocked from POST/PATCH/DELETE
- READ_WRITE keys allowed all operations
#### Implementation
- `apps/api/src/middleware/apiKeyAuth.middleware.ts` → `requireApiKey`, `requireWriteScope`
### 3.2 Scope Validation
 
**`function requireWriteScope(req, res, next)`**
 
Middleware to enforce READ_WRITE scope on write operations.
 
#### Processing
- Checks `req.apiKeyAuth?.scope !== 'READ_WRITE'`
- Returns 403 if insufficient scope
- Proceeds to next middleware if authorized
#### Usage
```typescript
router.post('/resource', requireApiKey, requireWriteScope, controllerFn);
```
 
## 4. Data Model
 
### Models
- `ApiKey`
### Schema Fields
- `id` — unique identifier
- `agencyId` — foreign key to agency
- `keyHash` — bcrypt-style hash of raw key (stored, never raw key)
- `keyPrefix` — first 20 chars of key for dashboard display
- `scope` — `READ_ONLY | READ_WRITE`
- `name` — agency-provided label
- `createdAt` — timestamp of key creation
- `lastUsedAt` — timestamp of last successful authentication (null until first use)
- `revoked` — boolean; true when revoked
### Enums
- `ApiKeyScope = READ_ONLY | READ_WRITE`
### Migration
- `20260805120000_add_api_keys`

## 6. Testing Summary

**Test files**
- `apps/api/src/test/bugReporting/apiKey.service.test.ts`
- `apps/api/src/test/bugReporting/apiKey.integration.test.ts`

**Covered Tests**
- API key creation and validation
- API key listing and ordering
- API key revocation
- API key authentication
- Scope enforcement (READ_ONLY / READ_WRITE)
- Tier restriction (LARGE tier only)
- Security (key shown once, keyHash hidden, lastUsedAt updates)
- Integration workflow (create, list, revoke, authenticate)

**Result**
-  Passed 

## Environment Variables

No new environment variables were introduced. The module uses the existing database connection, upload service, email service, and push notification configuration.

```dotenv
DATABASE_URL=postgresql://postgres:root@localhost:5432/funtush?schema=public
```

## Useful Commands

```powershell
# Run development server
pnpm run dev

# Run Prisma migrations
pnpm --filter @funtush/database prisma migrate dev

# Regenerate Prisma client
npx prisma generate

# Open Prisma Studio
npx prisma studio

# Run bug reporting tests
pnpm test bugReport.test.ts
pnpm test bugWorkflow.test.ts

# Run all tests and lint
pnpm test
pnpm lint
```
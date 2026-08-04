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
- `BugReport` (updated)
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
## Bug Reporting Flow

### Overview

Implemented the Bug Reporting module, allowing agencies to submit platform bug reports (with optional screenshots) and view their own paginated bug history. All reports are stored in the REPORTED state and are isolated per agency to ensure tenant security.


### 1. Bug Submission Flow

#### 1.1 Submit Bug
**`POST /agencies/me/bugs`**

Agency submits `title`, `description`, optional `stepsToReproduce`, and optional `screenshotUrl`.

**Validation**
- `title` must be a non-empty string after trimming
- `description` must be a non-empty string after trimming

**Processing**
- Input strings are trimmed before persisting
- New `BugReport` row created with `status: REPORTED`
- `priority` and `resolutionNote` are left unset at creation — these are set later by Super Admin (Day 2 scope)
- Screenshot upload itself is handled by the existing generic `POST /upload` endpoint; the client uploads first and passes the returned URL in as `screenshotUrl`

#### Implementation
- `apps/api/src/services/bugReport.service.ts` → `submitBug`, `getAgencyBugs`
- `apps/api/src/controllers/bugReport.controller.ts` → `submitBugController`, `getAgencyBugsController`
- `apps/api/src/routes/bug.routes.ts`


### 2. Bug History & Tracking

#### 2.1 List Agency Bugs
**`GET /agencies/me/bugs?status={REPORTED|IN_PROGRESS|RESOLVED}&page=&limit=`**

Agency admin — paginated list of the agency's own bug reports, optionally filtered by status, newest first.

**Tenant Isolation**
- Query is always scoped to `agencyId` pulled from the authenticated JWT (`req.user.agencyId`)
- An agency can never see another agency's bug reports, per platform-wide tenant isolation rules

#### Implementation
- `apps/api/src/services/bugReport.service.ts` → `getAgencyBugs`


### 3. Data Model

`BugReport`:

| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | Primary key |
| `agencyId` | String | Foreign key → `Agency`, tenant scope |
| `title` | String | Required |
| `description` | String | Required |
| `stepsToReproduce` | String? | Optional |
| `screenshotUrl` | String? | Optional, set via existing upload endpoint |
| `status` | `BugStatus` | `REPORTED` (default) → `IN_PROGRESS` → `RESOLVED` |
| `priority` | `BugPriority`? | Null at creation; set by Super Admin (Day 2) |
| `resolutionNote` | String? | Set by Super Admin on resolution (Day 2) |
| `createdAt` / `updatedAt` | DateTime | Standard timestamps |

Migration: `packages/database/prisma/migrations/20260803111737_add_bug_report/`


### 4. Testing Summary

| Method | URL / Function | What Was Tested | Outcome |
|---|---|---|---|
| — | `submitBug()` | Creates bug report with `status: REPORTED`, `priority`/`resolutionNote` null | Pass |
| — | `submitBug()` | Stores optional `screenshotUrl` when provided | Pass |
| — | `submitBug()` | Rejects empty `title` | Pass |
| — | `submitBug()` | Rejects empty `description` | Pass |
| — | `submitBug()` | Trims whitespace from `title` and `description` | Pass |
| — | `getAgencyBugs()` | Tenant isolation — never returns another agency's bugs | Pass |
| — | `getAgencyBugs()` | Returns bugs ordered newest first | Pass |
| — | `getAgencyBugs()` | Pagination returns correct, non-overlapping pages | Pass |
| — | `getAgencyBugs()` | Filters correctly by `status` | Pass |
| — | `getAgencyBugs()` | Returns empty list for an agency with no bugs | Pass |
| `POST` | `/agencies/me/bugs` | Full HTTP route through `requireAuth` + `requireRole` middleware | **Pending manual verification** |
| `GET` | `/agencies/me/bugs` | Full HTTP route through `requireAuth` + `requireRole` middleware | **Pending manual verification** |

> **Note:** All service-layer logic (creation, validation, tenant isolation, pagination, filtering) is covered by automated tests — 10/10 passing. The two HTTP-level rows above have not yet been exercised by an automated or manual request through the actual Express route; this is the one remaining check before Day 1 is fully closed out.

Test file: `apps/api/src/test/bugReporting/bugReport.test.ts`


### 5. Environment Variables

No new environment variables were required for Day 1 — bug reporting uses the existing database connection and the existing generic upload endpoint's configuration.

```dotenv
# packages/database/.env
DATABASE_URL=postgresql://postgres:root@localhost:5432/funtush?schema=public
```


### 6. Useful Commands

```powershell
# Run dev server
pnpm run dev

# Run migrations
pnpm --filter @funtush/database prisma migrate dev

# Regenerate Prisma client
npx prisma generate

# Open Prisma Studio
npx prisma studio

# Run just the bug reporting tests
pnpm test bugReport.test.ts

# Run tests / lint across monorepo
pnpm test
pnpm lint
```

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { db } from '@funtush/database';
import { submitBug } from '../../services/bugReport.service';
import {
  setBugPriority,
  assignBug,
  addBugHint,
  resolveBug,
} from '../../services/bugReport.service';

// Isolate priority/assign/hint/resolve logic from real email/push delivery.
vi.mock('../../services/notificationService', () => ({
  notificationService: {
    sendEmailNotification: vi.fn(async () => ({ success: true })),
    sendNotification: vi.fn(async () => ({ success: true, method: 'push' })),
  },
}));

import { notificationService } from '../../services/notificationService';

describe('DAY 2: Bug Workflow & Hints', () => {
  const mockAgencyId = 'agency_bugworkflow_' + Date.now();
  const mockTierId = 'tier_bugworkflow_' + Date.now();
  const platformAdminId = 'user_platformadmin_' + Date.now();
  const platformSupportId = 'user_platformsupport_' + Date.now();
  const agencyAdminUserId = 'user_agencyadmin_' + Date.now();

  async function createBug(overrides: Partial<Parameters<typeof submitBug>[1]> = {}) {
    return submitBug(mockAgencyId, {
      title: 'Something broke',
      description: 'Detailed description of the issue',
      ...overrides,
    });
  }

  beforeAll(async () => {
    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'BugWorkflow Tier ' + Date.now(),
        maxStaff: 10,
        maxGuides: 5,
        monthlyPrice: 2000,
        features: JSON.stringify(['bugs']),
      },
    });

    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'BugWorkflow Test Agency',
        email: 'bugworkflow_' + Date.now() + '@test.com',
        slug: 'bugworkflow-agency-' + Date.now(),
        tierId: mockTierId,
      },
    });

    // Platform staff — assignees for bugs.
    await db.user.create({
      data: {
        id: platformAdminId,
        email: 'platformadmin_' + Date.now() + '@test.com',
        passwordHash: 'not-a-real-hash',
        role: 'PLATFORM_ADMIN',
        roleType: 'PLATFORM',
      },
    });

    await db.user.create({
      data: {
        id: platformSupportId,
        email: 'platformsupport_' + Date.now() + '@test.com',
        passwordHash: 'not-a-real-hash',
        role: 'PLATFORM_SUPPORT',
        roleType: 'PLATFORM',
      },
    });

    // Agency-side admin user — resolve() should look this up via AgencyUser for push.
    await db.user.create({
      data: {
        id: agencyAdminUserId,
        email: 'agencyadmin_' + Date.now() + '@test.com',
        passwordHash: 'not-a-real-hash',
        role: 'AGENCY_ADMIN',
        roleType: 'TENANT',
        fcmToken: 'mock-fcm-token-123',
      },
    });

    await db.agencyUser.create({
      data: {
        agencyId: mockAgencyId,
        userId: agencyAdminUserId,
        role: 'AGENCY_ADMIN',
      },
    });
  });

  afterAll(async () => {
    await db.bugHint.deleteMany({ where: { bugReport: { agencyId: mockAgencyId } } });
    await db.bugReport.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.agencyUser.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.user.deleteMany({
      where: { id: { in: [platformAdminId, platformSupportId, agencyAdminUserId] } },
    });
    await db.agency.deleteMany({ where: { id: mockAgencyId } });
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
  });

  beforeEach(() => {
    vi.mocked(notificationService.sendEmailNotification).mockClear();
    vi.mocked(notificationService.sendNotification).mockClear();
  });

  describe('setBugPriority', () => {
    it('sets priority on an existing bug', async () => {
      const bug = await createBug();
      const updated = await setBugPriority(bug.id, 'CRITICAL');

      expect(updated.priority).toBe('CRITICAL');
    });

    it('throws for a non-existent bug', async () => {
      await expect(setBugPriority('does-not-exist', 'HIGH')).rejects.toThrow('not found');
    });
  });

  describe('assignBug', () => {
    it('assigns a bug to a platform admin', async () => {
      const bug = await createBug();
      const updated = await assignBug(bug.id, platformAdminId);

      expect(updated.assignedToId).toBe(platformAdminId);
    });

    it('assigns a bug to platform support', async () => {
      const bug = await createBug();
      const updated = await assignBug(bug.id, platformSupportId);

      expect(updated.assignedToId).toBe(platformSupportId);
    });

    it('moves a REPORTED bug to IN_PROGRESS on assignment', async () => {
      const bug = await createBug();
      expect(bug.status).toBe('REPORTED');

      const updated = await assignBug(bug.id, platformAdminId);

      expect(updated.status).toBe('IN_PROGRESS');
    });

    it('does not downgrade status if the bug is already RESOLVED', async () => {
      const bug = await createBug();
      await resolveBug(bug.id, 'Fixed in latest deploy');

      const updated = await assignBug(bug.id, platformAdminId);

      expect(updated.status).toBe('RESOLVED');
    });

    it('rejects assigning to a non-platform (tenant) user', async () => {
      const bug = await createBug();

      await expect(assignBug(bug.id, agencyAdminUserId)).rejects.toThrow(
        'platform staff'
      );
    });

    it('throws when the assignee does not exist', async () => {
      const bug = await createBug();

      await expect(assignBug(bug.id, 'does-not-exist')).rejects.toThrow('Assignee not found');
    });

    it('throws for a non-existent bug', async () => {
      await expect(assignBug('does-not-exist', platformAdminId)).rejects.toThrow('not found');
    });
  });

  describe('addBugHint', () => {
    it('attaches a hint to a bug', async () => {
      const bug = await createBug();
      const hint = await addBugHint(bug.id, platformAdminId, 'Try clearing your cache first');

      expect(hint.note).toBe('Try clearing your cache first');
      expect(hint.bugReportId).toBe(bug.id);
      expect(hint.createdById).toBe(platformAdminId);
    });

    it('notifies the agency by email when a hint is added', async () => {
      const bug = await createBug();
      await addBugHint(bug.id, platformAdminId, 'Workaround: refresh the page');

      expect(notificationService.sendEmailNotification).toHaveBeenCalledTimes(1);
      const [to] = vi.mocked(notificationService.sendEmailNotification).mock.calls[0];
      expect(to).toContain('@');
    });

    it('rejects an empty hint note', async () => {
      const bug = await createBug();
      await expect(addBugHint(bug.id, platformAdminId, '')).rejects.toThrow(
        'hint note is required'
      );
    });

    it('supports multiple hints on the same bug', async () => {
      const bug = await createBug();
      await addBugHint(bug.id, platformAdminId, 'First tip');
      await addBugHint(bug.id, platformSupportId, 'Second tip');

      const hints = await db.bugHint.findMany({ where: { bugReportId: bug.id } });
      expect(hints).toHaveLength(2);
    });

    it('throws for a non-existent bug', async () => {
      await expect(
        addBugHint('does-not-exist', platformAdminId, 'A hint')
      ).rejects.toThrow('not found');
    });
  });

  describe('resolveBug', () => {
    it('resolves a bug with a resolution note', async () => {
      const bug = await createBug();
      const resolved = await resolveBug(bug.id, 'Fixed by clearing stale cache config');

      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.resolutionNote).toBe('Fixed by clearing stale cache config');
    });

    it('rejects an empty resolution note', async () => {
      const bug = await createBug();
      await expect(resolveBug(bug.id, '')).rejects.toThrow('resolution note is required');
    });

    it('rejects resolving an already-resolved bug', async () => {
      const bug = await createBug();
      await resolveBug(bug.id, 'First resolution');

      await expect(resolveBug(bug.id, 'Second attempt')).rejects.toThrow('already resolved');
    });

    it('throws for a non-existent bug', async () => {
      await expect(resolveBug('does-not-exist', 'Fixed')).rejects.toThrow('not found');
    });

    it('sends an email notification to the agency on resolution', async () => {
      const bug = await createBug();
      await resolveBug(bug.id, 'Root cause fixed');

      expect(notificationService.sendEmailNotification).toHaveBeenCalledTimes(1);
    });

    it('sends a push notification to the agency admin when an fcmToken is on record', async () => {
      const bug = await createBug();
      await resolveBug(bug.id, 'Root cause fixed');

      expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
      const [, pushToken] = vi.mocked(notificationService.sendNotification).mock.calls[0];
      expect(pushToken).toBe('mock-fcm-token-123');
    });
  });
});
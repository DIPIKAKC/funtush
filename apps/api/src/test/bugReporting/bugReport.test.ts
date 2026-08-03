import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@funtush/database';
import { submitBug, getAgencyBugs } from '../../services/bugReport.service';

describe('DAY 1: Bug Reporting', () => {
  const mockAgencyId = 'agency_bugtest_' + Date.now();
  const otherAgencyId = 'agency_bugtest_other_' + Date.now();
  const mockTierId = 'tier_bugtest_' + Date.now();

  beforeAll(async () => {
    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'BugTest Tier ' + Date.now(),
        maxStaff: 10,
        maxGuides: 5,
        monthlyPrice: 2000,
        features: JSON.stringify(['bugs']),
      },
    });

    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'BugTest Agency',
        email: 'bugtest_' + Date.now() + '@test.com',
        slug: 'bugtest-agency-' + Date.now(),
        tierId: mockTierId,
      },
    });

    await db.agency.create({
      data: {
        id: otherAgencyId,
        name: 'BugTest Other Agency',
        email: 'bugtest_other_' + Date.now() + '@test.com',
        slug: 'bugtest-other-agency-' + Date.now(),
        tierId: mockTierId,
      },
    });
  });

  afterAll(async () => {
    await db.bugReport.deleteMany({
      where: { agencyId: { in: [mockAgencyId, otherAgencyId] } },
    });
    await db.agency.deleteMany({ where: { id: { in: [mockAgencyId, otherAgencyId] } } });
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
  });

  describe('submitBug', () => {
    it('creates a bug report with status REPORTED', async () => {
      const bug = await submitBug(mockAgencyId, {
        title: 'Booking page crashes',
        description: 'Clicking confirm throws a 500 error',
        stepsToReproduce: '1. Go to booking page 2. Click confirm',
      });

      expect(bug.status).toBe('REPORTED');
      expect(bug.agencyId).toBe(mockAgencyId);
      expect(bug.title).toBe('Booking page crashes');
      expect(bug.priority).toBeNull();
      expect(bug.resolutionNote).toBeNull();
    });

    it('stores an optional screenshot URL when provided', async () => {
      const bug = await submitBug(mockAgencyId, {
        title: 'Broken image on dashboard',
        description: 'Logo does not render',
        screenshotUrl: 'https://cdn.example.com/screenshots/abc123.png',
      });

      expect(bug.screenshotUrl).toBe('https://cdn.example.com/screenshots/abc123.png');
    });

    it('rejects a bug report with an empty title', async () => {
      await expect(
        submitBug(mockAgencyId, { title: '', description: 'Some description' })
      ).rejects.toThrow('title is required');
    });

    it('rejects a bug report with an empty description', async () => {
      await expect(
        submitBug(mockAgencyId, { title: 'Some title', description: '' })
      ).rejects.toThrow('description is required');
    });

    it('trims whitespace from title and description', async () => {
      const bug = await submitBug(mockAgencyId, {
        title: '  Extra spaces bug  ',
        description: '  padded description  ',
      });

      expect(bug.title).toBe('Extra spaces bug');
      expect(bug.description).toBe('padded description');
    });
  });

  describe('getAgencyBugs', () => {
    it('only returns bugs belonging to the requesting agency (tenant isolation)', async () => {
      await submitBug(otherAgencyId, {
        title: 'Bug from a different agency',
        description: 'Should never appear in mockAgencyId results',
      });

      const result = await getAgencyBugs(mockAgencyId);

      expect(result.items.every((b) => b.agencyId === mockAgencyId)).toBe(true);
      expect(result.items.some((b) => b.title === 'Bug from a different agency')).toBe(false);
    });

    it('returns bugs ordered newest first', async () => {
      const first = await submitBug(mockAgencyId, {
        title: 'Older bug',
        description: 'Created first',
      });
      const second = await submitBug(mockAgencyId, {
        title: 'Newer bug',
        description: 'Created second',
      });

      const result = await getAgencyBugs(mockAgencyId);

      const firstIndex = result.items.findIndex((b) => b.id === first.id);
      const secondIndex = result.items.findIndex((b) => b.id === second.id);

      expect(secondIndex).toBeLessThan(firstIndex);
    });

    it('paginates results correctly', async () => {
      const page1 = await getAgencyBugs(mockAgencyId, undefined, 1, 2);
      const page2 = await getAgencyBugs(mockAgencyId, undefined, 2, 2);

      expect(page1.items.length).toBeLessThanOrEqual(2);
      expect(page1.page).toBe(1);
      expect(page2.page).toBe(2);

      const page1Ids = page1.items.map((b) => b.id);
      const page2Ids = page2.items.map((b) => b.id);
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    });

    it('filters by status when provided', async () => {
      const bug = await submitBug(mockAgencyId, {
        title: 'Bug for status filter test',
        description: 'Should be REPORTED by default',
      });

      const reported = await getAgencyBugs(mockAgencyId, 'REPORTED');
      const resolved = await getAgencyBugs(mockAgencyId, 'RESOLVED');

      expect(reported.items.some((b) => b.id === bug.id)).toBe(true);
      expect(resolved.items.some((b) => b.id === bug.id)).toBe(false);
    });

    it('returns an empty list for an agency with no bugs', async () => {
      const freshAgencyId = 'agency_bugtest_empty_' + Date.now();
      const result = await getAgencyBugs(freshAgencyId);

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
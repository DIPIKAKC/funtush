import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@funtush/database';
import { createApiKey, listApiKeys, revokeApiKey, authenticateApiKey, ApiKeyError } from '../../services/apiKey.service';
import { ensureLargeTier } from './largeTier';

describe('API Key Integration Tests', () => {
  const mockTierId = 'tier_int_' + Date.now();
  const mockAgencyId = 'agency_int_' + Date.now();
  const userId = 'user_int_' + Date.now();

  /** Resolved in `beforeAll` — see `ensureLargeTier` for why it is shared. */
  let largeTierId: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-jwt-access-secret-integration-tests';
    process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-integration-tests';

    // The LARGE tier is a single, unique, seeded row that this file shares with
    // `apiKey.service.test.ts`. Reuse it rather than deleting and recreating it
    // — see `largeTier.ts` for the full explanation.
    largeTierId = await ensureLargeTier(mockTierId);

    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'Integration Test Agency',
        email: 'inttest_' + Date.now() + '@test.com',
        slug: 'int-test-' + Date.now(),
        tierId: largeTierId,
      },
    });

    await db.user.create({
      data: {
        id: userId,
        email: 'intuser_' + Date.now() + '@test.com',
        passwordHash: 'not-a-real-hash',
        role: 'AGENCY_ADMIN',
        roleType: 'TENANT',
      },
    });

    await db.agencyUser.create({
      data: {
        agencyId: mockAgencyId,
        userId,
        role: 'AGENCY_ADMIN',
      },
    });


  });

  afterAll(async () => {
    await db.apiKey.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.agencyUser.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.agency.deleteMany({ where: { id: mockAgencyId } });
    // The LARGE tier is deliberately NOT deleted: it is shared with
    // `apiKey.service.test.ts` and is seeded by `prisma/seed.ts`.
    // Deleting it is what broke this suite. See `largeTier.ts`.
  });

  describe('API Key Service Integration', () => {
    it('creates, lists, and revokes API keys', async () => {
      const created = await createApiKey(mockAgencyId, 'Integration Test Key', 'READ_WRITE');
      expect(created.id).toBeDefined();
      expect(created.key).toMatch(/^funtush_live_/);

      const listed = await listApiKeys(mockAgencyId);
      const listedKey = listed.find(k => k.id === created.id);
      expect(listedKey).toBeDefined();

      const revoked = await revokeApiKey(created.id, mockAgencyId);
      expect(revoked.revoked).toBe(true);

      const auth = await authenticateApiKey(created.key);
      expect(auth).toBeNull();
    });

    it('enforces tier restrictions', async () => {
      const starterTierId = 'tier_starter_' + Date.now();
      const starterAgencyId = 'agency_starter_' + Date.now();

      await db.subscriptionTier.create({
        data: {
          id: starterTierId,
          name: 'STARTER',
          maxStaff: 5,
          maxGuides: 2,
          monthlyPrice: 500,
          features: JSON.stringify([]),
        },
      });

      await db.agency.create({
        data: {
          id: starterAgencyId,
          name: 'Starter Agency',
          email: 'starter_' + Date.now() + '@test.com',
          slug: 'starter-' + Date.now(),
          tierId: starterTierId,
        },
      });

      try {
        await createApiKey(starterAgencyId, 'Should Fail', 'READ_ONLY');
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as ApiKeyError).status).toBe(403);
      }

      await db.agency.deleteMany({ where: { id: starterAgencyId } });
      await db.subscriptionTier.deleteMany({ where: { id: starterTierId } });
    });

    it('authenticates keys and updates lastUsedAt', async () => {
      const key = await createApiKey(mockAgencyId, 'LastUsed Test', 'READ_ONLY');
      const before = await db.apiKey.findUnique({ where: { id: key.id } });
      expect(before?.lastUsedAt).toBeNull();

      const auth = await authenticateApiKey(key.key);
      expect(auth).not.toBeNull();
      expect(auth?.scope).toBe('READ_ONLY');

      const after = await db.apiKey.findUnique({ where: { id: key.id } });
      expect(after?.lastUsedAt).not.toBeNull();
    });

    it('respects scope restrictions', async () => {
      const roKey = await createApiKey(mockAgencyId, 'ReadOnly', 'READ_ONLY');
      const rwKey = await createApiKey(mockAgencyId, 'ReadWrite', 'READ_WRITE');

      const roAuth = await authenticateApiKey(roKey.key);
      expect(roAuth?.scope).toBe('READ_ONLY');

      const rwAuth = await authenticateApiKey(rwKey.key);
      expect(rwAuth?.scope).toBe('READ_WRITE');
    });

    it('rejects invalid keys', async () => {
      const auth = await authenticateApiKey('funtush_live_invalid_key');
      expect(auth).toBeNull();
    });

    it('prevents cross-agency key revocation', async () => {
      const key = await createApiKey(mockAgencyId, 'My Key', 'READ_ONLY');
      try {
        await revokeApiKey(key.id, 'other-agency');
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as ApiKeyError).status).toBe(403);
      }
    });
  });
});
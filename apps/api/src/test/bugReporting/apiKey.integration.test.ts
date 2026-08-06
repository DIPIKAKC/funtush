import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@funtush/database';
import { generateAccessToken } from '@funtush/auth';
import { createApiKey, listApiKeys, revokeApiKey, authenticateApiKey, ApiKeyError } from '../../services/apiKey.service';

describe('API Key Integration Tests', () => {
  const mockTierId = 'tier_int_' + Date.now();
  const mockAgencyId = 'agency_int_' + Date.now();
  const userId = 'user_int_' + Date.now();

  let authToken: string;
  let createdKeyId: string;
  let createdRawKey: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-jwt-access-secret-integration-tests';
    process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-integration-tests';

    const largeTier = await db.subscriptionTier.findFirst({ where: { name: 'LARGE' } });
    if (largeTier) {
      await db.agency.deleteMany({ where: { tierId: largeTier.id } });
      await db.subscriptionTier.delete({ where: { id: largeTier.id } });
    }

    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'LARGE',
        maxStaff: 50,
        maxGuides: 25,
        monthlyPrice: 5000,
        features: JSON.stringify(['bugs', 'api_keys']),
      },
    });

    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'Integration Test Agency',
        email: 'inttest_' + Date.now() + '@test.com',
        slug: 'int-test-' + Date.now(),
        tierId: mockTierId,
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

    authToken = generateAccessToken({
      userId,
      agencyId: mockAgencyId,
      role: 'AGENCY_ADMIN',
      roleType: 'TENANT'
    });
  });

  afterAll(async () => {
    await db.apiKey.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.agencyUser.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.agency.deleteMany({ where: { id: mockAgencyId } });
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
  });

  describe('API Key Service Integration', () => {
    it('creates, lists, and revokes API keys', async () => {
      const created = await createApiKey(mockAgencyId, 'Integration Test Key', 'READ_WRITE');
      expect(created.id).toBeDefined();
      expect(created.key).toMatch(/^funtush_live_/);

      createdKeyId = created.id;
      createdRawKey = created.key;

      const listed = await listApiKeys(mockAgencyId);
      const listedKey = listed.find(k => k.id === created.id);
      expect(listedKey).toBeDefined();

      const revoked = await revokeApiKey(created.id, mockAgencyId);
      expect(revoked.revoked).toBe(true);

      const auth = await authenticateApiKey(createdRawKey);
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
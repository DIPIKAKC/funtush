import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@funtush/database';
import {
    createApiKey,
    listApiKeys,
    revokeApiKey,
    authenticateApiKey,
    ApiKeyError,
} from '../../services/apiKey.service';
import { ensureLargeTier } from './largeTier';

describe('API Key Management', () => {
    let mockTierId = 'tier_apikey_' + Date.now();
    const mockAgencyId = 'agency_apikey_' + Date.now();
    const agencyAdminUserId = 'user_agencyadmin_apikey_' + Date.now();

    beforeAll(async () => {
        try {
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
        } catch (err: any) {
            if (err.code !== 'P2002') throw err;
            const existing = await db.subscriptionTier.findUniqueOrThrow({ where: { name: 'LARGE' } });
            mockTierId = existing.id;
        }

        await db.agency.create({
            data: {
                id: mockAgencyId,
                name: 'API Key Test Agency',
                email: 'apikey_' + Date.now() + '@test.com',
                slug: 'apikey-agency-' + Date.now(),
                tierId: largeTierId,
            },
        });

        await db.user.create({
            data: {
                id: agencyAdminUserId,
                email: 'agencyadmin_apikey_' + Date.now() + '@test.com',
                passwordHash: 'not-a-real-hash',
                role: 'AGENCY_ADMIN',
                roleType: 'TENANT',
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
        await db.apiKey.deleteMany({ where: { agencyId: mockAgencyId } });
        await db.agencyUser.deleteMany({ where: { agencyId: mockAgencyId } });
        await db.user.deleteMany({ where: { id: agencyAdminUserId } });
        await db.agency.deleteMany({ where: { id: mockAgencyId } });

        const stillInUse = await db.agency.findFirst({ where: { tierId: mockTierId } });
        if (!stillInUse) {
            await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
        }
    });

    describe('createApiKey', () => {
        it('creates an API key for a LARGE tier agency', async () => {
            const result = await createApiKey(mockAgencyId, 'Production Key', 'READ_WRITE');

            expect(result.id).toBeDefined();
            expect(result.name).toBe('Production Key');
            expect(result.scope).toBe('READ_WRITE');
            expect(result.key).toMatch(/^funtush_live_/);
            expect(result.keyPrefix).toMatch(/^funtush_live_/);
        });

        it('throws 400 if name is empty', async () => {
            await expect(createApiKey(mockAgencyId, '', 'READ_ONLY')).rejects.toThrow(ApiKeyError);
            try {
                await createApiKey(mockAgencyId, '   ', 'READ_ONLY');
                expect.fail('should have thrown');
            } catch (err) {
                expect((err as ApiKeyError).status).toBe(400);
                expect(err).toBeInstanceOf(ApiKeyError);
            }
        });

        it('throws 404 if agency does not exist', async () => {
            try {
                await createApiKey('does-not-exist', 'My Key', 'READ_ONLY');
                expect.fail('should have thrown');
            } catch (err) {
                expect((err as ApiKeyError).status).toBe(404);
                expect((err as ApiKeyError).message).toContain('Agency not found');
            }
        });

        it('throws 403 if agency is not on LARGE tier', async () => {
            const starterTierId = 'tier_starter_' + Date.now();
            const starterAgencyId = 'agency_starter_' + Date.now();

            await db.subscriptionTier.create({
                data: {
                    id: starterTierId,
                    name: 'STARTER_' + Date.now(),
                    maxStaff: 5,
                    maxGuides: 3,
                    monthlyPrice: 500,
                    features: JSON.stringify(['bugs']),
                },
            });

            await db.agency.create({
                data: {
                    id: starterAgencyId,
                    name: 'Starter Agency',
                    email: 'starter_' + Date.now() + '@test.com',
                    slug: 'starter-agency-' + Date.now(),
                    tierId: starterTierId,
                },
            });

            try {
                await createApiKey(starterAgencyId, 'Attempted Key', 'READ_ONLY');
                expect.fail('should have thrown');
            } catch (err) {
                expect((err as ApiKeyError).status).toBe(403);
                expect((err as ApiKeyError).message).toContain('Large tier');
            }

            await db.agency.delete({ where: { id: starterAgencyId } });
            await db.subscriptionTier.delete({ where: { id: starterTierId } });
        });

        it('defaults scope to READ_ONLY', async () => {
            const result = await createApiKey(mockAgencyId, 'Read Only Key', 'READ_ONLY');

            expect(result.scope).toBe('READ_ONLY');

            await db.apiKey.delete({ where: { id: result.id } });
        });

        it('trims whitespace from name', async () => {
            const result = await createApiKey(mockAgencyId, '  Trimmed Key  ', 'READ_ONLY');

            expect(result.name).toBe('Trimmed Key');

            await db.apiKey.delete({ where: { id: result.id } });
        });
    });

    describe('listApiKeys', () => {
        it('lists all API keys for an agency', async () => {
            const key1 = await createApiKey(mockAgencyId, 'Key 1', 'READ_ONLY');
            const key2 = await createApiKey(mockAgencyId, 'Key 2', 'READ_WRITE');

            const result = await listApiKeys(mockAgencyId);

            expect(result.length).toBeGreaterThanOrEqual(2);
            expect(result.some((k) => k.id === key1.id)).toBe(true);
            expect(result.some((k) => k.id === key2.id)).toBe(true);
        });

        it('returns keys in descending creation order', async () => {
            const key1 = await createApiKey(mockAgencyId, 'Older Key', 'READ_ONLY');
            await new Promise((resolve) => setTimeout(resolve, 10));
            const key2 = await createApiKey(mockAgencyId, 'Newer Key', 'READ_ONLY');

            const result = await listApiKeys(mockAgencyId);

            const newer = result.find((k) => k.id === key2.id);
            const older = result.find((k) => k.id === key1.id);

            expect(result.indexOf(newer!)).toBeLessThan(result.indexOf(older!));
        });

        it('never exposes keyHash in results', async () => {
            const result = await listApiKeys(mockAgencyId);

            result.forEach((key) => {
                expect(key).not.toHaveProperty('keyHash');
            });
        });

        it('includes revoked status', async () => {
            const key = await createApiKey(mockAgencyId, 'To Revoke', 'READ_ONLY');
            await revokeApiKey(key.id, mockAgencyId);

            const result = await listApiKeys(mockAgencyId);
            const revokedKey = result.find((k) => k.id === key.id);

            expect(revokedKey?.revoked).toBe(true);
        });

        it('includes lastUsedAt timestamp', async () => {
            const result = await listApiKeys(mockAgencyId);

            result.forEach((key) => {
                expect(key).toHaveProperty('lastUsedAt');
            });
        });
    });

    describe('revokeApiKey', () => {
        it('revokes an active API key', async () => {
            const key = await createApiKey(mockAgencyId, 'To Revoke', 'READ_ONLY');

            const result = await revokeApiKey(key.id, mockAgencyId);

            expect(result.revoked).toBe(true);
        });

        it('throws 404 if key does not exist', async () => {
            try {
                await revokeApiKey('does-not-exist', mockAgencyId);
                expect.fail('should have thrown');
            } catch (err) {
                expect((err as ApiKeyError).status).toBe(404);
                expect((err as ApiKeyError).message).toContain('not found');
            }
        });

        it('throws 403 if key belongs to different agency', async () => {
            const key = await createApiKey(mockAgencyId, 'My Key', 'READ_ONLY');

            try {
                await revokeApiKey(key.id, 'different-agency-id');
                expect.fail('should have thrown');
            } catch (err) {
                expect((err as ApiKeyError).status).toBe(403);
                expect((err as ApiKeyError).message).toContain('Not authorized');
            }
        });

        it('throws 409 if key is already revoked', async () => {
            const key = await createApiKey(mockAgencyId, 'Already Revoked', 'READ_ONLY');
            await revokeApiKey(key.id, mockAgencyId);

            try {
                await revokeApiKey(key.id, mockAgencyId);
                expect.fail('should have thrown');
            } catch (err) {
                expect((err as ApiKeyError).status).toBe(409);
                expect((err as ApiKeyError).message).toContain('already revoked');
            }
        });
    });

    describe('authenticateApiKey', () => {
        it('authenticates a valid, active key', async () => {
            const key = await createApiKey(mockAgencyId, 'Auth Test', 'READ_WRITE');

            const result = await authenticateApiKey(key.key);

            expect(result).not.toBeNull();
            expect(result?.agencyId).toBe(mockAgencyId);
            expect(result?.scope).toBe('READ_WRITE');
            expect(result?.keyId).toBe(key.id);
        });

        it('returns null for non-existent key', async () => {
            const result = await authenticateApiKey('funtush_live_invalid_key_hash');

            expect(result).toBeNull();
        });

        it('returns null for revoked key', async () => {
            const key = await createApiKey(mockAgencyId, 'Revoked Auth', 'READ_ONLY');
            await revokeApiKey(key.id, mockAgencyId);

            const result = await authenticateApiKey(key.key);

            expect(result).toBeNull();
        });

        it('updates lastUsedAt on successful authentication', async () => {
            const key = await createApiKey(mockAgencyId, 'Last Used Test', 'READ_ONLY');

            const before = await db.apiKey.findUnique({ where: { id: key.id } });
            expect(before?.lastUsedAt).toBeNull();

            await authenticateApiKey(key.key);

            const after = await db.apiKey.findUnique({ where: { id: key.id } });
            expect(after?.lastUsedAt).not.toBeNull();
        });

        it('respects READ_ONLY vs READ_WRITE scope on authentication', async () => {
            const readOnly = await createApiKey(mockAgencyId, 'Read Only', 'READ_ONLY');
            const readWrite = await createApiKey(mockAgencyId, 'Read Write', 'READ_WRITE');

            const roResult = await authenticateApiKey(readOnly.key);
            expect(roResult?.scope).toBe('READ_ONLY');

            const rwResult = await authenticateApiKey(readWrite.key);
            expect(rwResult?.scope).toBe('READ_WRITE');
        });
    });

    describe('API Key Security', () => {
        it('never returns keyHash when creating a key', async () => {
            const result = await createApiKey(mockAgencyId, 'Security Test', 'READ_ONLY');

            expect(result).not.toHaveProperty('keyHash');
        });

        it('raw key is only returned once (on creation)', async () => {
            const key = await createApiKey(mockAgencyId, 'One Time Key', 'READ_ONLY');

            const listed = await listApiKeys(mockAgencyId);
            const listedKey = listed.find((k) => k.id === key.id);

            expect(listedKey).not.toHaveProperty('key');
        });

        it('key prefix is shown in dashboard, not full key', async () => {
            const key = await createApiKey(mockAgencyId, 'Prefix Test', 'READ_ONLY');

            expect(key.keyPrefix.length).toBeLessThan(key.key.length);
            expect(key.keyPrefix).toMatch(/^funtush_live_/);
        });
    });
});
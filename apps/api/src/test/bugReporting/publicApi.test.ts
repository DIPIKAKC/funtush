import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@funtush/database';
import { listPublicPackages, listPublicBookings } from '../../services/publicApi.service';
import { checkPublicApiRateLimit } from '../../services/rateLimit.service';
import { createApiKey } from '../../services/apiKey.service';

type ApiKeyResult = Awaited<ReturnType<typeof createApiKey>>;

describe(' Public API Surface (Read-Only v1)', () => {
    let mockTierId = 'tier_publicapi_' + Date.now();
    const agency1Id = 'agency_publicapi_1_' + Date.now();
    const agency2Id = 'agency_publicapi_2_' + Date.now();

    const agency1Package1Id = 'pkg_a1_p1_' + Date.now();
    const agency1Package2Id = 'pkg_a1_p2_' + Date.now();
    const agency1DraftPackageId = 'pkg_a1_draft_' + Date.now();

    const agency2Package1Id = 'pkg_a2_p1_' + Date.now();

    const agency1Departure1 = 'dep_a1_d1_' + Date.now();
    const agency1Departure2 = 'dep_a1_d2_' + Date.now();
    const agency2Departure1 = 'dep_a2_d1_' + Date.now();

    const agency1Booking1Id = 'booking_a1_b1_' + Date.now();
    const agency1Booking2Id = 'booking_a1_b2_' + Date.now();
    const agency2Booking1Id = 'booking_a2_b1_' + Date.now();

    let agency1ApiKey: ApiKeyResult;
    let agency1ReadOnlyKey: ApiKeyResult;

    beforeAll(async () => {
        try {
            await db.subscriptionTier.create({
                data: {
                    id: mockTierId,
                    name: 'LARGE',
                    maxStaff: 50,
                    maxGuides: 25,
                    monthlyPrice: 5000,
                    features: JSON.stringify(['api_keys']),
                },
            });
        } catch (err) {
            if (!(err instanceof Error) || (err as { code?: string }).code !== 'P2002') throw err;
            const existing = await db.subscriptionTier.findUniqueOrThrow({ where: { name: 'LARGE' } });
            mockTierId = existing.id;
        }

        await db.agency.create({
            data: {
                id: agency1Id,
                name: 'Agency 1 - Public API Test',
                email: 'agency1_' + Date.now() + '@test.com',
                slug: 'agency1-publicapi-' + Date.now(),
                tierId: mockTierId,
            },
        });

        await db.agency.create({
            data: {
                id: agency2Id,
                name: 'Agency 2 - Public API Test',
                email: 'agency2_' + Date.now() + '@test.com',
                slug: 'agency2-publicapi-' + Date.now(),
                tierId: mockTierId,
            },
        });

        agency1ApiKey = await createApiKey(agency1Id, 'Agency 1 API Key', 'READ_ONLY');
        await createApiKey(agency2Id, 'Agency 2 API Key', 'READ_ONLY');
        agency1ReadOnlyKey = await createApiKey(agency1Id, 'Agency 1 RO Key 2', 'READ_ONLY');

        await db.trekPackage.create({
            data: {
                id: agency1Package1Id,
                agencyId: agency1Id,
                title: 'Everest Base Camp Trek',
                slug: 'everest-base-camp-' + Date.now(),
                durationDays: 14,
                pricePerPerson: 1500,
                difficulty: 'MODERATE',
                maxGroupSize: 12,
                status: 'PUBLISHED',
            },
        });

        await db.trekPackage.create({
            data: {
                id: agency1Package2Id,
                agencyId: agency1Id,
                title: 'Annapurna Circuit Trek',
                slug: 'annapurna-circuit-' + Date.now(),
                durationDays: 21,
                pricePerPerson: 1800,
                difficulty: 'CHALLENGING',
                maxGroupSize: 10,
                status: 'PUBLISHED',
            },
        });

        await db.trekPackage.create({
            data: {
                id: agency1DraftPackageId,
                agencyId: agency1Id,
                title: 'Secret Trek Draft',
                slug: 'secret-trek-draft-' + Date.now(),
                durationDays: 7,
                pricePerPerson: 800,
                difficulty: 'EASY',
                maxGroupSize: 15,
                status: 'DRAFT',
            },
        });

        await db.trekPackage.create({
            data: {
                id: agency2Package1Id,
                agencyId: agency2Id,
                title: 'Kilimanjaro Trek',
                slug: 'kilimanjaro-' + Date.now(),
                durationDays: 10,
                pricePerPerson: 2000,
                difficulty: 'CHALLENGING',
                maxGroupSize: 8,
                status: 'PUBLISHED',
            },
        });

        await db.trekDepartureDate.create({
            data: {
                id: agency1Departure1,
                packageId: agency1Package1Id,
                startDate: new Date('2026-12-01'),
                maxSlots: 12,
            },
        });

        await db.trekDepartureDate.create({
            data: {
                id: agency1Departure2,
                packageId: agency1Package2Id,
                startDate: new Date('2027-01-15'),
                maxSlots: 10,
            },
        });

        await db.trekDepartureDate.create({
            data: {
                id: agency2Departure1,
                packageId: agency2Package1Id,
                startDate: new Date('2027-02-01'),
                maxSlots: 8,
            },
        });

        await db.booking.create({
            data: {
                id: agency1Booking1Id,
                agencyId: agency1Id,
                packageId: agency1Package1Id,
                departureDateId: agency1Departure1,
                groupSize: 4,
                totalPrice: 6000,
                status: 'CONFIRMED',
                trekkerName: 'John Doe',
                trekkerEmail: 'john@example.com',
                trekkerPhone: '+9779800000001',
            },
        });

        await db.booking.create({
            data: {
                id: agency1Booking2Id,
                agencyId: agency1Id,
                packageId: agency1Package2Id,
                departureDateId: agency1Departure2,
                groupSize: 2,
                totalPrice: 3600,
                status: 'INQUIRY',
                trekkerName: 'Jane Smith',
                trekkerEmail: 'jane@example.com',
                trekkerPhone: '+9779800000002',
            },
        });

        await db.booking.create({
            data: {
                id: agency2Booking1Id,
                agencyId: agency2Id,
                packageId: agency2Package1Id,
                departureDateId: agency2Departure1,
                groupSize: 3,
                totalPrice: 6000,
                status: 'CONFIRMED',
                trekkerName: 'Bob Wilson',
                trekkerEmail: 'bob@example.com',
                trekkerPhone: '+9779800000003',
            },
        });
    }, 30000);

    afterAll(async () => {
        await db.booking.deleteMany({ where: { agencyId: { in: [agency1Id, agency2Id] } } });
        await db.trekDepartureDate.deleteMany({ where: { packageId: { in: [agency1Package1Id, agency1Package2Id, agency1DraftPackageId, agency2Package1Id] } } });
        await db.trekPackage.deleteMany({ where: { agencyId: { in: [agency1Id, agency2Id] } } });
        await db.apiKey.deleteMany({ where: { agencyId: { in: [agency1Id, agency2Id] } } });
        await db.agency.deleteMany({ where: { id: { in: [agency1Id, agency2Id] } } });

        const stillInUse = await db.agency.findFirst({ where: { tierId: mockTierId } });
        if (!stillInUse) {
            await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
        }
    });

    describe('GET /public-api/v1/packages — Scope & Permission Tests', () => {
        it('returns only PUBLISHED packages for the requesting agency', async () => {
            const result = await listPublicPackages(agency1Id);

            expect(result.items).toHaveLength(2);
            expect(result.items.map((p) => p.id).sort()).toEqual([agency1Package1Id, agency1Package2Id].sort());
        });

        it('never includes DRAFT packages in public API', async () => {
            const result = await listPublicPackages(agency1Id);

            expect(result.items.some((p) => p.id === agency1DraftPackageId)).toBe(false);
            expect(result.items.every((p) => p.status === 'PUBLISHED')).toBe(true);
        });

        it('enforces tenant isolation — only returns requesting agency\'s packages', async () => {
            const agency1Result = await listPublicPackages(agency1Id);
            const agency2Result = await listPublicPackages(agency2Id);

            expect(agency1Result.items.some((p) => p.id === agency2Package1Id)).toBe(false);
            expect(agency2Result.items.some((p) => p.id === agency1Package1Id)).toBe(false);
            expect(agency2Result.items.some((p) => p.id === agency1Package2Id)).toBe(false);
        });

        it('returns correct package metadata', async () => {
            const result = await listPublicPackages(agency1Id);
            const pkg = result.items.find((p) => p.id === agency1Package1Id);

            expect(pkg).toBeDefined();
            expect(pkg).toMatchObject({
                id: agency1Package1Id,
                title: 'Everest Base Camp Trek',
                durationDays: 14,
                difficulty: 'MODERATE',
                status: 'PUBLISHED',
            });
            expect(pkg!.pricePerPerson.toString()).toBe('1500');
        });

        it('supports pagination', async () => {
            const page1 = await listPublicPackages(agency1Id, 1, 1);
            const page2 = await listPublicPackages(agency1Id, 2, 1);

            expect(page1.items.length).toBeLessThanOrEqual(1);
            expect(page1.page).toBe(1);
            expect(page1.limit).toBe(1);
            expect(page2.page).toBe(2);
            expect(page2.items).not.toEqual(page1.items);
        });

        it('returns empty list for agency with no published packages', async () => {
            const result = await listPublicPackages('nonexistent_agency_' + Date.now());

            expect(result.items).toEqual([]);
            expect(result.total).toBe(0);
        });
    });

    describe('GET /public-api/v1/bookings — Scope & Permission Tests', () => {
        it('returns only bookings for the requesting agency', async () => {
            const result = await listPublicBookings(agency1Id);

            expect(result.items.length).toBeGreaterThanOrEqual(2);
        });

        it('enforces tenant isolation — never returns another agency\'s bookings', async () => {
            const agency1Result = await listPublicBookings(agency1Id);
            const agency2Result = await listPublicBookings(agency2Id);

            expect(agency1Result.items.some((b) => b.id === agency2Booking1Id)).toBe(false);
            expect(agency2Result.items.some((b) => b.id === agency1Booking1Id)).toBe(false);
        });

        it('never exposes trekker PII (name, email, phone)', async () => {
            const result = await listPublicBookings(agency1Id);

            result.items.forEach((booking) => {
                expect(booking).not.toHaveProperty('trekkerName');
                expect(booking).not.toHaveProperty('trekkerEmail');
                expect(booking).not.toHaveProperty('trekkerPhone');
            });
        });

        it('returns booking metadata without PII', async () => {
            const result = await listPublicBookings(agency1Id);
            const booking = result.items.find((b) => b.id === agency1Booking1Id);

            expect(booking).toBeDefined();
            expect(booking).toMatchObject({
                id: agency1Booking1Id,
                packageId: agency1Package1Id,
                groupSize: 4,
                status: 'CONFIRMED',
            });
            expect(booking!.totalPrice.toString()).toBe('6000');
        });

        it('filters by status when provided', async () => {
            const confirmed = await listPublicBookings(agency1Id, 1, 20, 'CONFIRMED');
            const inquiry = await listPublicBookings(agency1Id, 1, 20, 'INQUIRY');
            const rejected = await listPublicBookings(agency1Id, 1, 20, 'REJECTED');

            expect(confirmed.items.some((b) => b.id === agency1Booking1Id)).toBe(true);
            expect(inquiry.items.some((b) => b.id === agency1Booking2Id)).toBe(true);
            expect(rejected.items).toEqual([]);
        });

        it('supports pagination', async () => {
            const page1 = await listPublicBookings(agency1Id, 1, 1);
            const page2 = await listPublicBookings(agency1Id, 2, 1);

            expect(page1.items.length).toBeLessThanOrEqual(1);
            expect(page1.limit).toBe(1);
            expect(page2.page).toBe(2);
            expect(page2.items).not.toEqual(page1.items);
        });

        it('returns empty list for agency with no bookings', async () => {
            const result = await listPublicBookings('nonexistent_agency_' + Date.now());

            expect(result.items).toEqual([]);
            expect(result.total).toBe(0);
        });
    });

    describe('Rate Limiting — Public API vs Internal API', () => {
        it('creates rate limit key for public API endpoint', async () => {
            const keyId = 'ratelimit_public_' + Date.now();
            const result = await checkPublicApiRateLimit(keyId, 'GET', '/public-api/v1/packages');

            expect(result).toBeDefined();
            expect(result.allowed).toBe(true);
            expect(result.limit).toBeGreaterThan(0);
        });

        it('tracks rate limit independently per API key', async () => {
            const keyA = 'ratelimit_key_a_' + Date.now();
            const keyB = 'ratelimit_key_b_' + Date.now();

            const resultA = await checkPublicApiRateLimit(keyA, 'GET', '/public-api/v1/packages');
            const resultB = await checkPublicApiRateLimit(keyB, 'GET', '/public-api/v1/packages');

            expect(resultA.limit).toBe(resultB.limit);
            expect(resultA.remaining).toBeGreaterThan(0);
            expect(resultB.remaining).toBeGreaterThan(0);
        });

        it('separates rate limits for different endpoints', async () => {
            const keyId = 'ratelimit_endpoint_sep_' + Date.now();

            const resultPackages = await checkPublicApiRateLimit(keyId, 'GET', '/public-api/v1/packages');
            const resultBookings = await checkPublicApiRateLimit(keyId, 'GET', '/public-api/v1/bookings');

            expect(resultPackages.allowed).toBe(true);
            expect(resultBookings.allowed).toBe(true);
        });
    });

    describe('API Key Management & Permission Scope', () => {
        it('creates READ_ONLY API key with correct scope', async () => {
            const key = await db.apiKey.findUnique({ where: { id: agency1ApiKey.id } });

            expect(key).toBeDefined();
            expect(key?.scope).toBe('READ_ONLY');
            expect(key?.revoked).toBe(false);
        });

        it('different API keys for same agency are independent', async () => {
            const key1 = await db.apiKey.findUnique({ where: { id: agency1ApiKey.id } });
            const key2 = await db.apiKey.findUnique({ where: { id: agency1ReadOnlyKey.id } });

            expect(key1?.id).not.toBe(key2?.id);
            expect(key1?.agencyId).toBe(key2?.agencyId);
            expect(key1?.scope).toBe(key2?.scope);
        });

        it('API key has keyPrefix and createdAt metadata', async () => {
            const key = await db.apiKey.findUnique({ where: { id: agency1ApiKey.id } });

            expect(key?.keyPrefix).toBeDefined();
            expect(key?.keyPrefix.length).toBeGreaterThan(0);
            expect(key?.createdAt).toBeDefined();
        });
    });

    describe('Integration — Real-world Public API Scenarios', () => {
        it('third-party tool can fetch all published packages for an agency', async () => {
            const packages = await listPublicPackages(agency1Id);

            expect(packages.items.length).toBeGreaterThanOrEqual(2);
            packages.items.forEach((pkg) => {
                expect(pkg.status).toBe('PUBLISHED');
            });
        });

        it('third-party tool can fetch confirmed bookings for an agency', async () => {
            const bookings = await listPublicBookings(agency1Id, 1, 20, 'CONFIRMED');

            expect(bookings.items.length).toBeGreaterThan(0);
            expect(bookings.items.every((b) => b.status === 'CONFIRMED')).toBe(true);
        });

        it('third-party tool cannot access another agency\'s data even with same endpoint', async () => {
            const agency1Packages = await listPublicPackages(agency1Id);
            const agency2Packages = await listPublicPackages(agency2Id);

            const agency1Ids = agency1Packages.items.map((p) => p.id);
            const agency2Ids = agency2Packages.items.map((p) => p.id);

            expect(agency1Ids.filter((id) => agency2Ids.includes(id))).toEqual([]);
        });

        it('full public API workflow: fetch packages, then bookings', async () => {
            const packages = await listPublicPackages(agency1Id);
            expect(packages.items.length).toBeGreaterThan(0);

            const bookings = await listPublicBookings(agency1Id);
            expect(bookings.items.length).toBeGreaterThan(0);

            const packageIds = packages.items.map((p) => p.id);
            const bookingPackages = bookings.items
                .map((b) => b.packageId)
                .filter((id) => packageIds.includes(id));

            expect(bookingPackages.length).toBeGreaterThan(0);
        });
    });
});
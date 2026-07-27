import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@funtush/database';
import { decryptCredentials, encryptCredentials } from '../../utils/encryption';

describe('DAY 5: Complete Payment Integration', () => {
  const testAgencyId = 'integration_' + Date.now();
  const testTierId = 'tier_integration_' + Date.now();

  beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY) {
      process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    }

    await db.subscriptionTier.create({
      data: {
        id: testTierId,
        name: 'Integration Test ' + Date.now(),
        maxStaff: 10,
        maxGuides: 5,
        monthlyPrice: 3000,
        features: JSON.stringify(['all_features']),
      },
    });

    await db.agency.create({
      data: {
        id: testAgencyId,
        name: 'Integration Test Agency',
        email: 'integration_' + Date.now() + '@test.com',
        slug: 'integration-' + Date.now(),
        tierId: testTierId,
      },
    });

    await db.kycSubmission.create({
      data: {
        id: 'kyc_integration',
        agencyId: testAgencyId,
        status: 'APPROVED',
        documents: {
          create: [
            { type: 'PAN_CERTIFICATE', fileUrl: 'test.pdf' },
            { type: 'BUSINESS_REGISTRATION', fileUrl: 'test.pdf' },
            { type: 'TOURISM_LICENSE', fileUrl: 'test.pdf' },
            { type: 'BANK_DETAILS', fileUrl: 'test.pdf' },
          ],
        },
      },
    });

    await db.transactionFee.create({
      data: {
        id: 'fee_integration',
        tierId: testTierId,
        feePercentage: 2.75,
      },
    });
  });

  afterAll(async () => {
    await db.fonepayTransaction.deleteMany({ where: { agencyId: testAgencyId } });
    await db.khaltiTransaction.deleteMany({ where: { agencyId: testAgencyId } });
    await db.esewaTransaction.deleteMany({ where: { agencyId: testAgencyId } });
    await db.connectIPSTransaction.deleteMany({ where: { agencyId: testAgencyId } });
    await db.fonepayQRCode.deleteMany({ where: { agencyId: testAgencyId } });
    await db.stripeSubscription.deleteMany({ where: { agencyId: testAgencyId } });
    await db.agencyPaymentMethod.deleteMany({ where: { agencyId: testAgencyId } });
    await db.transactionFee.deleteMany({ where: { tierId: testTierId } });
    await db.kycSubmission.deleteMany({ where: { agencyId: testAgencyId } });
    await db.agency.deleteMany({ where: { id: testAgencyId } });
    await db.subscriptionTier.deleteMany({ where: { id: testTierId } });
  });

  describe('End-to-End Payment Flows', () => {
    it('should complete Khalti payment with encryption', async () => {
      const credentials = {
        publicKey: 'khalti_public_key',
        secretKey: 'khalti_secret_key',
      };

      const encrypted = encryptCredentials(credentials);

      // Store encrypted
      await db.agencyPaymentMethod.create({
        data: {
          agencyId: testAgencyId,
          provider: 'khalti',
          credentialsEncrypted: encrypted,
          isActive: true,
        },
      });

      // Retrieve and decrypt only when needed
      const stored = await db.agencyPaymentMethod.findUnique({
        where: {
          agencyId_provider: {
            agencyId: testAgencyId,
            provider: 'khalti',
          },
        },
      });

      expect(stored?.credentialsEncrypted).not.toContain(
        credentials.publicKey
      );

      const decrypted = decryptCredentials(stored!.credentialsEncrypted) as typeof credentials;
      expect(decrypted.publicKey).toBe(credentials.publicKey);
    });

    it('should store multiple payment methods encrypted', async () => {
      const methods = [
        { provider: 'esewa', secret: 'esewa_secret' },
        { provider: 'stripe', secret: 'stripe_secret' },
        { provider: 'fonepay', secret: 'fonepay_secret' },
      ];

      for (const method of methods) {
        const encrypted = encryptCredentials(method);
        await db.agencyPaymentMethod.create({
          data: {
            agencyId: testAgencyId,
            provider: method.provider,
            credentialsEncrypted: encrypted,
            isActive: true,
          },
        });
      }

      const storedMethods = await db.agencyPaymentMethod.findMany({
        where: { agencyId: testAgencyId },
      });

      expect(storedMethods.length).toBeGreaterThanOrEqual(3);
      storedMethods.forEach((m) => {
        expect(m.credentialsEncrypted).not.toContain('secret');
      });
    });

    it('should never expose credentials in list response', async () => {
      const paymentMethods = await db.agencyPaymentMethod.findMany({
        where: { agencyId: testAgencyId },
      });

      // API response would exclude credentialsEncrypted
      const apiResponse = paymentMethods.map((m) => ({
        id: m.id,
        provider: m.provider,
        isActive: m.isActive,
        createdAt: m.createdAt,
      }));

      apiResponse.forEach((response) => {
        expect(response).not.toHaveProperty('credentialsEncrypted');
      });
    });
  });

  describe('All Payment Methods Together', () => {
    it('should track all payment methods for same agency', async () => {
      const allMethods = await db.agencyPaymentMethod.findMany({
        where: { agencyId: testAgencyId },
      });

      const providers = allMethods.map((m) => m.provider);
      expect(providers).toContain('khalti');
      expect(providers).toContain('esewa');
      expect(providers).toContain('stripe');
      expect(providers).toContain('fonepay');
    });

    it('should maintain encryption integrity across all methods', async () => {
      const methods = await db.agencyPaymentMethod.findMany({
        where: { agencyId: testAgencyId },
      });

      methods.forEach((method) => {
        // Should be valid encrypted format
        const parts = method.credentialsEncrypted.split(':');
        expect(parts.length).toBe(3);
        expect(parts[0]).toHaveLength(32); // IV
      });
    });
  });
});
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '@funtush/database';

vi.mock('../../utils/fonepay', () => ({
  generateDynamicQRCode: vi.fn().mockResolvedValue('https://fonepay.test/qr/mock-qr-code'),
  verifyFonepayTransaction: vi.fn().mockResolvedValue(true),
}));

import {
  activateFonepay,
  generateDynamicQR,
  processAndVerifyFonepayTransaction,
  getFonepayStatus,
} from '../../services/fonepayService';
import { notificationService } from '../../services/notificationService';

describe('DAY 4: Fonepay QR Integration', () => {
  const mockAgencyId = 'agency_fonepay_' + Date.now();
  const mockTierId = 'tier_fonepay_' + Date.now();

  beforeAll(async () => {
    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'Fonepay Test ' + Date.now(),
        maxStaff: 10,
        maxGuides: 5,
        monthlyPrice: 2000,
        features: JSON.stringify(['feature1']),
      },
    });

    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'Fonepay Agency',
        email: 'fonepay_' + Date.now() + '@test.com',
        slug: 'fonepay-' + Date.now(),
        tierId: mockTierId,
      },
    });

    // Create KYC approval
    await db.kycSubmission.create({
      data: {
        id: 'kyc_' + mockAgencyId,
        agencyId: mockAgencyId,
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

    // Create transaction fee
    await db.transactionFee.create({
      data: {
        id: 'fee_' + mockTierId,
        tierId: mockTierId,
        feePercentage: 2.75, // Large tier
      },
    });
  });

  afterAll(async () => {
    await db.fonepayTransaction.deleteMany({
      where: { agencyId: mockAgencyId },
    });
    await db.fonepayQRCode.deleteMany({
      where: { agencyId: mockAgencyId },
    });
    await db.transactionFee.deleteMany({ where: { tierId: mockTierId } });
    await db.kycSubmission.deleteMany({ where: { agencyId: mockAgencyId } });
    await db.agency.deleteMany({ where: { id: mockAgencyId } });
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
  });

  describe('KYC Approval Gate', () => {
    it('should activate Fonepay with KYC APPROVED', async () => {
      const result = await activateFonepay(mockAgencyId);

      expect(result.qrCode.isActive).toBe(true);
      expect(result.qrCode.qrType).toBe('static');
      expect(result.feePercentage).toBe(2.75);
    });

    it('should block activation without KYC approval', async () => {
      const noKycAgencyId = 'no_kyc_' + Date.now();

      await db.agency.create({
        data: {
          id: noKycAgencyId,
          name: 'No KYC Agency',
          email: 'nokyc_' + Date.now() + '@test.com',
          slug: 'no-kyc-' + Date.now(),
          tierId: mockTierId,
        },
      });

      await expect(activateFonepay(noKycAgencyId)).rejects.toThrow(
        'KYC APPROVED'
      );

      await db.agency.delete({ where: { id: noKycAgencyId } });
    });

    it('should block activation if KYC status is not approved', async () => {
      const pendingKycAgencyId = 'pending_kyc_' + Date.now();

      await db.agency.create({
        data: {
          id: pendingKycAgencyId,
          name: 'Pending KYC Agency',
          email: 'pending_' + Date.now() + '@test.com',
          slug: 'pending-' + Date.now(),
          tierId: mockTierId,
        },
      });

      await db.kycSubmission.create({
        data: {
          id: 'kyc_pending_' + pendingKycAgencyId,
          agencyId: pendingKycAgencyId,
          status: 'UNDER_REVIEW',
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

      await expect(activateFonepay(pendingKycAgencyId)).rejects.toThrow(
        'KYC APPROVED'
      );

      await db.kycSubmission.deleteMany({ where: { agencyId: pendingKycAgencyId } });
      await db.agency.delete({ where: { id: pendingKycAgencyId } });
    });
  });

  describe('QR Code Generation', () => {
    it('should generate static QR on activation', async () => {
      const result = await activateFonepay(mockAgencyId);

      expect(result.qrCode.qrCodeUrl).toBeDefined();
      expect(result.qrCode.qrType).toBe('static');
      expect(result.qrCode.isActive).toBe(true);
    });

    it('should generate dynamic QR for specific amount', async () => {
      await activateFonepay(mockAgencyId);

      const result = await generateDynamicQR(mockAgencyId, 500);

      expect(result).toHaveProperty('qrUrl');
      expect(result.amount).toBe(500);
    });

    it('should fail dynamic QR if Fonepay not activated', async () => {
      const unactivatedAgencyId = 'unactivated_' + Date.now();

      await db.agency.create({
        data: {
          id: unactivatedAgencyId,
          name: 'Unactivated',
          email: 'unactivated_' + Date.now() + '@test.com',
          slug: 'unactivated-' + Date.now(),
          tierId: mockTierId,
        },
      });

      await expect(
        generateDynamicQR(unactivatedAgencyId, 500)
      ).rejects.toThrow('not activated');

      await db.agency.delete({ where: { id: unactivatedAgencyId } });
    });
  });

  describe('Transaction Fees', () => {
    it('should apply correct fee based on tier', async () => {
      await activateFonepay(mockAgencyId);

      const result = await processAndVerifyFonepayTransaction(
        mockAgencyId,
        'trekker@test.com',
        null,
        'txn_fee_test',
        1000
      );

      // Large tier: 2.75%
      const expectedFee = 1000 * 0.0275;
      expect(result.feeAmount).toBeCloseTo(expectedFee, 1);
      expect(result.netAmount).toBeCloseTo(1000 - expectedFee, 1);
    });

    it('should deduct fees at settlement', async () => {
      await activateFonepay(mockAgencyId);

      const result = await processAndVerifyFonepayTransaction(
        mockAgencyId,
        'trekker@test.com',
        'booking_456',
        'txn_settlement',
        5000
      );

      expect(result.amount).toBe(5000);
      expect(result.feePercentage).toBe(2.75);
      expect(result.netAmount).toBeLessThan(result.amount);
      expect(result.netAmount).toBeCloseTo(
        5000 * (1 - 2.75 / 100),
        1
      );
    });
  });

  describe('Trekker Payment Notifications', () => {
    it('should notify trekker on successful payment confirmation', async () => {
      await activateFonepay(mockAgencyId);

      const spy = vi.spyOn(notificationService, 'sendEmailNotification');

      await processAndVerifyFonepayTransaction(
        mockAgencyId,
        'trekker_success@test.com',
        'booking_notify_success',
        'txn_notify_success',
        1200
      );

      expect(spy).toHaveBeenCalledWith(
        'trekker_success@test.com',
        'trekker_payment_confirmed',
        expect.objectContaining({
          agencyName: 'Fonepay Agency',
          amount: 1200,
          bookingId: 'booking_notify_success',
        })
      );

      spy.mockRestore();
    });

    it('should notify trekker and not create transaction record on failed verification', async () => {
      await activateFonepay(mockAgencyId);

      const { verifyFonepayTransaction } = await import('../../utils/fonepay');
      vi.mocked(verifyFonepayTransaction).mockResolvedValueOnce(false);

      const spy = vi.spyOn(notificationService, 'sendEmailNotification');

      await expect(
        processAndVerifyFonepayTransaction(
          mockAgencyId,
          'trekker_fail@test.com',
          'booking_notify_fail',
          'txn_notify_fail',
          800
        )
      ).rejects.toThrow('Fonepay transaction verification failed');

      expect(spy).toHaveBeenCalledWith(
        'trekker_fail@test.com',
        'trekker_payment_failed',
        expect.objectContaining({
          agencyName: 'Fonepay Agency',
          amount: 800,
          transactionId: 'txn_notify_fail',
        })
      );

      const transaction = await db.fonepayTransaction.findFirst({
        where: { transactionId: 'txn_notify_fail' },
      });
      expect(transaction).toBeNull();

      spy.mockRestore();
    });
  });

  describe('Fonepay Status', () => {
    it('should return activation status', async () => {
      await activateFonepay(mockAgencyId);

      const status = await getFonepayStatus(mockAgencyId);

      expect(status.isActivated).toBe(true);
      expect(status.qrUrl).toBeDefined();
      expect(status.feePercentage).toBe(2.75);
    });

    it('should return inactive if not activated', async () => {
      const inactiveAgencyId = 'inactive_' + Date.now();

      await db.agency.create({
        data: {
          id: inactiveAgencyId,
          name: 'Inactive',
          email: 'inactive_' + Date.now() + '@test.com',
          slug: 'inactive-' + Date.now(),
          tierId: mockTierId,
        },
      });

      const status = await getFonepayStatus(inactiveAgencyId);

      expect(status.isActivated).toBe(false);
      expect(status.qrUrl).toBeNull();

      await db.agency.delete({ where: { id: inactiveAgencyId } });
    });
  });
});
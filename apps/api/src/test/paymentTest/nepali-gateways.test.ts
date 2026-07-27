import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '@funtush/database';

vi.mock('../../utils/khalti', () => ({
  generateKhaltiPayload: vi.fn((agencyId: string, amount: number, tierId: string) => ({
    public_key: 'test_khalti_public_key',
    amount: amount * 100,
    product_identity: tierId,
    product_name: `Funtush Subscription - Tier ${tierId}`,
    product_url: 'http://localhost/billing',
    merchant_username: 'funtush',
    return_url: `http://localhost/billing/subscribe/verify?provider=khalti&agencyId=${agencyId}`,
    webhook_url: 'http://localhost/webhooks/khalti',
  })),
  verifyKhaltiPayment: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../utils/esewa', () => ({
  generateEsewaPayload: vi.fn((agencyId: string, amount: number, tierId: string) => ({
    amt: amount,
    psc: 0,
    pdc: 0,
    txAmt: 0,
    tAmt: amount,
    pid: tierId,
    scd: 'test_esewa_merchant_code',
    su: `http://localhost/billing/success?provider=esewa&agencyId=${agencyId}`,
    fu: `http://localhost/billing/failed?provider=esewa&agencyId=${agencyId}`,
  })),
  verifyEsewaPayment: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../utils/connectIPS', () => ({
  initiateConnectIPSTransfer: vi
    .fn()
    .mockImplementation((agencyId: string, amount: number, bankCode: string, accountNumber: string) =>
      Promise.resolve({
        transferId: `transfer_${accountNumber}_${Date.now()}`,
        status: 'PENDING',
      })
    ),
  checkConnectIPSStatus: vi.fn().mockResolvedValue('SUCCESS'),
}));

import {
  initiateKhaltiPayment,
  verifyAndCompleteKhaltiPayment,
} from '../../services/khaltiSubscriptionService';
import {
  initiateEsewaPayment,
  verifyAndCompleteEsewaPayment,
} from '../../services/esewaSubscriptionService';
import {
  initiateConnectIPSPayment,
  checkAndUpdateConnectIPSPayment,
} from '../../services/connectIPSService';
import { notificationService } from '../../services/notificationService';

describe('DAY 3: Nepali Payment Gateways', () => {
  const mockAgencyId = 'agency_nepali_' + Date.now();
  const mockTierId = 'tier_nepali_' + Date.now();

  beforeAll(async () => {
    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'Nepali Test ' + Date.now(),
        maxStaff: 10,
        maxGuides: 5,
        monthlyPrice: 1500,
        features: JSON.stringify(['feature1']),
      },
    });

    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'Nepali Agency',
        email: 'nepali_' + Date.now() + '@test.com',
        slug: 'nepali-' + Date.now(),
        tierId: mockTierId,
      },
    });
  });

  afterAll(async () => {
    await db.khaltiTransaction.deleteMany({
      where: { agencyId: mockAgencyId },
    });
    await db.esewaTransaction.deleteMany({
      where: { agencyId: mockAgencyId },
    });
    await db.connectIPSTransaction.deleteMany({
      where: { agencyId: mockAgencyId },
    });
    await db.agency.deleteMany({ where: { id: mockAgencyId } });
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
  });

  describe('Khalti Payment Gateway', () => {
    it('should initiate Khalti payment', async () => {
      const result = await initiateKhaltiPayment(mockAgencyId, mockTierId);

      expect(result).toHaveProperty('transactionId');
      expect(result).toHaveProperty('khaltiPayload');
      expect(result.khaltiPayload.amount).toBe(1500 * 100); // Rupees to paisa
      expect(result.khaltiPayload.public_key).toBeDefined();
    });

    it('should verify and complete Khalti payment', async () => {
      const initResult = await initiateKhaltiPayment(mockAgencyId, mockTierId);

      const verifyResult = await verifyAndCompleteKhaltiPayment(
        'khalti_token_test',
        initResult.transactionId,
        mockAgencyId
      );

      expect(verifyResult.status).toBe('success');
      expect(verifyResult.khaltiToken).toBe('khalti_token_test');
    });

    it('should store Khalti transaction in database', async () => {
      const initResult = await initiateKhaltiPayment(mockAgencyId, mockTierId);
      await verifyAndCompleteKhaltiPayment(
        'khalti_verify',
        initResult.transactionId,
        mockAgencyId
      );

      const transaction = await db.khaltiTransaction.findUnique({
        where: { id: initResult.transactionId },
      });

      expect(transaction?.status).toBe('success');
      expect(transaction?.khaltiToken).toBeDefined();
    });

    it('should notify agency and mark transaction failed on invalid Khalti verification', async () => {
      const { verifyKhaltiPayment } = await import('../../utils/khalti');
      vi.mocked(verifyKhaltiPayment).mockResolvedValueOnce(false);

      const spy = vi.spyOn(notificationService, 'sendEmailNotification');

      const initResult = await initiateKhaltiPayment(mockAgencyId, mockTierId);

      await expect(
        verifyAndCompleteKhaltiPayment('bad_token', initResult.transactionId, mockAgencyId)
      ).rejects.toThrow('Khalti payment verification failed');

      const transaction = await db.khaltiTransaction.findUnique({
        where: { id: initResult.transactionId },
      });
      expect(transaction?.status).toBe('failed');

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        'subscription_payment_failed',
        expect.objectContaining({ provider: 'Khalti' })
      );

      spy.mockRestore();
    });
  });

  describe('eSewa Payment Gateway', () => {
    it('should initiate eSewa payment', async () => {
      const result = await initiateEsewaPayment(mockAgencyId, mockTierId);

      expect(result).toHaveProperty('transactionId');
      expect(result).toHaveProperty('esewaPayload');
      expect(result.esewaPayload.amt).toBe(1500); // Direct rupees
      expect(result.esewaPayload.scd).toBeDefined();
    });

    it('should verify and complete eSewa payment', async () => {
      const initResult = await initiateEsewaPayment(mockAgencyId, mockTierId);

      const verifyResult = await verifyAndCompleteEsewaPayment(
        'esewa_ref_123',
        initResult.transactionId,
        mockAgencyId
      );

      expect(verifyResult.status).toBe('success');
      expect(verifyResult.esewaRefId).toBe('esewa_ref_123');
    });

    it('should store eSewa transaction in database', async () => {
      const initResult = await initiateEsewaPayment(mockAgencyId, mockTierId);
      await verifyAndCompleteEsewaPayment(
        'esewa_verify',
        initResult.transactionId,
        mockAgencyId
      );

      const transaction = await db.esewaTransaction.findUnique({
        where: { id: initResult.transactionId },
      });

      expect(transaction?.status).toBe('success');
      expect(transaction?.esewaRefId).toBeDefined();
    });

    it('should notify agency and mark transaction failed on invalid eSewa verification', async () => {
      const { verifyEsewaPayment } = await import('../../utils/esewa');
      vi.mocked(verifyEsewaPayment).mockResolvedValueOnce(false);

      const spy = vi.spyOn(notificationService, 'sendEmailNotification');

      const initResult = await initiateEsewaPayment(mockAgencyId, mockTierId);

      await expect(
        verifyAndCompleteEsewaPayment('bad_ref', initResult.transactionId, mockAgencyId)
      ).rejects.toThrow('eSewa payment verification failed');

      const transaction = await db.esewaTransaction.findUnique({
        where: { id: initResult.transactionId },
      });
      expect(transaction?.status).toBe('failed');

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        'subscription_payment_failed',
        expect.objectContaining({ provider: 'eSewa' })
      );

      spy.mockRestore();
    });
  });

  describe('ConnectIPS Bank Transfer', () => {
    it('should initiate ConnectIPS transfer', async () => {
      const result = await initiateConnectIPSPayment(
        mockAgencyId,
        mockTierId,
        'NABIL',
        '1234567890'
      );

      expect(result).toHaveProperty('transferId');
      expect(result.status).toBe('PENDING');
      expect(result.bankCode).toBe('NABIL');
    });

    it('should verify ConnectIPS transfer', async () => {
      const initResult = await initiateConnectIPSPayment(
        mockAgencyId,
        mockTierId,
        'NABIL',
        '9876543210'
      );

      const verifyResult = await checkAndUpdateConnectIPSPayment(
        initResult.transferId
      );

      expect(verifyResult.status).toBe('success');
      expect(verifyResult.verifiedAt).toBeDefined();
    });

    it('should store ConnectIPS transaction in database', async () => {
      const initResult = await initiateConnectIPSPayment(
        mockAgencyId,
        mockTierId,
        'NABIL',
        '5555555555'
      );

      await checkAndUpdateConnectIPSPayment(initResult.transferId);

      const transaction = await db.connectIPSTransaction.findUnique({
        where: { transferId: initResult.transferId },
      });

      expect(transaction?.status).toBe('success');
      expect(transaction?.bankCode).toBe('NABIL');
    });

    it('should notify agency and mark transaction failed on ConnectIPS FAILED status', async () => {
      const { checkConnectIPSStatus } = await import('../../utils/connectIPS');
      vi.mocked(checkConnectIPSStatus).mockResolvedValueOnce('FAILED');

      const spy = vi.spyOn(notificationService, 'sendEmailNotification');

      const initResult = await initiateConnectIPSPayment(
        mockAgencyId,
        mockTierId,
        'NABIL',
        '4444444444'
      );

      const result = await checkAndUpdateConnectIPSPayment(initResult.transferId);
      expect(result.status).toBe('failed');

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        'subscription_payment_failed',
        expect.objectContaining({ provider: 'ConnectIPS' })
      );

      spy.mockRestore();
    });
  });

  describe('Unified Verify Endpoint', () => {
    it('should verify Khalti and eSewa with same endpoint', async () => {
      const khaltiInit = await initiateKhaltiPayment(mockAgencyId, mockTierId);
      const esewaInit = await initiateEsewaPayment(mockAgencyId, mockTierId);

      // Both use same verify endpoint but different parameters
      const khaltiVerify = await verifyAndCompleteKhaltiPayment(
        'khalti_token',
        khaltiInit.transactionId,
        mockAgencyId
      );

      const esewaVerify = await verifyAndCompleteEsewaPayment(
        'esewa_ref',
        esewaInit.transactionId,
        mockAgencyId
      );

      expect(khaltiVerify.status).toBe('success');
      expect(esewaVerify.status).toBe('success');
    });

    it('should track different payment methods separately', async () => {
      const khaltiInit = await initiateKhaltiPayment(mockAgencyId, mockTierId);
      const connectipsInit = await initiateConnectIPSPayment(
        mockAgencyId,
        mockTierId,
        'NABIL',
        '1111111111'
      );

      await verifyAndCompleteKhaltiPayment(
        'khalti_token_2',
        khaltiInit.transactionId,
        mockAgencyId
      );
      await checkAndUpdateConnectIPSPayment(connectipsInit.transferId);

      const khaltiTxn = await db.khaltiTransaction.findUnique({
        where: { id: khaltiInit.transactionId },
      });

      const connectipsTxn = await db.connectIPSTransaction.findUnique({
        where: { transferId: connectipsInit.transferId },
      });

      expect(khaltiTxn?.status).toBe('success');
      expect(connectipsTxn?.status).toBe('success');
    });
  });
});
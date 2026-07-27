import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '@funtush/database';

vi.mock('../../utils/stripe', () => ({
  getStripeClient: vi.fn(() => ({
    invoices: {
      retrieve: vi.fn().mockImplementation(() =>
        Promise.resolve({
          period_end: Math.floor(Date.now() / 1000) + 60 * 24 * 60 * 60,
        })
      ),
    },
  })),
}));

import {
  handleInvoicePaid,
  handlePaymentFailed,
  handleSubscriptionDeleted,
} from '../../services/stripeSubscriptionService';
import { notificationService } from '../../services/notificationService';

describe('DAY 2: Stripe Subscription Billing', () => {
  const mockAgencyId = 'agency_stripe_' + Date.now();
  const mockTierId = 'tier_stripe_' + Date.now();
  const subscriptionId = 'sub_test_' + Date.now();

  beforeAll(async () => {
    // Setup test data
    await db.subscriptionTier.create({
      data: {
        id: mockTierId,
        name: 'Stripe Test ' + Date.now(),
        maxStaff: 10,
        maxGuides: 5,
        monthlyPrice: 1000,
        features: JSON.stringify(['feature1']),
      },
    });

    await db.agency.create({
      data: {
        id: mockAgencyId,
        name: 'Stripe Test Agency',
        email: 'stripe_' + Date.now() + '@test.com',
        slug: 'stripe-test-' + Date.now(),
        tierId: mockTierId,
      },
    });

    // Create Stripe subscription
    await db.stripeSubscription.create({
      data: {
        agencyId: mockAgencyId,
        stripeCustomerId: 'cus_stripe_test',
        stripeSubscriptionId: subscriptionId,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    await db.stripeSubscription.deleteMany({
      where: { agencyId: mockAgencyId },
    });
    await db.agency.deleteMany({ where: { id: mockAgencyId } });
    await db.subscriptionTier.deleteMany({ where: { id: mockTierId } });
  });

  describe('Webhook: invoice.paid', () => {
    it('should extend subscription period on payment success', async () => {
      const before = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      const oldPeriodEnd = before?.currentPeriodEnd || new Date();

      await handleInvoicePaid('inv_paid_123', subscriptionId);

      const after = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      expect(after?.status).toBe('active');
      expect(after?.currentPeriodEnd?.getTime()).toBeGreaterThan(oldPeriodEnd.getTime());
    });

    it('should clear grace period on successful payment', async () => {
      // Set grace period first
      await db.stripeSubscription.update({
        where: { stripeSubscriptionId: subscriptionId },
        data: {
          status: 'grace_period',
          graceUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      // Handle paid invoice
      await handleInvoicePaid('inv_paid_retry', subscriptionId);

      const subscription = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      expect(subscription?.status).toBe('active');
      expect(subscription?.graceUntil).toBeNull(); // Cleared
    });

    it('should log invoice payment details', async () => {
      await handleInvoicePaid('inv_log_123', subscriptionId);

      const subscription = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      expect(subscription?.lastInvoiceId).toBe('inv_log_123');
      expect(subscription?.lastInvoiceStatus).toBe('paid');
    });

    it('should notify agency of successful payment', async () => {
      const spy = vi.spyOn(notificationService, 'sendEmailNotification');

      await handleInvoicePaid('inv_notify_success', subscriptionId);

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        'payment_received',
        expect.objectContaining({ invoiceId: 'inv_notify_success' })
      );

      spy.mockRestore();
    });

    it('should not break webhook processing if notification fails', async () => {
      const spy = vi
        .spyOn(notificationService, 'sendEmailNotification')
        .mockRejectedValueOnce(new Error('SMTP down'));

      await expect(
        handleInvoicePaid('inv_notify_crash', subscriptionId)
      ).resolves.not.toThrow();

      const subscription = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });
      expect(subscription?.lastInvoiceId).toBe('inv_notify_crash');
      expect(subscription?.status).toBe('active');

      spy.mockRestore();
    });
  });

  describe('Webhook: invoice.payment_failed', () => {
    it('should start 7-day grace period on payment failure', async () => {
      await handlePaymentFailed('inv_failed_123', subscriptionId);

      const subscription = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      expect(subscription?.status).toBe('grace_period');
      expect(subscription?.graceUntil).toBeDefined();

      // Verify grace period is ~7 days
      const graceDays = Math.floor(
        (subscription!.graceUntil!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      expect(graceDays).toBeGreaterThanOrEqual(6);
      expect(graceDays).toBeLessThanOrEqual(8);
    });

    it('should allow agency to retry during grace period', async () => {
      // Start grace period
      await handlePaymentFailed('inv_fail_retry', subscriptionId);

      const subscription = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      const now = new Date();
      const isInGrace =
        subscription?.graceUntil && subscription.graceUntil > now;
      expect(isInGrace).toBe(true);

      // Simulate successful retry
      await handleInvoicePaid('inv_retry_success', subscriptionId);

      const afterRetry = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      expect(afterRetry?.status).toBe('active');
      expect(afterRetry?.graceUntil).toBeNull();
    });

    it('should log failed payment attempt', async () => {
      await handlePaymentFailed('inv_fail_log', subscriptionId);

      const subscription = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      expect(subscription?.lastInvoiceId).toBe('inv_fail_log');
      expect(subscription?.lastInvoiceStatus).toBe('failed');
    });

    it('should notify agency of payment failure', async () => {
      const spy = vi.spyOn(notificationService, 'sendEmailNotification');

      await handlePaymentFailed('inv_notify_fail', subscriptionId);

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        'payment_failed',
        expect.objectContaining({ agencyName: expect.any(String) })
      );

      spy.mockRestore();
    });

    it('should not break webhook processing if failure notification fails', async () => {
      const spy = vi
        .spyOn(notificationService, 'sendEmailNotification')
        .mockRejectedValueOnce(new Error('SMTP down'));

      await expect(
        handlePaymentFailed('inv_fail_notify_crash', subscriptionId)
      ).resolves.not.toThrow();

      const subscription = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });
      expect(subscription?.lastInvoiceId).toBe('inv_fail_notify_crash');
      expect(subscription?.status).toBe('grace_period');

      spy.mockRestore();
    });
  });

  describe('Webhook: customer.subscription.deleted', () => {
    it('should mark subscription as canceled', async () => {
      await handleSubscriptionDeleted(subscriptionId);

      const subscription = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      expect(subscription?.status).toBe('canceled');
    });

    it('should not restore canceled subscription', async () => {
      // Try to extend (should not work on canceled)
      await handleInvoicePaid('inv_after_cancel', subscriptionId);

      const subscription = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      expect(subscription?.status).toBe('canceled');
    });
  });

  describe('Grace Period Edge Cases', () => {
    it('should handle grace period expiration', async () => {
      // Create subscription with expired grace period
      await db.stripeSubscription.update({
        where: { stripeSubscriptionId: subscriptionId },
        data: {
          status: 'grace_period',
          graceUntil: new Date(Date.now() - 1000), // 1 second ago (expired)
        },
      });

      const subscription = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      const isExpired =
        subscription?.graceUntil && subscription.graceUntil < new Date();
      expect(isExpired).toBe(true);
    });

    it('should not allow subscription if grace period expired and no payment', async () => {
      const subscription = await db.stripeSubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      });

      if (subscription?.graceUntil && subscription.graceUntil < new Date()) {
        // Subscription should be canceled or access revoked
        expect(subscription.status).toEqual(
          expect.not.stringContaining('active')
        );
      }
    });
  });
});
import { db } from '@funtush/database';
import { generateEsewaPayload, verifyEsewaPayment } from '../utils/esewa';
import { notificationService } from './notificationService';

export async function initiateEsewaPayment(
  agencyId: string,
  subscriptionTierId: string
) {
  const tier = await db.subscriptionTier.findUnique({
    where: { id: subscriptionTierId },
  });

  if (!tier) {
    throw new Error('Subscription tier not found');
  }

  const payload = generateEsewaPayload(
    agencyId,
    Number(tier.monthlyPrice),
    subscriptionTierId
  );

  const transaction = await db.esewaTransaction.create({
    data: {
      agencyId,
      tierId: subscriptionTierId,
      amount: Number(tier.monthlyPrice),
      status: 'pending',
    },
  });

  return {
    transactionId: transaction.id,
    esewaPayload: payload,
  };
}

export async function verifyAndCompleteEsewaPayment(
  refId: string,
  transactionId: string,
  agencyId: string
) {
  const transaction = await db.esewaTransaction.findUnique({
    where: { id: transactionId },
  });

  if (!transaction) {
    throw new Error('Transaction not found');
  }

  const isValid = await verifyEsewaPayment(refId, transaction.amount);

  const agency = await db.agency.findUnique({
    where: { id: agencyId },
  });

  if (!isValid) {
    await db.esewaTransaction.update({
      where: { id: transactionId },
      data: { status: 'failed' },
    });

    if (agency) {
      try {
        await notificationService.sendEmailNotification(
          agency.email,
          'subscription_payment_failed',
          {
            agencyName: agency.name,
            provider: 'eSewa',
          }
        );
      } catch (err) {
        console.error('[Notification] eSewa failure notify error:', err);
      }
    }

    throw new Error('eSewa payment verification failed');
  }

  const updatedTransaction = await db.esewaTransaction.update({
    where: { id: transactionId },
    data: {
      status: 'success',
      esewaRefId: refId,
      verifiedAt: new Date(),
    },
  });

  if (!agency) {
    throw new Error('Agency not found');
  }

  await db.agency.update({
    where: { id: agencyId },
    data: { tierId: transaction.tierId },
  });

  try {
    await notificationService.sendEmailNotification(
      agency.email,
      'subscription_payment_received',
      {
        agencyName: agency.name,
        amount: transaction.amount,
        currency: 'NPR',
        provider: 'eSewa',
      }
    );
  } catch (err) {
    console.error('[Notification] eSewa success notify error:', err);
  }

  return updatedTransaction;
}
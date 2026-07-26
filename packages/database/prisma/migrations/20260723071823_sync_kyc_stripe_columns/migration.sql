/*
  Warnings:

  - Added the required column `updated_at` to the `kyc_submissions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `current_period_start` to the `stripe_subscriptions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "agency_payment_methods" ADD COLUMN     "rotated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "kyc_submissions" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "stripe_subscriptions" ADD COLUMN     "current_period_start" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "agency_payment_methods_provider_idx" ON "agency_payment_methods"("provider");

-- CreateIndex
CREATE INDEX "kyc_submissions_agency_id_idx" ON "kyc_submissions"("agency_id");

-- CreateIndex
CREATE INDEX "kyc_submissions_status_idx" ON "kyc_submissions"("status");

-- CreateIndex
CREATE INDEX "stripe_subscriptions_stripe_customer_id_idx" ON "stripe_subscriptions"("stripe_customer_id");

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "branch_id" TEXT;
-- AlterTable
ALTER TABLE "kyc_submissions" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- AlterTable
ALTER TABLE "stripe_subscriptions" ADD COLUMN IF NOT EXISTS "current_period_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- AlterTable
ALTER TABLE "trek_packages" ADD COLUMN IF NOT EXISTS "availableToAllBranches" BOOLEAN NOT NULL DEFAULT true;
-- CreateTable
CREATE TABLE IF NOT EXISTS "PackageBranch" (
    "packageId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    CONSTRAINT "PackageBranch_pkey" PRIMARY KEY ("packageId","branchId")
);
-- CreateIndex
CREATE INDEX IF NOT EXISTS "agency_payment_methods_provider_idx" ON "agency_payment_methods"("provider");
-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "branches_name_key" ON "branches"("name");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "kyc_submissions_agency_id_idx" ON "kyc_submissions"("agency_id");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "kyc_submissions_status_idx" ON "kyc_submissions"("status");
-- CreateIndex
CREATE INDEX IF NOT EXISTS "stripe_subscriptions_stripe_customer_id_idx" ON "stripe_subscriptions"("stripe_customer_id");
-- AddForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_branch_id_fkey";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PackageBranch" DROP CONSTRAINT IF EXISTS "PackageBranch_packageId_fkey";
ALTER TABLE "PackageBranch" ADD CONSTRAINT "PackageBranch_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "trek_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PackageBranch" DROP CONSTRAINT IF EXISTS "PackageBranch_branchId_fkey";
ALTER TABLE "PackageBranch" ADD CONSTRAINT "PackageBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

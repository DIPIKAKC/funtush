-- AlterEnum
ALTER TYPE "AdCampaignStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "AdCampaign" ADD COLUMN     "daily_budget_cents" INTEGER NOT NULL DEFAULT 1000;

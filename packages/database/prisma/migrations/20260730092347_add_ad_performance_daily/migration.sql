-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('META', 'GOOGLE');

-- CreateTable
CREATE TABLE "ad_performance_daily" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spend" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_performance_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_performance_daily_campaign_id_idx" ON "ad_performance_daily"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_performance_daily_campaign_id_platform_date_key" ON "ad_performance_daily"("campaign_id", "platform", "date");

-- AddForeignKey
ALTER TABLE "ad_performance_daily" ADD CONSTRAINT "ad_performance_daily_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

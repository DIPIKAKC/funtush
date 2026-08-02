/*
  Warnings:

  - Added the required column `instagram_token_expires_at` to the `agency_profiles` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "agency_profiles" ADD COLUMN     "facebook_pixel_id" TEXT,
ADD COLUMN     "google_analytics_id" TEXT,
ADD COLUMN     "instagram_access_token" TEXT,
ADD COLUMN     "instagram_business_id" TEXT,
ADD COLUMN     "instagram_connected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "instagram_feed_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "instagram_token_expires_at" TIMESTAMP(3) NOT NULL;

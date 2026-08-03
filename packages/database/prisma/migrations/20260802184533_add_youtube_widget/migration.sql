-- AlterTable
ALTER TABLE "agency_profiles" ADD COLUMN     "maxYoutubeVideos" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "youtubeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "youtubeVideos" JSONB;

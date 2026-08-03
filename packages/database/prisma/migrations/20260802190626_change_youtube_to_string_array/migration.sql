/*
  Warnings:

  - The `youtubeVideos` column on the `agency_profiles` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "agency_profiles" DROP COLUMN "youtubeVideos",
ADD COLUMN     "youtubeVideos" TEXT[] DEFAULT ARRAY[]::TEXT[];

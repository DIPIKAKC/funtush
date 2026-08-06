-- AlterTable
ALTER TABLE "agency_profiles" ALTER COLUMN "maxYoutubeVideos" DROP NOT NULL;

-- AlterTable
ALTER TABLE "guide_profiles" ADD COLUMN     "branchId" TEXT;

-- AddForeignKey
ALTER TABLE "guide_profiles" ADD CONSTRAINT "guide_profiles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

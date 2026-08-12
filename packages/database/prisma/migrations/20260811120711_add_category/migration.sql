/*
  Warnings:

  - You are about to drop the column `branchId` on the `guide_profiles` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "guide_profiles" DROP CONSTRAINT "guide_profiles_branchId_fkey";

-- AlterTable
ALTER TABLE "guide_profiles" DROP COLUMN "branchId",
ADD COLUMN     "branch_id" TEXT;

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_agency_id_idx" ON "categories"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_agency_id_name_key" ON "categories"("agency_id", "name");

-- CreateIndex
CREATE INDEX "guide_profiles_branch_id_idx" ON "guide_profiles"("branch_id");

-- AddForeignKey
ALTER TABLE "guide_profiles" ADD CONSTRAINT "guide_profiles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

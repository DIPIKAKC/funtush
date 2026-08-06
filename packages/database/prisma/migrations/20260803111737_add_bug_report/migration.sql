-- CreateEnum
CREATE TYPE "BugStatus" AS ENUM ('REPORTED', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "BugPriority" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'LOW');

-- CreateTable
CREATE TABLE "BugReport" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "stepsToReproduce" TEXT,
    "screenshotUrl" TEXT,
    "status" "BugStatus" NOT NULL DEFAULT 'REPORTED',
    "priority" "BugPriority",
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BugReport_agencyId_idx" ON "BugReport"("agencyId");

-- CreateIndex
CREATE INDEX "BugReport_status_idx" ON "BugReport"("status");

-- AddForeignKey
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

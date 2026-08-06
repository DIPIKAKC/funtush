-- AlterTable
ALTER TABLE "BugReport" ADD COLUMN     "assignedToId" TEXT;

-- CreateTable
CREATE TABLE "BugHint" (
    "id" TEXT NOT NULL,
    "bugReportId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BugHint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BugHint_bugReportId_idx" ON "BugHint"("bugReportId");

-- AddForeignKey
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugHint" ADD CONSTRAINT "BugHint_bugReportId_fkey" FOREIGN KEY ("bugReportId") REFERENCES "BugReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugHint" ADD CONSTRAINT "BugHint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

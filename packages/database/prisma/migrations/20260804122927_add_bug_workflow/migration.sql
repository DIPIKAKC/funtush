/*
  Warnings:

  - You are about to drop the `payrolls` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "payrolls" DROP CONSTRAINT "payrolls_agency_id_fkey";

-- DropForeignKey
ALTER TABLE "payrolls" DROP CONSTRAINT "payrolls_booking_id_fkey";

-- DropForeignKey
ALTER TABLE "payrolls" DROP CONSTRAINT "payrolls_created_by_fkey";

-- DropForeignKey
ALTER TABLE "payrolls" DROP CONSTRAINT "payrolls_journal_entry_id_fkey";

-- DropForeignKey
ALTER TABLE "payrolls" DROP CONSTRAINT "payrolls_staff_id_fkey";

-- DropTable
DROP TABLE "payrolls";

-- DropEnum
DROP TYPE "PayrollStatus";

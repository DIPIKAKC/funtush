/*
  Warnings:

  - You are about to drop the column `created_at` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `password_hash` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `tenant_id` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `endDate` on the `subscriptions` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[agency_id,user_id]` on the table `agency_users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[token_hash]` on the table `refresh_tokens` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `user_id` to the `agency_users` table without a default value. This is not possible if the table is not empty.
  - Made the column `agency_id` on table `agency_users` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('PLATFORM', 'TENANT', 'TREKKER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('INQUIRY', 'PENDING', 'CONFIRMED', 'PAYMENT_PENDING', 'REJECTED', 'ALTERNATIVE_PROPOSED', 'PAID', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DepartureStatus" AS ENUM ('AVAILABLE', 'FULL', 'GUARANTEED');

-- CreateEnum
CREATE TYPE "TrekDifficulty" AS ENUM ('EASY', 'MODERATE', 'CHALLENGING', 'DIFFICULT');

-- DropForeignKey
ALTER TABLE "agency_users" DROP CONSTRAINT "agency_users_agency_id_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_fkey";

-- DropIndex
DROP INDEX "agency_users_email_key";

-- AlterTable
ALTER TABLE "agency_users" DROP COLUMN "created_at",
DROP COLUMN "email",
DROP COLUMN "password_hash",
DROP COLUMN "tenant_id",
ADD COLUMN     "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "user_id" TEXT NOT NULL,
ALTER COLUMN "agency_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "endDate",
ADD COLUMN     "end_date" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "role_type" "RoleType" NOT NULL,
    "fcm_token" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockUntil" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trekkers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fullName" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "nationality" TEXT,
    "emergencyContact" TEXT,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trekkers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_packages" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "duration_days" INTEGER NOT NULL,
    "price_per_person" DECIMAL(10,2) NOT NULL,
    "difficulty" "TrekDifficulty" NOT NULL,
    "max_group_size" INTEGER NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trek_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_destinations" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "altitude_m" INTEGER,
    "best_season" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trek_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_itineraries" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "day_number" INTEGER NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "altitude_m" INTEGER,

    CONSTRAINT "trek_itineraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_departure_dates" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "max_slots" INTEGER NOT NULL,
    "booked_slots" INTEGER NOT NULL DEFAULT 0,
    "status" "DepartureStatus" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "trek_departure_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trek_add_ons" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "per_person" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trek_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "trekker_id" TEXT,
    "package_id" TEXT NOT NULL,
    "departure_date_id" TEXT NOT NULL,
    "group_size" INTEGER NOT NULL,
    "total_price" DECIMAL(10,2) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'INQUIRY',
    "trekker_name" TEXT NOT NULL,
    "trekker_email" TEXT NOT NULL,
    "trekker_phone" TEXT NOT NULL,
    "trekker_country" TEXT,
    "special_requests" TEXT,
    "rejection_reason" TEXT,
    "proposed_date" DATE,
    "assigned_guide_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_add_ons" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "addon_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price_at_booking" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "booking_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "url_token" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TrekDestinationToTrekPackage" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TrekDestinationToTrekPackage_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "trekkers_user_id_key" ON "trekkers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trek_packages_slug_key" ON "trek_packages"("slug");

-- CreateIndex
CREATE INDEX "trek_packages_agency_id_idx" ON "trek_packages"("agency_id");

-- CreateIndex
CREATE INDEX "trek_destinations_agency_id_idx" ON "trek_destinations"("agency_id");

-- CreateIndex
CREATE INDEX "trek_itineraries_package_id_idx" ON "trek_itineraries"("package_id");

-- CreateIndex
CREATE INDEX "trek_departure_dates_package_id_idx" ON "trek_departure_dates"("package_id");

-- CreateIndex
CREATE INDEX "trek_add_ons_package_id_idx" ON "trek_add_ons"("package_id");

-- CreateIndex
CREATE INDEX "bookings_agency_id_status_idx" ON "bookings"("agency_id", "status");

-- CreateIndex
CREATE INDEX "bookings_trekker_id_idx" ON "bookings"("trekker_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_add_ons_booking_id_addon_id_key" ON "booking_add_ons"("booking_id", "addon_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_booking_id_key" ON "payment_links"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_url_token_key" ON "payment_links"("url_token");

-- CreateIndex
CREATE INDEX "_TrekDestinationToTrekPackage_B_index" ON "_TrekDestinationToTrekPackage"("B");

-- CreateIndex
CREATE UNIQUE INDEX "agency_users_agency_id_user_id_key" ON "agency_users"("agency_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trekkers" ADD CONSTRAINT "trekkers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_packages" ADD CONSTRAINT "trek_packages_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_destinations" ADD CONSTRAINT "trek_destinations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_itineraries" ADD CONSTRAINT "trek_itineraries_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "trek_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_departure_dates" ADD CONSTRAINT "trek_departure_dates_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "trek_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trek_add_ons" ADD CONSTRAINT "trek_add_ons_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "trek_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trekker_id_fkey" FOREIGN KEY ("trekker_id") REFERENCES "trekkers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "trek_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_departure_date_id_fkey" FOREIGN KEY ("departure_date_id") REFERENCES "trek_departure_dates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_add_ons" ADD CONSTRAINT "booking_add_ons_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_add_ons" ADD CONSTRAINT "booking_add_ons_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "trek_add_ons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TrekDestinationToTrekPackage" ADD CONSTRAINT "_TrekDestinationToTrekPackage_A_fkey" FOREIGN KEY ("A") REFERENCES "trek_destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TrekDestinationToTrekPackage" ADD CONSTRAINT "_TrekDestinationToTrekPackage_B_fkey" FOREIGN KEY ("B") REFERENCES "trek_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

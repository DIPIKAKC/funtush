/*
  Warnings:

  - You are about to drop the column `created_at` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `password_hash` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `tenant_id` on the `agency_users` table. All the data in the column will be lost.
  - You are about to drop the column `endDate` on the `subscriptions` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[agency_id,user_id]` on the table `agency_users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[token_hash]` on the table `refresh_tokens` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[slug]` on the table `trek_packages` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `user_id` to the `agency_users` table without a default value. This is not possible if the table is not empty.
  - Made the column `agency_id` on table `agency_users` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `slug` to the `trek_packages` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('PLATFORM', 'TENANT', 'TREKKER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('INQUIRY', 'PENDING', 'CONFIRMED', 'PAYMENT_PENDING', 'REJECTED', 'ALTERNATIVE_PROPOSED', 'PAID', 'ACTIVE', 'COMPLETED', 'CANCELLED');

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

-- AlterTable
ALTER TABLE "trek_packages" ADD COLUMN     "slug" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "role_type" "RoleType" NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockUntil" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trekker" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fullName" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "nationality" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trekker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trekker_preferences" (
    "id" TEXT NOT NULL,
    "trekker_id" TEXT NOT NULL,
    "preferred_destinations" JSONB,
    "budget_range" JSONB,
    "group_size_preference" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trekker_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "trekker_id" TEXT NOT NULL,
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

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "trekker_user_id_key" ON "trekker"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trekker_preferences_trekker_id_key" ON "trekker_preferences"("trekker_id");

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
CREATE UNIQUE INDEX "agency_users_agency_id_user_id_key" ON "agency_users"("agency_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trek_packages_slug_key" ON "trek_packages"("slug");

-- AddForeignKey
ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trekker" ADD CONSTRAINT "trekker_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trekker_preferences" ADD CONSTRAINT "trekker_preferences_trekker_id_fkey" FOREIGN KEY ("trekker_id") REFERENCES "trekker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trekker_id_fkey" FOREIGN KEY ("trekker_id") REFERENCES "trekker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

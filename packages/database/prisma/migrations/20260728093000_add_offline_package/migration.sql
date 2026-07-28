-- Mobile week · Day 2 — offline itinerary caching contract.
--
-- Adds the three content tables the offline package bundles (packing list,
-- agency emergency contacts, guide contact details), the trek's country code,
-- and the per-booking version/fingerprint columns the mobile app uses to decide
-- whether its cached copy is stale.

-- CreateEnum
CREATE TYPE "EmergencyContactType" AS ENUM ('AGENCY_DESK', 'RESCUE', 'MEDICAL', 'LOCAL_CONTACT', 'INSURANCE');

-- AlterTable
ALTER TABLE "trek_packages" ADD COLUMN     "country_code" TEXT;

-- AlterTable
-- Existing bookings start at version 1 with a NULL hash, so the first request
-- for each one fingerprints its content and stores it without bumping past 1.
ALTER TABLE "bookings" ADD COLUMN     "offline_package_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "offline_package_hash" TEXT,
ADD COLUMN     "offline_package_updated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "trek_packing_items" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" TEXT,
    "is_essential" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trek_packing_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_emergency_contacts" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "type" "EmergencyContactType" NOT NULL,
    "alt_phone" TEXT,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_profiles" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "guide_ref" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alt_phone" TEXT,
    "satellite_phone" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guide_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trek_packing_items_package_id_idx" ON "trek_packing_items"("package_id");

-- CreateIndex
CREATE INDEX "agency_emergency_contacts_agency_id_idx" ON "agency_emergency_contacts"("agency_id");

-- CreateIndex
CREATE INDEX "guide_profiles_agency_id_idx" ON "guide_profiles"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "guide_profiles_agency_id_guide_ref_key" ON "guide_profiles"("agency_id", "guide_ref");

-- AddForeignKey
ALTER TABLE "trek_packing_items" ADD CONSTRAINT "trek_packing_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "trek_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_emergency_contacts" ADD CONSTRAINT "agency_emergency_contacts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_profiles" ADD CONSTRAINT "guide_profiles_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

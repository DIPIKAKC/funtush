-- CreateEnum
CREATE TYPE "TopBarBehavior" AS ENUM ('STATIC', 'SCROLLING');

-- CreateEnum
CREATE TYPE "PopupTrigger" AS ENUM ('ON_LOAD', 'AFTER_DELAY', 'ON_EXIT_INTENT');

-- CreateEnum
CREATE TYPE "PopupFrequency" AS ENUM ('EVERY_VISIT', 'ONCE_PER_SESSION', 'ONCE_PER_DAY', 'ONCE_EVER');

-- CreateTable
CREATE TABLE "agency_site_config" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "under_construction" BOOLEAN NOT NULL DEFAULT false,
    "construction_headline" TEXT,
    "construction_message" TEXT,
    "top_bar_enabled" BOOLEAN NOT NULL DEFAULT false,
    "top_bar_text" TEXT,
    "top_bar_behavior" "TopBarBehavior" NOT NULL DEFAULT 'STATIC',
    "top_bar_background_color" TEXT,
    "top_bar_link_url" TEXT,
    "top_bar_dismissible" BOOLEAN NOT NULL DEFAULT true,
    "popup_enabled" BOOLEAN NOT NULL DEFAULT false,
    "popup_title" TEXT,
    "popup_body" TEXT,
    "popup_cta_label" TEXT,
    "popup_cta_url" TEXT,
    "popup_trigger" "PopupTrigger" NOT NULL DEFAULT 'AFTER_DELAY',
    "popup_delay_seconds" INTEGER NOT NULL DEFAULT 5,
    "popup_frequency" "PopupFrequency" NOT NULL DEFAULT 'ONCE_PER_SESSION',
    "show_funtush_badge" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_site_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_site_config_agency_id_key" ON "agency_site_config"("agency_id");

-- AddForeignKey
ALTER TABLE "agency_site_config" ADD CONSTRAINT "agency_site_config_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

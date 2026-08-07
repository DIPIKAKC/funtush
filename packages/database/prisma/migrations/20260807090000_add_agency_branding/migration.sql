-- CreateEnum
CREATE TYPE "CardImageRatio" AS ENUM ('RATIO_1_1', 'RATIO_4_3', 'RATIO_16_9');

-- CreateEnum
CREATE TYPE "CurrencyDisplay" AS ENUM ('SYMBOL', 'CODE', 'SYMBOL_CODE');

-- CreateTable
CREATE TABLE "agency_branding" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "brand_name" TEXT,
    "logo_url" TEXT,
    "favicon_url" TEXT,
    "primary_color" TEXT,
    "palette_id" TEXT,
    "font_family" TEXT,
    "card_image_ratio" "CardImageRatio" NOT NULL DEFAULT 'RATIO_4_3',
    "currency_code" TEXT NOT NULL DEFAULT 'NPR',
    "currency_symbol" TEXT,
    "currency_display" "CurrencyDisplay" NOT NULL DEFAULT 'SYMBOL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_branding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_branding_agency_id_key" ON "agency_branding"("agency_id");

-- AddForeignKey
ALTER TABLE "agency_branding" ADD CONSTRAINT "agency_branding_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

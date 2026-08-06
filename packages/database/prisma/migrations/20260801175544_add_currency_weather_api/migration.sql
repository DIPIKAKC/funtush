-- AlterTable
ALTER TABLE "agency_profiles" ADD COLUMN     "currency_converter_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weather_enabled" BOOLEAN NOT NULL DEFAULT false;

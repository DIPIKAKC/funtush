-- AlterTable
ALTER TABLE "agency_profiles" ADD COLUMN     "googleMapsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "liveChatCode" TEXT,
ADD COLUMN     "liveChatEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappNumber" TEXT;

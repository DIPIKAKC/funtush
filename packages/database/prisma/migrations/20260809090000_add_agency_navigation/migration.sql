-- CreateEnum
CREATE TYPE "NavigationLinkType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateTable
CREATE TABLE "agency_navigation" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "book_now_label" TEXT,
    "book_now_hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_navigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_navigation_items" (
    "id" TEXT NOT NULL,
    "navigation_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "label" TEXT NOT NULL,
    "link_type" "NavigationLinkType" NOT NULL,
    "url" TEXT NOT NULL,
    "open_in_new_tab" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_navigation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_navigation_agency_id_key" ON "agency_navigation"("agency_id");

-- CreateIndex
CREATE INDEX "agency_navigation_items_navigation_id_idx" ON "agency_navigation_items"("navigation_id");

-- CreateIndex
CREATE INDEX "agency_navigation_items_parent_id_idx" ON "agency_navigation_items"("parent_id");

-- AddForeignKey
ALTER TABLE "agency_navigation" ADD CONSTRAINT "agency_navigation_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_navigation_items" ADD CONSTRAINT "agency_navigation_items_navigation_id_fkey" FOREIGN KEY ("navigation_id") REFERENCES "agency_navigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_navigation_items" ADD CONSTRAINT "agency_navigation_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "agency_navigation_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

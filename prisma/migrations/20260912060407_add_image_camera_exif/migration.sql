-- AlterTable
ALTER TABLE "images" ADD COLUMN "exif" JSONB;
ALTER TABLE "images" ADD COLUMN "lens" TEXT;
ALTER TABLE "images" ADD COLUMN "make" TEXT;
ALTER TABLE "images" ADD COLUMN "model" TEXT;

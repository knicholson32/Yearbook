-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "original" TEXT NOT NULL,
    "originalExtension" TEXT NOT NULL,
    "full" TEXT,
    "i2048" TEXT,
    "i1024" TEXT,
    "i768" TEXT,
    "i512" TEXT NOT NULL,
    "i256" BLOB NOT NULL,
    "i128" BLOB NOT NULL,
    "hash" TEXT NOT NULL,
    "date" INTEGER NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "altitude" REAL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "isHDR" BOOLEAN NOT NULL,
    "aspectRatio" DECIMAL NOT NULL,
    "hex" TEXT NOT NULL,
    "hexa" TEXT NOT NULL,
    "rgb" TEXT NOT NULL,
    "rgba" TEXT NOT NULL,
    "isLight" BOOLEAN NOT NULL,
    "isDark" BOOLEAN NOT NULL,
    "userId" TEXT NOT NULL,
    "monthId" TEXT,
    CONSTRAINT "images_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "images_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "month" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "year" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);

-- CreateTable
CREATE TABLE "month" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "month" INTEGER NOT NULL,
    "yearId" INTEGER NOT NULL,
    CONSTRAINT "month_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "year" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "families" (
    "id" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "imageId" TEXT,
    "familyId" TEXT NOT NULL,
    CONSTRAINT "people_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "people_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gravatarHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    CONSTRAINT "users_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "month_yearId_month_key" ON "month"("yearId", "month");

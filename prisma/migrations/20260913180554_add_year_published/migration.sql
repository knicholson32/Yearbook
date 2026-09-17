-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_year" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATETIME,
    "title" TEXT
);
INSERT INTO "new_year" ("id") SELECT "id" FROM "year";
DROP TABLE "year";
ALTER TABLE "new_year" RENAME TO "year";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

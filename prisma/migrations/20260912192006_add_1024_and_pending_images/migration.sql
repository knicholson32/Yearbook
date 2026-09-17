-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "original" TEXT NOT NULL,
    "originalExtension" TEXT NOT NULL,
    "full" TEXT,
    "i1024" TEXT,
    "i768" TEXT,
    "i512" TEXT NOT NULL,
    "i256" BLOB NOT NULL,
    "i128" BLOB NOT NULL,
    "hash" TEXT NOT NULL,
    "pendingForId" INTEGER,
    "caption" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "make" TEXT,
    "model" TEXT,
    "lens" TEXT,
    "exif" JSONB,
    "dateWarningDismissed" BOOLEAN NOT NULL DEFAULT false,
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
    CONSTRAINT "images_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "month" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "images_pendingForId_fkey" FOREIGN KEY ("pendingForId") REFERENCES "year" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_images" ("altitude", "aspectRatio", "caption", "date", "dateWarningDismissed", "exif", "full", "hash", "height", "hex", "hexa", "i128", "i256", "i512", "i768", "id", "isDark", "isHDR", "isLight", "latitude", "lens", "longitude", "make", "model", "monthId", "original", "originalExtension", "rgb", "rgba", "sort", "userId", "width") SELECT "altitude", "aspectRatio", "caption", "date", "dateWarningDismissed", "exif", "full", "hash", "height", "hex", "hexa", "i128", "i256", "i512", "i768", "id", "isDark", "isHDR", "isLight", "latitude", "lens", "longitude", "make", "model", "monthId", "original", "originalExtension", "rgb", "rgba", "sort", "userId", "width" FROM "images";
DROP TABLE "images";
ALTER TABLE "new_images" RENAME TO "images";
CREATE INDEX "images_monthId_sort_idx" ON "images"("monthId", "sort");
CREATE INDEX "images_pendingForId_idx" ON "images"("pendingForId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

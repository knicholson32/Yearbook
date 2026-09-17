-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_images" (
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
    "caption" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_images" ("altitude", "aspectRatio", "date", "full", "hash", "height", "hex", "hexa", "i1024", "i128", "i2048", "i256", "i512", "i768", "id", "isDark", "isHDR", "isLight", "latitude", "longitude", "monthId", "original", "originalExtension", "rgb", "rgba", "userId", "width") SELECT "altitude", "aspectRatio", "date", "full", "hash", "height", "hex", "hexa", "i1024", "i128", "i2048", "i256", "i512", "i768", "id", "isDark", "isHDR", "isLight", "latitude", "longitude", "monthId", "original", "originalExtension", "rgb", "rgba", "userId", "width" FROM "images";
DROP TABLE "images";
ALTER TABLE "new_images" RENAME TO "images";
CREATE INDEX "images_monthId_sort_idx" ON "images"("monthId", "sort");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

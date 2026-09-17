-- CreateTable
CREATE TABLE "month_captions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    CONSTRAINT "month_captions_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "month" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "month_captions_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "month_captions_monthId_familyId_key" ON "month_captions"("monthId", "familyId");

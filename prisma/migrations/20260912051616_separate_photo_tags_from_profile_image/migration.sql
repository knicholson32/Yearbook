-- CreateTable
CREATE TABLE "_PeopleInImage" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_PeopleInImage_A_fkey" FOREIGN KEY ("A") REFERENCES "images" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_PeopleInImage_B_fkey" FOREIGN KEY ("B") REFERENCES "people" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "_PeopleInImage_AB_unique" ON "_PeopleInImage"("A", "B");

-- CreateIndex
CREATE INDEX "_PeopleInImage_B_index" ON "_PeopleInImage"("B");

-- Records unique indexes that were applied to the dev database with `prisma db push`
-- but never written to migration history. Marked as already-applied via
-- `prisma migrate resolve` on the existing dev database.
CREATE UNIQUE INDEX "people_name_key" ON "people"("name");
CREATE UNIQUE INDEX "users_personId_key" ON "users"("personId");

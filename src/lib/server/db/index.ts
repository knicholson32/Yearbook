import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '$base/generated/prisma/client';
import { env } from '$env/dynamic/private';

const adapter = new PrismaBetterSqlite3({
  url: env.DATABASE_URL
});

export const prisma = new PrismaClient({ adapter })
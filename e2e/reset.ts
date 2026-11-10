/** Empties the e2e database before seeding (refuses to touch anything not named *e2e*). */
import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/e2e/.test(url.split("/").pop() ?? "")) throw new Error(`Refusing to reset non-e2e database: ${url}`);
  const db = new PrismaClient();
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`);
  await db.$disconnect();
}
main();

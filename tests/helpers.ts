import type { AgeRating, Role } from "@prisma/client";
import { db } from "@/lib/db";

export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`);
}

let n = 0;
export async function makeUser(role: Role = "READER", extra: { dateOfBirth?: Date | null; email?: string; status?: "ACTIVE" | "RESTRICTED" | "BLOCKED" } = {}) {
  n++;
  return db.user.create({
    data: { email: extra.email ?? `u${n}-${Date.now()}@x.com`, displayName: `User ${n}`, role, passwordHash: "x", dateOfBirth: extra.dateOfBirth === undefined ? new Date("1990-01-01") : extra.dateOfBirth, status: extra.status ?? "ACTIVE" },
    include: { authorProfile: true, editorProfile: true },
  });
}

export async function makeEditor() {
  const u = await makeUser("EDITOR");
  const p = await db.editorProfile.create({ data: { userId: u.id, contactEmail: u.email, genres: [], languages: [] } });
  return { user: { ...u, editorProfile: p }, profile: p };
}

/** An on-sale book by a fresh author (with pen name + contract), managed by a fresh editor. */
export async function makeBook(opts: { chapters?: number; lock?: number; price?: number; age?: AgeRating; language?: string; genres?: string[]; royalty?: number; publishedAt?: Date } = {}) {
  const { user: editorUser, profile: editor } = await makeEditor();
  const authorUser = await makeUser("AUTHOR");
  const referral = await db.referral.upsert({ where: { code: "AA0000" }, update: { authorCount: { increment: 1 } }, create: { code: "AA0000", label: "Direct", authorCount: 1 } });
  const author = await db.authorProfile.create({ data: { userId: authorUser.id, referralId: referral.id, authorNumber: referral.authorCount, internalCode: `AA0000-${String(referral.authorCount).padStart(6, "0")}`, editorId: editor.id } });
  n++;
  const pen = await db.penName.create({ data: { name: `Pen ${n}`, slug: `pen-${n}-${Date.now()}`, authorId: author.id, editorId: editor.id } });
  const chapters = opts.chapters ?? 10;
  const book = await db.book.create({
    data: {
      code: `BK${n}X${Date.now() % 100000}`, title: `Book ${n}`, synopsis: "s", language: opts.language ?? "en", genres: opts.genres ?? ["Fantasy"], ageRating: opts.age ?? "ALL",
      status: "ON_SALE", lockChapter: opts.lock ?? 4, wholeBookPriceCents: opts.price ?? 500, publishedAt: opts.publishedAt ?? new Date(), acceptedAt: new Date(),
      submitterId: authorUser.id, penNameId: pen.id, editorId: editor.id,
      chapters: { create: Array.from({ length: chapters }, (_, i) => ({ number: i + 1, title: `C${i + 1}`, content: `text ${i + 1}` })) },
      contracts: { create: { authorId: author.id, royaltyPercent: opts.royalty ?? 40, signedAt: new Date() } },
    },
    include: { chapters: { orderBy: { number: "asc" } } },
  });
  const authorFull = await db.user.findUniqueOrThrow({ where: { id: authorUser.id }, include: { authorProfile: true, editorProfile: true } });
  return { book, author, authorUser: authorFull, editor, editorUser, pen };
}

export async function fund(userId: string, cents: number) {
  const w = await db.wallet.upsert({ where: { userId }, update: { balanceCents: { increment: cents } }, create: { userId, balanceCents: cents } });
  await db.ledgerEntry.create({ data: { walletId: w.id, type: "TOP_UP", amountCents: cents, reference: `fund-${Date.now()}-${Math.random()}` } });
}

export function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

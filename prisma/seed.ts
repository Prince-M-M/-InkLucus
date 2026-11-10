/**
 * Demo data for local development and automated tests. All demo accounts use the password
 * "password123". Refuses to run against production unless SEED_DEMO=true.
 */
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();
const DAY = 86_400_000;
const PERIOD_EPOCH = Date.UTC(2026, 0, 5);
const periodStart = (d: Date) => new Date(PERIOD_EPOCH + Math.floor((d.getTime() - PERIOD_EPOCH) / (14 * DAY)) * 14 * DAY);

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_DEMO !== "true") throw new Error("Refusing to seed demo data in production");
  const pw = await bcrypt.hash("password123", 10);
  const dob = new Date("1995-06-15T00:00:00Z");
  const mk = (email: string, displayName: string, role: Role, dateOfBirth: Date | null = dob) =>
    db.user.upsert({ where: { email }, update: {}, create: { email, displayName, role, passwordHash: pw, dateOfBirth } });

  const admin = await mk("admin@example.com", "Admin", "ADMIN");
  await mk("accounts@example.com", "Accounts", "ACCOUNTING");
  const editorUser = await mk("editor@example.com", "Tariro (Editor)", "EDITOR");
  const authorUser = await mk("author@example.com", "Author Account", "AUTHOR");
  const reader = await mk("reader@example.com", "Reader", "READER");
  const teen = await mk("teen@example.com", "Teen Reader", "READER", new Date(Date.now() - 14 * 365.25 * DAY));

  await db.editorProfile.upsert({ where: { userId: admin.id }, update: {}, create: { userId: admin.id, contactEmail: "admin@example.com", genres: [], languages: [] } });
  const editor = await db.editorProfile.upsert({
    where: { userId: editorUser.id }, update: {},
    create: { userId: editorUser.id, contactEmail: "editor@example.com", contactPhone: "+263 77 000 0000", genres: ["Fantasy", "Romance"], languages: ["en", "sn"] },
  });
  const referral = await db.referral.upsert({ where: { code: "AA1234" }, update: {}, create: { code: "AA1234", label: "Scout campaign", authorCount: 1 } });
  const author = await db.authorProfile.upsert({
    where: { userId: authorUser.id }, update: {},
    create: { userId: authorUser.id, referralId: referral.id, authorNumber: 1, internalCode: "AA1234-000001", editorId: editor.id },
  });
  const pen = await db.penName.upsert({ where: { slug: "rudo-moyo" }, update: {}, create: { name: "Rudo Moyo", slug: "rudo-moyo", authorId: author.id, editorId: editor.id, bio: "Writes fantasy and romance in English and Shona." } });

  for (const [cents, user] of [[2000, reader], [500, authorUser], [1000, teen]] as const) {
    await db.wallet.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, balanceCents: cents, entries: { create: { type: "TOP_UP", amountCents: cents, reference: `seed-${user.id}` } } } });
  }

  const books = [
    { code: "BKSEED0001", title: "The River Queen", language: "en", genres: ["Fantasy"], chapters: 120, age: "ALL" as const, group: "RIVER" },
    { code: "BKSEED0002", title: "Rudo Rwemoyo", language: "sn", genres: ["Romance"], chapters: 30, age: "ALL" as const, group: null },
    { code: "BKSEED0003", title: "Mambokadzi weRwizi", language: "sn", genres: ["Fantasy"], chapters: 12, age: "ALL" as const, group: "RIVER" },
    { code: "BKSEED0004", title: "Midnight in Harare", language: "en", genres: ["Thriller", "Romance"], chapters: 10, age: "ADULT_18" as const, group: null },
  ];
  const now = new Date();
  for (const b of books) {
    const book = await db.book.upsert({
      where: { code: b.code }, update: {},
      create: {
        code: b.code, title: b.title, synopsis: `${b.title}: a story told in ${b.chapters} chapters. Rain, rivers and the people who wait for them.`,
        language: b.language, genres: b.genres, ageRating: b.age, editionGroup: b.group,
        status: "ON_SALE", lockChapter: 6, wholeBookPriceCents: b.chapters > 50 ? 999 : 399, publishedAt: new Date(now.getTime() - 10 * DAY), acceptedAt: new Date(now.getTime() - 20 * DAY),
        submitterId: authorUser.id, penNameId: pen.id, editorId: editor.id,
        editorReview: "A gripping voice I couldn't put down.",
        audioPriceCents: b.code === "BKSEED0001" ? 599 : null, videoPriceCents: b.code === "BKSEED0001" ? 1499 : null, videoDiscountPercentForOwners: b.code === "BKSEED0001" ? 30 : 0,
        chapters: { create: Array.from({ length: b.chapters }, (_, i) => ({ number: i + 1, title: `Chapter ${i + 1}`, content: `This is chapter ${i + 1} of ${b.title}.\n\nThe river ran high that year, and nobody in the village slept.`, wordCount: 20 })) },
        contracts: { create: { authorId: author.id, royaltyPercent: 40, signedAt: new Date(now.getTime() - 15 * DAY) } },
      },
    });
    if (b.chapters > 50) {
      for (let i = 0, first = 6; first <= b.chapters; i++, first += 50) {
        const last = Math.min(b.chapters, first + 49);
        await db.section.upsert({ where: { bookId_index: { bookId: book.id, index: i + 1 } }, update: {}, create: { bookId: book.id, index: i + 1, firstChapter: first, lastChapter: last, priceCents: Math.round((449 * (last - first + 1)) / 50) } });
      }
    }
    if (b.code === "BKSEED0001" && (await db.mediaItem.count({ where: { bookId: book.id } })) === 0) {
      await db.mediaItem.createMany({ data: [
        { bookId: book.id, kind: "AUDIO", number: 1, title: "Chapters 1–5", url: "https://example.com/media/river-queen-1.mp3" },
        { bookId: book.id, kind: "VIDEO", number: 1, title: "Episode 1", url: "https://example.com/media/river-queen-ep1.mp4" },
      ] });
    }
    const start = periodStart(now);
    const end = new Date(start.getTime() + 14 * DAY);
    const list = b.language === "sn" ? "FEATURED_LANGUAGE" : "EDITORS_PICKS";
    await db.homepageSlot.upsert({
      where: { list_bookId_startsAt: { list, bookId: book.id, startsAt: start } }, update: {},
      create: { list, language: b.language, bookId: book.id, proposedById: editor.id, approvedById: admin.id, status: "APPROVED", startsAt: start, endsAt: end },
    });
  }
  // A few sales so statistics, royalties and reports have something to show.
  const rudo = await db.book.findUniqueOrThrow({ where: { code: "BKSEED0002" } });
  if ((await db.purchase.count({ where: { userId: reader.id, bookId: rudo.id } })) === 0) {
    const p = await db.purchase.create({ data: { userId: reader.id, bookId: rudo.id, amountCents: 399, createdAt: new Date(now.getTime() - 2 * DAY) } });
    const w = await db.wallet.findUniqueOrThrow({ where: { userId: reader.id } });
    await db.wallet.update({ where: { id: w.id }, data: { balanceCents: { decrement: 399 } } });
    await db.ledgerEntry.create({ data: { walletId: w.id, type: "PURCHASE", amountCents: -399, reference: p.id } });
    await db.readingProgress.create({ data: { userId: reader.id, bookId: rudo.id, lastChapter: 8 } });
    await db.review.create({ data: { userId: reader.id, bookId: rudo.id, rating: 5, body: "Ndakaifarira chaizvo!" } });
    await db.bookLike.create({ data: { userId: reader.id, bookId: rudo.id } });
  }
  if ((await db.socialLink.count()) === 0) {
    await db.socialLink.createMany({ data: [
      { audience: "READER", platform: "discord", label: "Readers' Discord", url: "https://discord.com" },
      { audience: "AUTHOR", platform: "facebook", label: "Authors' Facebook group", url: "https://facebook.com" },
    ] });
  }
  console.log("Seeded. Log in as reader@example.com / password123 (also author@, editor@, admin@, accounts@, teen@)");
}

main().finally(() => db.$disconnect());

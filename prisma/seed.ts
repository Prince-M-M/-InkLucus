import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const pw = await bcrypt.hash("password123", 12);
  const mk = (email: string, displayName: string, role: "READER" | "AUTHOR" | "EDITOR" | "ACCOUNTING" | "ADMIN") =>
    db.user.upsert({ where: { email }, update: {}, create: { email, displayName, role, passwordHash: pw } });

  await mk("admin@example.com", "Admin", "ADMIN");
  await mk("accounts@example.com", "Accounts", "ACCOUNTING");
  const editorUser = await mk("editor@example.com", "Tariro (Editor)", "EDITOR");
  const authorUser = await mk("author@example.com", "Author Account", "AUTHOR");
  const reader = await mk("reader@example.com", "Reader", "READER");

  const editor = await db.editorProfile.upsert({
    where: { userId: editorUser.id }, update: {},
    create: { userId: editorUser.id, contactEmail: "editor@example.com", genres: ["Fantasy", "Romance"], languages: ["en", "sn"] },
  });
  const referral = await db.referral.upsert({ where: { code: "AA1234" }, update: {}, create: { code: "AA1234", label: "Scout campaign", authorCount: 1 } });
  const author = await db.authorProfile.upsert({
    where: { userId: authorUser.id }, update: {},
    create: { userId: authorUser.id, referralId: referral.id, authorNumber: 1, internalCode: "AA1234-000001", editorId: editor.id },
  });
  const pen = await db.penName.upsert({ where: { slug: "rudo-moyo" }, update: {}, create: { name: "Rudo Moyo", slug: "rudo-moyo", authorId: author.id, editorId: editor.id } });

  for (const [wallet, user] of [[2000, reader], [500, authorUser]] as const) {
    await db.wallet.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, balanceCents: wallet, entries: { create: { type: "TOP_UP", amountCents: wallet, reference: `seed-${user.id}` } } } });
  }

  const books = [
    { code: "BKSEED0001", title: "The River Queen", language: "en", genres: ["Fantasy"], chapters: 120 },
    { code: "BKSEED0002", title: "Rudo Rwemoyo", language: "sn", genres: ["Romance"], chapters: 30 },
  ];
  for (const b of books) {
    const book = await db.book.upsert({
      where: { code: b.code }, update: {},
      create: {
        code: b.code, title: b.title, synopsis: `Synopsis of ${b.title}.`, language: b.language, genres: b.genres,
        status: "ON_SALE", lockChapter: 6, wholeBookPriceCents: b.chapters > 50 ? 999 : 399, publishedAt: new Date(),
        submitterId: authorUser.id, penNameId: pen.id, editorId: editor.id, isbn: null,
        editorReview: "A gripping voice I couldn't put down.",
        chapters: { create: Array.from({ length: b.chapters }, (_, i) => ({ number: i + 1, title: `Chapter ${i + 1}`, content: `This is chapter ${i + 1} of ${b.title}.\n\nLorem ipsum dolor sit amet.` })) },
      },
    });
    if (b.chapters > 50) {
      for (let i = 0, first = 6; first <= b.chapters; i++, first += 50) {
        await db.section.upsert({ where: { bookId_index: { bookId: book.id, index: i + 1 } }, update: {}, create: { bookId: book.id, index: i + 1, firstChapter: first, lastChapter: Math.min(b.chapters, first + 49), priceCents: 449 } });
      }
    }
    const now = new Date();
    const in14 = new Date(now.getTime() + 14 * 86_400_000);
    await db.homepageSlot.create({ data: { list: b.language === "sn" ? "FEATURED_LANGUAGE" : "EDITORS_PICKS", language: b.language, bookId: book.id, proposedById: editor.id, status: "APPROVED", startsAt: now, endsAt: in14 } });
  }
  await db.socialLink.createMany({ data: [
    { audience: "READER", platform: "discord", label: "Readers' Discord", url: "https://discord.com" },
    { audience: "AUTHOR", platform: "facebook", label: "Authors' Facebook group", url: "https://facebook.com" },
  ] });
  console.log("Seeded. Log in as reader@example.com / password123");
}

main().finally(() => db.$disconnect());

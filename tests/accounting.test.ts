import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addAdjustment, authorIncome, finalizeStatement, generateStatements, lastCompletedPeriod, royaltyFor } from "@/lib/royalties";
import { editorGross, financeSummary, purchasesByBook } from "@/lib/reports";
import { adjustWallet, buyGiftCard, purchaseBook, redeemGiftCard } from "@/lib/wallet";
import { periodFor } from "@/lib/homepage";
import { authorStats, editorPerformance, readerStats, salesStats } from "@/lib/stats";
import { recordRead } from "@/lib/reading";
import { saveReview } from "@/lib/engagement";
import { fund, makeBook, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const DAY = 86_400_000;

async function saleIn(bookId: string, userId: string, at: Date, cents: number) {
  return db.purchase.create({ data: { userId, bookId, amountCents: cents, createdAt: at } });
}

describe("royalty formula", () => {
  it("applies cost deduction then royalty %, rounded to the cent", () => {
    expect(royaltyFor(1000, 40, 0)).toBe(400);
    expect(royaltyFor(1000, 40, 25)).toBe(300);
    expect(royaltyFor(999, 33, 0)).toBe(330); // 329.67
    expect(royaltyFor(0, 50, 0)).toBe(0);
  });
});

describe("biweekly statements", () => {
  it("are generated from sales in the period, idempotently, and lock when final", async () => {
    const { book, author } = await makeBook({ royalty: 40 });
    const other = await makeBook({ royalty: 50 });
    const r = await makeUser();
    const acct = await makeUser("ACCOUNTING");
    const period = lastCompletedPeriod();
    const mid = new Date(period.start.getTime() + 3 * DAY);
    await saleIn(book.id, r.id, mid, 500);
    await saleIn(book.id, r.id, mid, 250);
    await saleIn(other.book.id, r.id, mid, 1000);
    await saleIn(book.id, r.id, new Date(period.end.getTime() + DAY), 9999); // next period: excluded

    expect(await generateStatements(period)).toBe(2);
    expect(await generateStatements(period)).toBe(2); // re-run doesn't duplicate
    const st = await db.royaltyStatement.findUniqueOrThrow({ where: { authorId_periodStart: { authorId: author.id, periodStart: period.start } }, include: { lines: true } });
    expect([st.grossCents, st.amountCents, st.lines.length, st.lines[0].copies]).toEqual([750, 300, 1, 2]);

    await expect(addAdjustment(r.id, st.id, 100, "bonus")).rejects.toThrow(/Accounting only/);
    await expect(addAdjustment(acct.id, st.id, 100, "")).rejects.toThrow(/Explain/);
    await addAdjustment(acct.id, st.id, -50, "Refund for duplicate purchase");
    expect((await db.royaltyStatement.findUniqueOrThrow({ where: { id: st.id } })).amountCents).toBe(250);

    // A late sale recalculates drafts but keeps the adjustment.
    await saleIn(book.id, r.id, mid, 250);
    await generateStatements(period);
    expect((await db.royaltyStatement.findUniqueOrThrow({ where: { id: st.id } })).amountCents).toBe(350);

    expect((await authorIncome(author.id)).totalCents).toBe(0); // drafts aren't income yet
    await finalizeStatement(acct.id, st.id);
    await expect(addAdjustment(acct.id, st.id, 1, "late")).rejects.toThrow(/Final/);
    await saleIn(book.id, r.id, mid, 1000);
    await generateStatements(period);
    expect((await db.royaltyStatement.findUniqueOrThrow({ where: { id: st.id } })).amountCents).toBe(350); // final is locked
    expect((await authorIncome(author.id)).totalCents).toBe(350);
  });

  it("can't finalise a period that hasn't ended", async () => {
    const { book } = await makeBook();
    const r = await makeUser(), acct = await makeUser("ACCOUNTING");
    const current = periodFor(new Date());
    await saleIn(book.id, r.id, new Date(), 500);
    await generateStatements(current);
    const st = await db.royaltyStatement.findFirstOrThrow();
    await expect(finalizeStatement(acct.id, st.id)).rejects.toThrow(/hasn't ended/);
  });
});

describe("finance reports", () => {
  it("tracks wallet and gift card reserves as money moves", async () => {
    const { book, editor } = await makeBook({ price: 300 });
    const [a, b] = [await makeUser(), await makeUser()];
    await fund(a.id, 2000);
    const period = { start: new Date(Date.now() - DAY), end: new Date(Date.now() + DAY) };
    let f = await financeSummary(period);
    expect([f.walletReservesCents, f.giftCardReservesCents]).toEqual([2000, 0]);

    const card = await buyGiftCard(a.id, 500);
    f = await financeSummary(period);
    expect([f.walletReservesCents, f.giftCardReservesCents]).toEqual([1500, 500]);

    await redeemGiftCard(b.id, card.code);
    await purchaseBook(b.id, book.id);
    f = await financeSummary(period);
    expect([f.walletReservesCents, f.giftCardReservesCents, f.giftCardsRedeemedCents, f.salesCents]).toEqual([1700, 0, 500, 300]);

    const gross = await editorGross(period);
    expect(gross.find((g) => g.editorId === editor.id)).toMatchObject({ cents: 300, copies: 1 });
    const rows = await purchasesByBook(period);
    expect(rows[0]).toMatchObject({ code: book.code, copies: 1, textCents: 300, totalCents: 300, hasContract: true });
  });

  it("wallet adjustments are accounting-only, noted, and can't overdraw", async () => {
    const r = await makeUser(), acct = await makeUser("ACCOUNTING"), admin = await makeUser("ADMIN");
    await fund(r.id, 100);
    await expect(adjustWallet(admin.id, r.id, 100, "x")).rejects.toThrow(/Accounting only/);
    await expect(adjustWallet(acct.id, r.id, 100, " ")).rejects.toThrow(/note/);
    await expect(adjustWallet(acct.id, r.id, -500, "fix")).rejects.toThrow(/lower/);
    await adjustWallet(acct.id, r.id, 250, "Paynow payment confirmed manually");
    const w = await db.wallet.findUniqueOrThrow({ where: { userId: r.id }, include: { entries: true } });
    expect(w.balanceCents).toBe(350);
    expect(w.entries.find((e) => e.type === "ADJUSTMENT")).toMatchObject({ createdById: acct.id, note: "Paynow payment confirmed manually" });
  });
});

describe("statistics", () => {
  it("author: copies per month, likes, wishlists, views, reviews", async () => {
    const { book, author } = await makeBook();
    const r = await makeUser();
    const now = new Date();
    await saleIn(book.id, r.id, now, 500);
    await saleIn(book.id, r.id, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)), 500);
    await db.bookLike.create({ data: { userId: r.id, bookId: book.id } });
    await db.wishlistItem.create({ data: { userId: r.id, bookId: book.id } });
    await recordRead(r.id, book.id, book.chapters[0].id, 1);
    await saveReview(r, book.id, 4, "nice");
    const s = await authorStats(author.id, 6, now);
    expect(s.totals.copies).toBe(2);
    expect(s.totals.monthly.slice(-2)).toEqual([1, 1]);
    expect(s.books[0]).toMatchObject({ views: 1, reviewCount: 1, avgRating: 4 });
    expect(s.totals).toMatchObject({ likes: 1, wishlists: 1 });
  });

  it("editor/admin: breakdowns by new vs older, genre, age, language; best & worst reviewed", async () => {
    const fresh = await makeBook({ genres: ["Romance"], language: "sn", age: "MATURE_16" });
    const old = await makeBook({ genres: ["Fantasy"], publishedAt: new Date(Date.now() - 200 * DAY) });
    const r = await makeUser();
    await saleIn(fresh.book.id, r.id, new Date(), 400);
    await saleIn(old.book.id, r.id, new Date(), 100);
    for (const [b, stars] of [[fresh.book, 5], [old.book, 2]] as const) {
      await recordRead(r.id, b.id, b.chapters[0].id, 1);
      await saveReview(r, b.id, stars, "");
    }
    const period = { start: new Date(Date.now() - DAY), end: new Date(Date.now() + DAY) };
    const all = await salesStats("all", period);
    expect(all.totals).toEqual({ copies: 2, cents: 500 });
    expect(all.byNew.map((x) => [x.key, x.cents])).toEqual([["New (last 40 days)", 400], ["Older", 100]]);
    expect(all.byLanguage.find((x) => x.key === "sn")?.cents).toBe(400);
    expect(all.byAgeRating.find((x) => x.key === "MATURE_16")?.cents).toBe(400);
    expect(all.bestReviewed[0].code).toBe(fresh.book.code);
    expect(all.worstReviewed[0].code).toBe(old.book.code);
    const mine = await salesStats({ editorId: fresh.editor.id }, period);
    expect(mine.books.map((b) => b.code)).toEqual([fresh.book.code]);

    const perf = await editorPerformance(period);
    expect(perf.find((p) => p.editorId === fresh.editor.id)).toMatchObject({ newBooksTaken: 1, copies: 1, cents: 400, reviews: 1 });
  });

  it("reader: books started/finished and progress", async () => {
    const { book } = await makeBook({ chapters: 2 });
    const r = await makeUser();
    await recordRead(r.id, book.id, book.chapters[1].id, 2);
    const s = await readerStats(r.id);
    expect([s.booksStarted, s.booksFinished, s.books[0].percent]).toEqual([1, 1, 100]);
  });
});

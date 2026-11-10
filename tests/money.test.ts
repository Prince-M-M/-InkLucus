import { beforeEach, describe, expect, it, afterAll } from "vitest";
import { db } from "@/lib/db";
import { buyGiftCard, purchaseBook, redeemGiftCard, topUp, transfer, expireGiftCards } from "@/lib/wallet";
import { promoteToAuthor, addPenName } from "@/lib/authors";
import { claimFromPool, submitBook } from "@/lib/submissions";

async function user(email: string, role: "READER" | "AUTHOR" | "EDITOR" = "READER") {
  return db.user.create({ data: { email, displayName: email, role, passwordHash: "x" } });
}
const balance = async (userId: string) => (await db.wallet.findUniqueOrThrow({ where: { userId } })).balanceCents;
async function ledgerMatchesBalance(userId: string) {
  const w = await db.wallet.findUniqueOrThrow({ where: { userId }, include: { entries: true } });
  return w.entries.reduce((s, e) => s + e.amountCents, 0) === w.balanceCents;
}

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`);
});
afterAll(() => db.$disconnect());

describe("wallet", () => {
  it("top-ups are idempotent per payment reference", async () => {
    const a = await user("a@x.com");
    await topUp(a.id, 1000, "pay_1");
    await topUp(a.id, 1000, "pay_1");
    expect(await balance(a.id)).toBe(1000);
  });

  it("transfers move funds and cannot overdraw, even concurrently", async () => {
    const a = await user("a@x.com"), b = await user("b@x.com");
    await topUp(a.id, 1000, "p");
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => transfer(a.id, "b@x.com", 400)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await balance(a.id)).toBe(200);
    expect(await balance(b.id)).toBe(800);
    expect(await ledgerMatchesBalance(a.id)).toBe(true);
  });

  it("gift cards: buy, redeem once, expiry", async () => {
    const a = await user("a@x.com"), b = await user("b@x.com"), c = await user("c@x.com");
    await topUp(a.id, 1000, "p");
    const card = await buyGiftCard(a.id, 500);
    expect(await balance(a.id)).toBe(500);
    expect(await redeemGiftCard(b.id, card.code.toLowerCase())).toBe(500);
    await expect(redeemGiftCard(c.id, card.code)).rejects.toThrow(/already used/);
    expect(await balance(b.id)).toBe(500);

    const old = await buyGiftCard(a.id, 100, new Date("2020-01-01"));
    expect(await expireGiftCards()).toBe(1);
    await expect(redeemGiftCard(c.id, old.code)).rejects.toThrow(/expired/);
  });

  it("editors cannot hold wallets / gift cards", async () => {
    const e = await user("e@x.com", "EDITOR");
    await expect(topUp(e.id, 100, "p")).rejects.toThrow(/Only reader and author/);
  });
});

describe("purchases", () => {
  it("section then whole book: reader only pays the difference", async () => {
    const r = await user("r@x.com"), au = await user("au@x.com");
    await topUp(r.id, 2000, "p");
    const book = await db.book.create({
      data: { code: "BK1", title: "T", synopsis: "s", language: "en", genres: [], status: "ON_SALE", lockChapter: 6, wholeBookPriceCents: 999, submitterId: au.id,
        sections: { create: [{ index: 1, firstChapter: 6, lastChapter: 55, priceCents: 449 }] } },
      include: { sections: true },
    });
    await purchaseBook(r.id, book.id, book.sections[0].id);
    await expect(purchaseBook(r.id, book.id, book.sections[0].id)).rejects.toThrow(/already own/);
    const whole = await purchaseBook(r.id, book.id);
    expect(whole.amountCents).toBe(550);
    expect(await balance(r.id)).toBe(2000 - 999);
    await expect(purchaseBook(r.id, book.id)).rejects.toThrow(/already own/);
  });
});

describe("authors & submissions", () => {
  it("assigns sequential codes per referral, concurrently safe", async () => {
    const admin = await user("admin@x.com", "EDITOR");
    const readers = await Promise.all([1, 2, 3].map((i) => user(`r${i}@x.com`)));
    const profiles = await Promise.all(readers.map((r) => promoteToAuthor({ userId: r.id, actorUserId: admin.id, referralCode: "AA1234" })));
    expect(profiles.map((p) => p.internalCode).sort()).toEqual(["AA1234-000001", "AA1234-000002", "AA1234-000003"]);
    expect((await db.user.findUniqueOrThrow({ where: { id: readers[0].id } })).role).toBe("AUTHOR");
  });

  it("limits pen names to 5", async () => {
    const admin = await user("admin@x.com", "EDITOR"), r = await user("r@x.com");
    const p = await promoteToAuthor({ userId: r.id, actorUserId: admin.id });
    for (let i = 0; i < 5; i++) await addPenName(p.id, `Pen ${i}`);
    await expect(addPenName(p.id, "Pen 6")).rejects.toThrow(/at most 5/);
  });

  it("only one editor can claim a pooled submission", async () => {
    const r = await user("r@x.com");
    const eds = await Promise.all([1, 2].map(async (i) => {
      const u = await user(`e${i}@x.com`, "EDITOR");
      return db.editorProfile.create({ data: { userId: u.id, contactEmail: u.email, genres: [], languages: [] } });
    }));
    const book = await submitBook(r.id, { title: "T", synopsis: "s", language: "sn", genres: ["Romance"] });
    expect(book.status).toBe("IN_POOL");
    const res = await Promise.allSettled(eds.map((e) => claimFromPool(book.id, e.id)));
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
});

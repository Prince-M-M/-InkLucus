import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addChapter, claimFromPool, decide, putOnSale, returnToPool, submitBook, unlist } from "@/lib/submissions";
import { addPenName, assertCanManageAuthor } from "@/lib/authors";

const ch = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `C${i + 1}`, content: `words ${i + 1}` }));
const base = { title: "River", synopsis: "A long enough synopsis here.", language: "sn", genres: ["Romance"] };

async function user(email: string, role: "READER" | "AUTHOR" | "EDITOR" | "ADMIN" = "READER") {
  return db.user.create({ data: { email, displayName: email, role, passwordHash: "x" } });
}
async function editor(email: string) {
  const u = await user(email, "EDITOR");
  return db.editorProfile.create({ data: { userId: u.id, contactEmail: email, genres: [], languages: [] } });
}

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`);
});
afterAll(() => db.$disconnect());

/** reader submits → editor claims → accepts. Returns everything for further steps. */
async function acceptedBook(chapters = 3, referralCode?: string) {
  const reader = await user("reader@x.com");
  const ed = await editor("ed@x.com");
  const book = await submitBook(reader.id, { ...base, chapters: ch(Math.min(chapters, 3)), referralCode });
  if (chapters > 3) {
    await db.chapter.createMany({ data: ch(chapters).slice(3).map((c, i) => ({ bookId: book.id, number: i + 4, ...c })) });
  }
  await claimFromPool(book.id, ed.id);
  await decide(book.id, ed.id, true, "Welcome aboard!");
  const author = await db.authorProfile.findUniqueOrThrow({ where: { userId: reader.id } });
  return { reader, ed, book, author };
}

describe("submission → review → publish", () => {
  it("reader submission goes to the pool with its chapters", async () => {
    const r = await user("r@x.com");
    const b = await submitBook(r.id, { ...base, chapters: ch(3) });
    expect(b.status).toBe("IN_POOL");
    expect(await db.chapter.count({ where: { bookId: b.id } })).toBe(3);
  });

  it("rejects bad referral codes and staff submitters", async () => {
    const r = await user("r@x.com");
    await expect(submitBook(r.id, { ...base, chapters: ch(1), referralCode: "nope" })).rejects.toThrow(/AA1234/);
    const e = await user("e@x.com", "EDITOR");
    await expect(submitBook(e.id, { ...base, chapters: ch(1) })).rejects.toThrow(/Only reader and author/);
  });

  it("accepting promotes the reader using the submission's referral code and assigns the editor", async () => {
    const { reader, ed, book, author } = await acceptedBook(3, "zw1001");
    expect((await db.user.findUniqueOrThrow({ where: { id: reader.id } })).role).toBe("AUTHOR");
    expect(author.internalCode).toBe("ZW1001-000001");
    expect(author.editorId).toBe(ed.id);
    const b = await db.book.findUniqueOrThrow({ where: { id: book.id } });
    expect(b.status).toBe("ACCEPTED");
    expect(b.decisionMessage).toBe("Welcome aboard!");
  });

  it("rejecting leaves the account a reader; decisions need a message and the reviewer", async () => {
    const r = await user("r@x.com");
    const ed = await editor("ed@x.com"), other = await editor("other@x.com");
    const b = await submitBook(r.id, { ...base, chapters: ch(1) });
    await claimFromPool(b.id, ed.id);
    await expect(decide(b.id, other.id, true, "hi")).rejects.toThrow(/not reviewing/);
    await expect(decide(b.id, ed.id, false, "  ")).rejects.toThrow(/message/);
    await decide(b.id, ed.id, false, "Not for us");
    expect((await db.user.findUniqueOrThrow({ where: { id: r.id } })).role).toBe("READER");
  });

  it("an author's next book goes straight to their editor; pen name editor takes priority", async () => {
    const { reader, ed, author } = await acceptedBook();
    const b2 = await submitBook(reader.id, { ...base, chapters: ch(1) });
    expect(b2.status).toBe("UNDER_REVIEW");
    expect(b2.reviewingEditorId).toBe(ed.id);

    const thriller = await editor("thriller@x.com");
    const pen = await addPenName(author.id, "Dark Pen", thriller.id);
    const b3 = await submitBook(reader.id, { ...base, chapters: ch(1), penNameId: pen.id });
    expect(b3.reviewingEditorId).toBe(thriller.id);

    // Passing to the pool (wrong genre) with retagging
    await returnToPool(b3.id, thriller.id, ["Thriller"]);
    const pooled = await db.book.findUniqueOrThrow({ where: { id: b3.id } });
    expect([pooled.status, pooled.reviewingEditorId, pooled.genres]).toEqual(["IN_POOL", null, ["Thriller"]]);
  });

  it("cannot submit under someone else's pen name", async () => {
    const { author } = await acceptedBook();
    const pen = await addPenName(author.id, "Mine");
    const stranger = await user("s@x.com");
    await expect(submitBook(stranger.id, { ...base, chapters: ch(1), penNameId: pen.id })).rejects.toThrow(/not yours/);
  });

  it("publishing records the contract, builds pro-rata sections and puts the book on sale", async () => {
    const { ed, book, author } = await acceptedBook(120);
    const pen = await addPenName(author.id, "Rudo Moyo");
    await putOnSale({
      bookId: book.id, editorProfileId: ed.id, penNameId: pen.id, lockChapter: 6, wholeBookPriceCents: 999,
      chaptersPerSection: 50, sectionPriceCents: 450, royaltyPercent: 40, contractSignedAt: new Date("2026-11-01"), isbn: "978-0-00-000000-0",
    });
    const b = await db.book.findUniqueOrThrow({ where: { id: book.id }, include: { sections: { orderBy: { index: "asc" } }, contracts: true } });
    expect(b.status).toBe("ON_SALE");
    expect(b.publishedAt).not.toBeNull();
    expect(b.contracts[0].royaltyPercent).toBe(40);
    expect(b.sections.map((s) => [s.firstChapter, s.lastChapter, s.priceCents])).toEqual([[6, 55, 450], [56, 105, 450], [106, 120, 135]]);
  });

  it("publishing guards: only the book's editor, only the author's pen names, valid royalty", async () => {
    const { ed, book, author } = await acceptedBook();
    const pen = await addPenName(author.id, "Mine");
    const other = await editor("o@x.com");
    const stranger = await db.authorProfile.create({ data: { userId: (await user("z@x.com", "AUTHOR")).id, referralId: author.referralId, authorNumber: 99, internalCode: "AA0000-000099" } });
    const strangerPen = await addPenName(stranger.id, "Not Theirs");
    const opts = { bookId: book.id, editorProfileId: ed.id, penNameId: pen.id, lockChapter: 2, wholeBookPriceCents: 100, royaltyPercent: 50, contractSignedAt: new Date() };
    await expect(putOnSale({ ...opts, editorProfileId: other.id })).rejects.toThrow(/Not your book/);
    await expect(putOnSale({ ...opts, penNameId: strangerPen.id })).rejects.toThrow(/does not belong/);
    await expect(putOnSale({ ...opts, royaltyPercent: 101 })).rejects.toThrow(/Royalty/);
    await putOnSale(opts);
    await unlist(book.id, ed.id);
    expect((await db.book.findUniqueOrThrow({ where: { id: book.id } })).status).toBe("UNLISTED");
    await putOnSale(opts); // relist
  });

  it("new chapters on a published book extend the last unsold section, pro rata", async () => {
    const { reader, ed, book, author } = await acceptedBook(60);
    const pen = await addPenName(author.id, "Pen P");
    await putOnSale({ bookId: book.id, editorProfileId: ed.id, penNameId: pen.id, lockChapter: 6, wholeBookPriceCents: 999, chaptersPerSection: 50, sectionPriceCents: 500, royaltyPercent: 40, contractSignedAt: new Date() });
    // sections: 6–55 (500), 56–60 (50)
    const c = await addChapter(reader.id, book.id, { title: "", content: "new chapter" });
    expect(c.number).toBe(61);
    expect(c.title).toBe("Chapter 61");
    let last = await db.section.findFirstOrThrow({ where: { bookId: book.id }, orderBy: { index: "desc" } });
    expect([last.firstChapter, last.lastChapter, last.priceCents]).toEqual([56, 61, 60]);

    // Once someone buys the partial section, new chapters open a new section instead of changing what they bought.
    await db.purchase.create({ data: { userId: reader.id, bookId: book.id, sectionId: last.id, amountCents: 60 } });
    await addChapter(reader.id, book.id, { title: "x", content: "more" });
    last = await db.section.findFirstOrThrow({ where: { bookId: book.id }, orderBy: { index: "desc" } });
    expect([last.index, last.firstChapter, last.lastChapter, last.priceCents]).toEqual([3, 62, 62, 10]);
  });

  it("only the book's author can post chapters", async () => {
    const { book } = await acceptedBook();
    const stranger = await user("s@x.com");
    await expect(addChapter(stranger.id, book.id, { title: "t", content: "c" })).rejects.toThrow(/Not your book/);
  });

  it("editors manage pen names only for their own authors; admins for anyone", async () => {
    const { author } = await acceptedBook();
    const other = await editor("o@x.com");
    await expect(assertCanManageAuthor({ role: "EDITOR", editorProfile: { id: other.id } }, author.id)).rejects.toThrow(/not assigned/);
    await expect(assertCanManageAuthor({ role: "ADMIN", editorProfile: null }, author.id)).resolves.toBeUndefined();
    await addPenName(author.id, "Taken");
    await expect(addPenName(author.id, "taken")).rejects.toThrow(/already taken/);
  });
});

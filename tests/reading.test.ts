import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deleteComment, deleteReview, postComment, saveReview, toggleLike, toggleWishlist } from "@/lib/engagement";
import { chapterAccess, mediaAccess, readableChapters, recordRead } from "@/lib/reading";
import { purchaseBook, purchaseMedia } from "@/lib/wallet";
import { addMedia, linkEdition, setMediaPricing } from "@/lib/media";
import { recommendFor } from "@/lib/recommendations";
import { fund, makeBook, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("comments", () => {
  it("only on readable chapters; replies stay on the chapter and one level deep", async () => {
    const { book } = await makeBook({ lock: 4 });
    const r = await makeUser();
    const [free, locked] = [book.chapters[0], book.chapters[5]];
    await expect(postComment(r, locked.id, "hi")).rejects.toThrow(/can read/);
    const top = await postComment(r, free.id, "first!");
    const reply = await postComment(r, free.id, "reply", top.id);
    const nested = await postComment(r, free.id, "reply to reply", reply.id);
    expect(nested.parentId).toBe(top.id);
    await expect(postComment(r, book.chapters[1].id, "wrong chapter", top.id)).rejects.toThrow(/Reply target/);
    await expect(postComment(r, free.id, "   ")).rejects.toThrow(/empty/);
    await expect(postComment(r, free.id, "x".repeat(4001))).rejects.toThrow(/too long/);
  });

  it("restricted accounts can't comment; the author is badged with the pen name", async () => {
    const { book, authorUser, pen } = await makeBook();
    const restricted = await makeUser("READER", { status: "RESTRICTED" });
    await expect(postComment(restricted, book.chapters[0].id, "hi")).rejects.toThrow(/can't comment/);
    const c = await postComment(authorUser, book.chapters[0].id, "Thanks for reading!");
    expect(c.asPenNameId).toBe(pen.id);
  });

  it("delete: own comment, the book's editor, admins; not other readers. Threads keep replies", async () => {
    const { book, editorUser } = await makeBook();
    const [a, b] = [await makeUser(), await makeUser()];
    const admin = await makeUser("ADMIN");
    const top = await postComment(a, book.chapters[0].id, "parent");
    await postComment(b, book.chapters[0].id, "child", top.id);
    await expect(deleteComment(b, top.id)).rejects.toThrow(/can't delete/);
    await deleteComment(editorUser, top.id);
    expect((await db.comment.findUniqueOrThrow({ where: { id: top.id } })).body).toBe("[deleted]");
    const lone = await postComment(b, book.chapters[0].id, "lonely");
    await deleteComment(admin, lone.id);
    expect(await db.comment.findUnique({ where: { id: lone.id } })).toBeNull();
  });
});

describe("reviews, likes, wishlists", () => {
  it("reviews need reading progress, valid stars, and not your own book; one per reader", async () => {
    const { book, authorUser } = await makeBook();
    const r = await makeUser();
    await expect(saveReview(r, book.id, 5, "great")).rejects.toThrow(/Read at least one chapter/);
    await recordRead(r.id, book.id, book.chapters[0].id, 1);
    await expect(saveReview(r, book.id, 6, "")).rejects.toThrow(/1 to 5/);
    await saveReview(r, book.id, 4, "good");
    await saveReview(r, book.id, 2, "changed my mind");
    expect(await db.review.count({ where: { bookId: book.id } })).toBe(1);
    await recordRead(authorUser.id, book.id, book.chapters[0].id, 1);
    await expect(saveReview(authorUser, book.id, 5, "mine")).rejects.toThrow(/your own book/);
    const rev = await db.review.findFirstOrThrow();
    await expect(deleteReview(await makeUser(), rev.id)).rejects.toThrow(/can't delete/);
    await deleteReview(r, rev.id);
  });

  it("likes and wishlist toggle, only for on-sale books; restricted can wishlist but not like", async () => {
    const { book } = await makeBook();
    const r = await makeUser();
    expect(await toggleLike(r, book.id)).toBe(true);
    expect(await toggleLike(r, book.id)).toBe(false);
    expect(await toggleWishlist(r, book.id)).toBe(true);
    const restricted = await makeUser("READER", { status: "RESTRICTED" });
    await expect(toggleLike(restricted, book.id)).rejects.toThrow(/can't like/);
    expect(await toggleWishlist(restricted, book.id)).toBe(true);
    await db.book.update({ where: { id: book.id }, data: { status: "UNLISTED" } });
    await expect(toggleWishlist(r, book.id)).rejects.toThrow(/not found/);
  });

  it("views count once per reader", async () => {
    const { book } = await makeBook();
    const r = await makeUser();
    for (let i = 0; i < 3; i++) await recordRead(r.id, book.id, book.chapters[0].id, 1);
    await recordRead((await makeUser()).id, book.id, book.chapters[0].id, 1);
    expect((await db.chapter.findUniqueOrThrow({ where: { id: book.chapters[0].id } })).views).toBe(2);
  });
});

describe("age-rated books", () => {
  it("blocks reading and buying for under-age or unknown age; staff and author unaffected", async () => {
    const { book, authorUser, editorUser } = await makeBook({ age: "ADULT_18", lock: 4 });
    const teen = await makeUser("READER", { dateOfBirth: new Date(Date.now() - 15 * 365.25 * 86_400_000) });
    const noDob = await makeUser("READER", { dateOfBirth: null });
    const adult = await makeUser();
    expect(await chapterAccess(null, book.id, 1)).toMatchObject({ allowed: false, reason: "AGE_LOGIN" });
    expect(await chapterAccess(teen, book.id, 1)).toMatchObject({ allowed: false, reason: "TOO_YOUNG" });
    expect(await chapterAccess(noDob, book.id, 1)).toMatchObject({ allowed: false, reason: "DOB_REQUIRED" });
    expect((await chapterAccess(adult, book.id, 1)).allowed).toBe(true);
    expect((await chapterAccess(authorUser, book.id, 9)).allowed).toBe(true);
    expect((await chapterAccess(editorUser, book.id, 9)).allowed).toBe(true);
    await fund(teen.id, 5000);
    await expect(purchaseBook(teen.id, book.id)).rejects.toThrow(/18\+/);
    await fund(noDob.id, 5000);
    await expect(purchaseBook(noDob.id, book.id)).rejects.toThrow(/date of birth/);
    expect(await readableChapters(teen, book.id)).toEqual([]);
  });

  it("readableChapters matches free + owned sections", async () => {
    const { book } = await makeBook({ chapters: 10, lock: 4 });
    const r = await makeUser();
    expect(await readableChapters(r, book.id)).toEqual([1, 2, 3]);
    await db.section.create({ data: { bookId: book.id, index: 1, firstChapter: 4, lastChapter: 6, priceCents: 100 } });
    await fund(r.id, 1000);
    const s = await db.section.findFirstOrThrow();
    await purchaseBook(r.id, book.id, s.id);
    expect(await readableChapters(r, book.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("audiobooks and video", () => {
  it("are sold separately, with a discount on video for whole-book owners", async () => {
    const { book, editorUser } = await makeBook({ price: 500 });
    const r = await makeUser();
    await fund(r.id, 10_000);
    await expect(purchaseMedia(r.id, book.id, "AUDIO")).rejects.toThrow(/No audiobook/);
    await expect(addMedia(await makeUser("EDITOR"), book.id, "AUDIO", "t", "https://x/a.mp3")).rejects.toThrow(/Not your book/);
    await expect(addMedia(editorUser, book.id, "AUDIO", "t", "http://x/a.mp3")).rejects.toThrow(/https/);
    await addMedia(editorUser, book.id, "AUDIO", "Part 1", "https://cdn.example.com/a.mp3");
    await addMedia(editorUser, book.id, "VIDEO", "Ep 1", "https://cdn.example.com/v.mp4");
    await setMediaPricing(editorUser, book.id, { audioPriceCents: 300, videoPriceCents: 1000, videoDiscountPercentForOwners: 25 });

    expect(await mediaAccess(r, book.id, "AUDIO")).toBe(false);
    const audio = await purchaseMedia(r.id, book.id, "AUDIO");
    expect(audio.amountCents).toBe(300);
    expect(await mediaAccess(r, book.id, "AUDIO")).toBe(true);
    expect(await mediaAccess(r, book.id, "VIDEO")).toBe(false);
    await expect(purchaseMedia(r.id, book.id, "AUDIO")).rejects.toThrow(/already own/);

    await purchaseBook(r.id, book.id);
    const video = await purchaseMedia(r.id, book.id, "VIDEO");
    expect(video.amountCents).toBe(750);
    expect((await db.wallet.findUniqueOrThrow({ where: { userId: r.id } })).balanceCents).toBe(10_000 - 300 - 500 - 750);
  });
});

describe("editions and recommendations", () => {
  it("links editions in different languages only", async () => {
    const en = await makeBook({ language: "en" });
    const sn = await makeBook({ language: "sn" });
    const en2 = await makeBook({ language: "en" });
    await expect(linkEdition(en.editorUser, en.book.id, en2.book.code)).rejects.toThrow(/different languages/);
    await linkEdition(en.editorUser, en.book.id, sn.book.code);
    const [a, b] = await Promise.all([db.book.findUniqueOrThrow({ where: { id: en.book.id } }), db.book.findUniqueOrThrow({ where: { id: sn.book.id } })]);
    expect(a.editionGroup).toBeTruthy();
    expect(a.editionGroup).toBe(b.editionGroup);
  });

  it("recommends unread books in genres and languages the reader likes", async () => {
    const read = await makeBook({ genres: ["Romance"], language: "sn" });
    const match = await makeBook({ genres: ["Romance", "Drama"], language: "sn" });
    const wrongLang = await makeBook({ genres: ["Romance"], language: "en" });
    const wrongGenre = await makeBook({ genres: ["Horror"], language: "sn" });
    const r = await makeUser();
    await recordRead(r.id, read.book.id, read.book.chapters[0].id, 1);
    const recs = (await recommendFor(r.id)).map((b) => b.code);
    expect(recs).toContain(match.book.code);
    expect(recs).not.toContain(read.book.code);
    expect(recs).not.toContain(wrongLang.book.code);
    expect(recs).not.toContain(wrongGenre.book.code);
  });
});

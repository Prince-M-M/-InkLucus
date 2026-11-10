import type { Prisma } from "@prisma/client";
import { db, type Tx } from "./db";
import { DomainError } from "./errors";
import { newBookCode, REFERRAL_CODE_RE } from "./codes";
import { planSections } from "./sections";
import { promoteToAuthor } from "./authors";
import { countWords, MAX_CHAPTER_CHARS, type ParsedChapter } from "./manuscript";

export const NEW_BOOK_WINDOW_DAYS = 40;
export const MAX_SUBMISSION_CHAPTERS = 30;

export type SubmissionInput = {
  title: string;
  synopsis: string;
  language: string;
  genres: string[];
  ageRating?: "ALL" | "TEEN_13" | "MATURE_16" | "ADULT_18";
  chapters: ParsedChapter[];
  note?: string;
  referralCode?: string;
  penNameId?: string;
};

function validateChapters(chapters: ParsedChapter[]) {
  if (chapters.length === 0) throw new DomainError("INVALID", "Include at least one chapter");
  if (chapters.length > MAX_SUBMISSION_CHAPTERS) throw new DomainError("INVALID", `Submit at most ${MAX_SUBMISSION_CHAPTERS} chapters`);
  if (chapters.some((c) => c.content.length > MAX_CHAPTER_CHARS)) throw new DomainError("INVALID", "A chapter is too long");
}

/**
 * New submissions.
 * - Readers (via "I want to be an author") go to the shared editor pool.
 * - Existing authors go straight to their own editor (pen name's editor first, then their main editor).
 *   With no editor assigned, they go to the pool too.
 */
export async function submitBook(userId: string, data: SubmissionInput) {
  validateChapters(data.chapters);
  const referralCode = data.referralCode?.trim().toUpperCase() || undefined;
  if (referralCode && !REFERRAL_CODE_RE.test(referralCode)) throw new DomainError("INVALID", "Referral codes look like AA1234");

  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { authorProfile: { include: { penNames: true } } } });
  if (user.status !== "ACTIVE") throw new DomainError("FORBIDDEN", "Your account cannot submit books right now");
  if (user.role !== "READER" && user.role !== "AUTHOR") throw new DomainError("FORBIDDEN", "Only reader and author accounts submit books");

  let penNameId: string | null = null;
  let editorId = user.authorProfile?.editorId ?? null;
  if (data.penNameId) {
    const pen = user.authorProfile?.penNames.find((p) => p.id === data.penNameId);
    if (!pen) throw new DomainError("FORBIDDEN", "That pen name is not yours");
    penNameId = pen.id;
    editorId = pen.editorId ?? editorId;
  }

  return db.book.create({
    data: {
      code: newBookCode(),
      title: data.title.trim(),
      synopsis: data.synopsis.trim(),
      language: data.language,
      genres: data.genres,
      ageRating: data.ageRating ?? "ALL",
      submissionNote: data.note?.trim() || null,
      referralCode: referralCode ?? null,
      submitterId: userId,
      penNameId,
      status: editorId ? "UNDER_REVIEW" : "IN_POOL",
      reviewingEditorId: editorId,
      chapters: { create: data.chapters.map((c, i) => ({ number: i + 1, title: c.title, content: c.content, wordCount: countWords(c.content) })) },
    },
  });
}

/** Pool listing, optionally narrowed to an editor's genres/languages. */
export function listPool(filter: { genre?: string; language?: string } = {}) {
  return db.book.findMany({
    where: {
      status: "IN_POOL",
      ...(filter.genre ? { genres: { has: filter.genre } } : {}),
      ...(filter.language ? { language: filter.language } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: { submitter: { select: { displayName: true } }, _count: { select: { chapters: true } } },
  });
}

/** Editor claims a pooled book; it disappears from the pool for everyone else. */
export async function claimFromPool(bookId: string, editorProfileId: string) {
  const res = await db.book.updateMany({
    where: { id: bookId, status: "IN_POOL" },
    data: { status: "UNDER_REVIEW", reviewingEditorId: editorProfileId },
  });
  if (res.count !== 1) throw new DomainError("CONFLICT", "Book is no longer in the pool");
}

/** Editor decides it's not their genre and passes it back to the pool (optionally retagging genres). */
export async function returnToPool(bookId: string, editorProfileId: string, retagGenres?: string[]) {
  const res = await db.book.updateMany({
    where: { id: bookId, status: "UNDER_REVIEW", reviewingEditorId: editorProfileId },
    data: { status: "IN_POOL", reviewingEditorId: null, ...(retagGenres?.length ? { genres: retagGenres } : {}) },
  });
  if (res.count !== 1) throw new DomainError("FORBIDDEN", "You are not reviewing this book");
}

/**
 * Accept or reject. On acceptance a reader account becomes an author account immediately,
 * and an author with no editor gets this editor (the "same editor who saw their first book").
 */
export async function decide(bookId: string, editorProfileId: string, accept: boolean, message: string) {
  const book = await db.book.findUnique({ where: { id: bookId }, include: { reviewingEditor: true, submitter: { include: { authorProfile: true } } } });
  if (!book || book.status !== "UNDER_REVIEW" || book.reviewingEditorId !== editorProfileId) {
    throw new DomainError("FORBIDDEN", "You are not reviewing this book");
  }
  if (!message.trim()) throw new DomainError("INVALID", "Leave a message for the submitter");

  if (accept) {
    if (book.submitter.role === "READER") {
      await promoteToAuthor({ userId: book.submitterId, actorUserId: book.reviewingEditor!.userId, referralCode: book.referralCode ?? undefined, editorId: editorProfileId });
    } else if (book.submitter.authorProfile && !book.submitter.authorProfile.editorId) {
      await db.authorProfile.update({ where: { id: book.submitter.authorProfile.id }, data: { editorId: editorProfileId } });
    }
  }
  return db.book.update({
    where: { id: bookId },
    data: { status: accept ? "ACCEPTED" : "REJECTED", decisionMessage: message.trim(), editorId: accept ? editorProfileId : null, acceptedAt: accept ? new Date() : null },
  });
}

async function assertAuthorOwnsBook(tx: Tx | typeof db, userId: string, bookId: string) {
  const book = await tx.book.findUnique({ where: { id: bookId }, include: { penName: { include: { author: true } } } });
  if (!book) throw new DomainError("NOT_FOUND", "Book not found");
  const owner = book.penName?.author.userId ?? book.submitterId;
  if (owner !== userId) throw new DomainError("FORBIDDEN", "Not your book");
  if (book.status === "REJECTED") throw new DomainError("INVALID", "This book was not accepted");
  return book;
}

/** Authors post new chapters to their own books. */
export async function addChapter(userId: string, bookId: string, chapter: ParsedChapter) {
  if (!chapter.content.trim()) throw new DomainError("INVALID", "Chapter is empty");
  if (chapter.content.length > MAX_CHAPTER_CHARS) throw new DomainError("INVALID", "Chapter is too long");
  return db.$transaction(async (tx) => {
    const book = await assertAuthorOwnsBook(tx, userId, bookId);
    const last = await tx.chapter.aggregate({ where: { bookId }, _max: { number: true } });
    const number = (last._max.number ?? 0) + 1;
    const created = await tx.chapter.create({
      data: { bookId, number, title: chapter.title.trim() || `Chapter ${number}`, content: chapter.content.trim(), wordCount: countWords(chapter.content) },
    });
    // Keep new chapters purchasable: grow the newest unsold section, or open a new one.
    // Partial sections are priced pro rata so nobody pays a full-section price for one chapter.
    if (book.lockChapter != null) {
      const sections = await tx.section.findMany({ where: { bookId }, orderBy: { index: "asc" }, include: { _count: { select: { purchases: true } } } });
      const first = sections[0];
      const last = sections.at(-1);
      if (first && last) {
        const fullSize = first.lastChapter - first.firstChapter + 1;
        const fullPrice = first.priceCents;
        const proRata = (size: number) => Math.max(1, Math.round((fullPrice * size) / fullSize));
        const lastSize = last.lastChapter - last.firstChapter + 1;
        if (last._count.purchases === 0 && lastSize < fullSize) {
          await tx.section.update({ where: { id: last.id }, data: { lastChapter: number, priceCents: proRata(lastSize + 1) } });
        } else {
          await tx.section.create({ data: { bookId, index: last.index + 1, firstChapter: number, lastChapter: number, priceCents: proRata(1) } });
        }
      }
    }
    return created;
  });
}

export type PublishInput = {
  bookId: string;
  editorProfileId: string;
  penNameId: string;
  lockChapter: number;
  wholeBookPriceCents: number;
  chaptersPerSection?: number;
  sectionPriceCents?: number;
  editorReview?: string;
  isbn?: string;
  royaltyPercent: number;
  contractSignedAt: Date;
};

/** After contracts are signed: record the contract, set lock chapter, prices and sections, then publish. */
export async function putOnSale(opts: PublishInput) {
  if (!Number.isInteger(opts.lockChapter) || opts.lockChapter < 1) throw new DomainError("INVALID", "Lock chapter must be 1 or more");
  if (!Number.isInteger(opts.wholeBookPriceCents) || opts.wholeBookPriceCents < 0) throw new DomainError("INVALID", "Invalid price");
  if (!Number.isInteger(opts.royaltyPercent) || opts.royaltyPercent < 0 || opts.royaltyPercent > 100) throw new DomainError("INVALID", "Royalty must be 0–100%");

  return db.$transaction(async (tx) => {
    const book = await tx.book.findUnique({ where: { id: opts.bookId }, include: { _count: { select: { chapters: true } } } });
    if (!book || book.editorId !== opts.editorProfileId) throw new DomainError("FORBIDDEN", "Not your book");
    if (book.status !== "ACCEPTED" && book.status !== "UNLISTED") throw new DomainError("INVALID", `Cannot publish a ${book.status} book`);
    if (book._count.chapters === 0) throw new DomainError("INVALID", "Book has no chapters");

    const pen = await tx.penName.findUnique({ where: { id: opts.penNameId }, include: { author: true } });
    if (!pen) throw new DomainError("NOT_FOUND", "Pen name not found");
    const submitterAuthor = await tx.authorProfile.findUnique({ where: { userId: book.submitterId } });
    if (!submitterAuthor || pen.authorId !== submitterAuthor.id) throw new DomainError("INVALID", "Pen name does not belong to this book's author");

    await tx.contract.upsert({
      where: { authorId_bookId: { authorId: pen.authorId, bookId: book.id } },
      update: { royaltyPercent: opts.royaltyPercent, signedAt: opts.contractSignedAt },
      create: { authorId: pen.authorId, bookId: book.id, royaltyPercent: opts.royaltyPercent, signedAt: opts.contractSignedAt },
    });

    // Rebuild sections that nobody has bought yet.
    const sold = await tx.section.findMany({ where: { bookId: book.id, purchases: { some: {} } } });
    if (sold.length === 0) {
      await tx.section.deleteMany({ where: { bookId: book.id } });
      if (opts.chaptersPerSection && opts.sectionPriceCents) {
        for (const s of planSections(book._count.chapters, opts.lockChapter, opts.chaptersPerSection)) {
          const size = s.lastChapter - s.firstChapter + 1;
          const price = Math.max(1, Math.round((opts.sectionPriceCents * size) / opts.chaptersPerSection));
          await tx.section.create({ data: { bookId: book.id, ...s, priceCents: price } });
        }
      }
    }

    const data: Prisma.BookUpdateInput = {
      status: "ON_SALE",
      penName: { connect: { id: pen.id } },
      lockChapter: opts.lockChapter,
      wholeBookPriceCents: opts.wholeBookPriceCents,
      editorReview: opts.editorReview?.trim() || null,
      publishedAt: book.publishedAt ?? new Date(),
      ...(opts.isbn?.trim() ? { isbn: opts.isbn.trim() } : {}),
    };
    return tx.book.update({ where: { id: book.id }, data });
  });
}

export async function unlist(bookId: string, editorProfileId: string) {
  const res = await db.book.updateMany({ where: { id: bookId, editorId: editorProfileId, status: "ON_SALE" }, data: { status: "UNLISTED" } });
  if (res.count !== 1) throw new DomainError("FORBIDDEN", "Not your book, or not on sale");
}

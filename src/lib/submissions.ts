import { db } from "./db";
import { DomainError } from "./errors";
import { newBookCode } from "./codes";
import { planSections } from "./sections";
import { promoteToAuthor } from "./authors";

export const NEW_BOOK_WINDOW_DAYS = 40;

/**
 * New submissions. First-time submitters (readers) go to the shared editor pool.
 * Existing authors go straight to their own editor, if they have one.
 */
export async function submitBook(userId: string, data: { title: string; synopsis: string; language: string; genres: string[]; note?: string }) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { authorProfile: true } });
  const editorId = user.authorProfile?.editorId ?? null;
  return db.book.create({
    data: {
      code: newBookCode(),
      title: data.title,
      synopsis: data.synopsis,
      language: data.language,
      genres: data.genres,
      submissionNote: data.note,
      submitterId: userId,
      status: editorId ? "UNDER_REVIEW" : "IN_POOL",
      reviewingEditorId: editorId,
    },
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

/** Editor decides it's not their genre and passes it back to the pool. */
export async function returnToPool(bookId: string, editorProfileId: string, retagGenres?: string[]) {
  const res = await db.book.updateMany({
    where: { id: bookId, status: "UNDER_REVIEW", reviewingEditorId: editorProfileId },
    data: { status: "IN_POOL", reviewingEditorId: null, ...(retagGenres ? { genres: retagGenres } : {}) },
  });
  if (res.count !== 1) throw new DomainError("FORBIDDEN", "You are not reviewing this book");
}

export async function decide(bookId: string, editorProfileId: string, accept: boolean, message: string) {
  const book = await db.book.findUnique({ where: { id: bookId }, include: { reviewingEditor: true } });
  if (!book || book.status !== "UNDER_REVIEW" || book.reviewingEditorId !== editorProfileId) {
    throw new DomainError("FORBIDDEN", "You are not reviewing this book");
  }
  if (accept) {
    await promoteToAuthor({ userId: book.submitterId, actorUserId: book.reviewingEditor!.userId, editorId: editorProfileId }).catch((e) => {
      if (!(e instanceof DomainError && e.code === "INVALID")) throw e; // already author/staff: fine
    });
  }
  return db.book.update({
    where: { id: bookId },
    data: { status: accept ? "ACCEPTED" : "REJECTED", decisionMessage: message, editorId: accept ? editorProfileId : null },
  });
}

/** After contracts are signed: set lock chapter, prices and sections, then publish. */
export async function putOnSale(opts: {
  bookId: string;
  editorProfileId: string;
  penNameId: string;
  lockChapter: number;
  wholeBookPriceCents: number;
  chaptersPerSection?: number;
  sectionPriceCents?: number;
  editorReview?: string;
}) {
  return db.$transaction(async (tx) => {
    const book = await tx.book.findUnique({ where: { id: opts.bookId }, include: { _count: { select: { chapters: true } } } });
    if (!book || book.editorId !== opts.editorProfileId) throw new DomainError("FORBIDDEN", "Not your book");
    if (book.status !== "ACCEPTED" && book.status !== "UNLISTED") throw new DomainError("INVALID", `Cannot publish a ${book.status} book`);

    await tx.section.deleteMany({ where: { bookId: book.id, purchases: { none: {} } } });
    if (opts.chaptersPerSection && opts.sectionPriceCents) {
      for (const s of planSections(book._count.chapters, opts.lockChapter, opts.chaptersPerSection)) {
        await tx.section.upsert({
          where: { bookId_index: { bookId: book.id, index: s.index } },
          update: { ...s, priceCents: opts.sectionPriceCents },
          create: { bookId: book.id, ...s, priceCents: opts.sectionPriceCents },
        });
      }
    }
    return tx.book.update({
      where: { id: book.id },
      data: {
        status: "ON_SALE",
        penNameId: opts.penNameId,
        lockChapter: opts.lockChapter,
        wholeBookPriceCents: opts.wholeBookPriceCents,
        editorReview: opts.editorReview,
        publishedAt: book.publishedAt ?? new Date(),
      },
    });
  });
}

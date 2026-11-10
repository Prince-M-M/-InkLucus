import { db } from "./db";
import { DomainError } from "./errors";
import { can } from "./rbac";
import { chapterAccess, type Viewer } from "./reading";

type Actor = NonNullable<Viewer> & { authorProfile?: { id: string } | null };

async function onSaleBook(bookId: string) {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book || book.status !== "ON_SALE") throw new DomainError("NOT_FOUND", "Book not found");
  return book;
}

export async function toggleWishlist(user: Actor, bookId: string) {
  if (user.status === "BLOCKED") throw new DomainError("FORBIDDEN", "Your account is blocked");
  await onSaleBook(bookId);
  const key = { userId_bookId: { userId: user.id, bookId } };
  if (await db.wishlistItem.findUnique({ where: key })) {
    await db.wishlistItem.delete({ where: key });
    return false;
  }
  await db.wishlistItem.create({ data: { userId: user.id, bookId } });
  return true;
}

/** Likes ("favourites") are an engagement action, so restricted accounts can't like. */
export async function toggleLike(user: Actor, bookId: string) {
  if (!can(user, "engage:comment")) throw new DomainError("FORBIDDEN", "Your account can't like books");
  await onSaleBook(bookId);
  const key = { userId_bookId: { userId: user.id, bookId } };
  if (await db.bookLike.findUnique({ where: key })) {
    await db.bookLike.delete({ where: key });
    return false;
  }
  await db.bookLike.create({ data: { userId: user.id, bookId } });
  return true;
}

/** One review per reader per book; you must have started reading it. Authors can't review their own book. */
export async function saveReview(user: Actor, bookId: string, rating: number, body: string) {
  if (!can(user, "engage:comment")) throw new DomainError("FORBIDDEN", "Your account can't post reviews");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new DomainError("INVALID", "Choose 1 to 5 stars");
  const text = body.trim();
  if (text.length > 5000) throw new DomainError("INVALID", "Review is too long");
  const book = await db.book.findUnique({ where: { id: bookId }, include: { penName: { include: { author: true } } } });
  if (!book || book.status !== "ON_SALE") throw new DomainError("NOT_FOUND", "Book not found");
  if (book.penName?.author.userId === user.id) throw new DomainError("FORBIDDEN", "You can't review your own book");
  const read = await db.readingProgress.findUnique({ where: { userId_bookId: { userId: user.id, bookId } } });
  if (!read) throw new DomainError("FORBIDDEN", "Read at least one chapter before reviewing");
  return db.review.upsert({
    where: { userId_bookId: { userId: user.id, bookId } },
    update: { rating, body: text },
    create: { userId: user.id, bookId, rating, body: text },
  });
}

/** Comments: only on chapters you can read. Replies must belong to the same chapter. */
export async function postComment(user: Actor, chapterId: string, body: string, parentId?: string) {
  if (!can(user, "engage:comment")) throw new DomainError("FORBIDDEN", "Your account can't comment");
  const text = body.trim();
  if (!text) throw new DomainError("INVALID", "Comment is empty");
  if (text.length > 4000) throw new DomainError("INVALID", "Comment is too long");
  const chapter = await db.chapter.findUnique({ where: { id: chapterId }, include: { book: { include: { penName: true } } } });
  if (!chapter || chapter.book.status !== "ON_SALE") throw new DomainError("NOT_FOUND", "Chapter not found");
  const access = await chapterAccess(user, chapter.bookId, chapter.number);
  if (!access.allowed) throw new DomainError("FORBIDDEN", "You can only comment on chapters you can read");
  if (parentId) {
    const parent = await db.comment.findUnique({ where: { id: parentId } });
    if (!parent || parent.chapterId !== chapterId) throw new DomainError("INVALID", "Reply target not found");
    if (parent.parentId) parentId = parent.parentId; // keep threads one level deep
  }
  // The book's author automatically comments under the book's pen name with an "Author" badge.
  const isAuthor = !!chapter.book.penName && !!user.authorProfile && chapter.book.penName.authorId === user.authorProfile.id;
  return db.comment.create({
    data: { chapterId, userId: user.id, body: text, parentId: parentId ?? null, asPenNameId: isAuthor ? chapter.book.penNameId : null },
    include: { chapter: { include: { book: true } } },
  });
}

/** Owners can delete their own comments; admins and the book's editor can delete any on the book. */
export async function deleteComment(user: Actor, commentId: string) {
  const c = await db.comment.findUnique({ where: { id: commentId }, include: { chapter: { include: { book: { include: { editor: true } } } } } });
  if (!c) throw new DomainError("NOT_FOUND", "Comment not found");
  const allowed = c.userId === user.id || user.role === "ADMIN" || (user.role === "EDITOR" && c.chapter.book.editor?.userId === user.id);
  if (!allowed) throw new DomainError("FORBIDDEN", "You can't delete this comment");
  const replies = await db.comment.count({ where: { parentId: c.id } });
  if (replies > 0) await db.comment.update({ where: { id: c.id }, data: { body: "[deleted]" } });
  else await db.comment.delete({ where: { id: c.id } });
  return c;
}

export async function deleteReview(user: Actor, reviewId: string) {
  const r = await db.review.findUnique({ where: { id: reviewId }, include: { book: { include: { editor: true } } } });
  if (!r) throw new DomainError("NOT_FOUND", "Review not found");
  const allowed = r.userId === user.id || user.role === "ADMIN" || (user.role === "EDITOR" && r.book.editor?.userId === user.id);
  if (!allowed) throw new DomainError("FORBIDDEN", "You can't delete this review");
  await db.review.delete({ where: { id: r.id } });
  return r;
}

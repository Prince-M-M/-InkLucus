import type { AgeRating, Prisma } from "@prisma/client";
import { db } from "./db";
import { NEW_BOOK_WINDOW_DAYS } from "./submissions";
import type { Period } from "./homepage";

const DAY = 86_400_000;

/** First instants (UTC) of the last `n` months, oldest first, plus the end bound. */
export function lastMonths(n: number, now = new Date()): { start: Date; end: Date; label: string }[] {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    out.push({ start, end, label: start.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) });
  }
  return out;
}

// ─────────────── Reader ───────────────

export async function readerStats(userId: string) {
  const [progress, likes, wishlist, reviews, comments] = await Promise.all([
    db.readingProgress.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, include: { book: { select: { code: true, title: true, _count: { select: { chapters: true } } } } } }),
    db.bookLike.findMany({ where: { userId }, include: { book: { select: { code: true, title: true } } } }),
    db.wishlistItem.count({ where: { userId } }),
    db.review.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, include: { book: { select: { code: true, title: true } } } }),
    db.comment.count({ where: { userId } }),
  ]);
  const books = progress.map((p) => ({
    code: p.book.code, title: p.book.title, lastChapter: p.lastChapter, chapters: p.book._count.chapters,
    percent: p.book._count.chapters ? Math.min(100, Math.round((p.lastChapter / p.book._count.chapters) * 100)) : 0,
  }));
  return { booksStarted: books.length, booksFinished: books.filter((b) => b.percent >= 100).length, books, likes, wishlistCount: wishlist, reviews, commentCount: comments };
}

// ─────────────── Author ───────────────

export async function authorStats(authorId: string, months = 6, now = new Date()) {
  const ms = lastMonths(months, now);
  const books = await db.book.findMany({
    where: { penName: { authorId }, status: { in: ["ON_SALE", "UNLISTED"] } },
    select: { id: true, code: true, title: true, penName: { select: { name: true } }, _count: { select: { likes: true, wishlist: true, progress: true } } },
  });
  const ids = books.map((b) => b.id);
  const since = ms[0].start;
  const [purchases, views, reviews, commentsAll, commentsRecent] = await Promise.all([
    db.purchase.findMany({ where: { bookId: { in: ids } }, select: { bookId: true, amountCents: true, createdAt: true } }),
    db.chapter.groupBy({ by: ["bookId"], where: { bookId: { in: ids } }, _sum: { views: true } }),
    db.review.groupBy({ by: ["bookId"], where: { bookId: { in: ids } }, _avg: { rating: true }, _count: { _all: true } }),
    db.comment.groupBy({ by: ["chapterId"], where: { chapter: { bookId: { in: ids } } }, _count: { _all: true } }),
    db.comment.findMany({ where: { chapter: { bookId: { in: ids } }, createdAt: { gte: since } }, select: { createdAt: true, chapter: { select: { bookId: true } } } }),
  ]);
  const chapterBook = new Map((await db.chapter.findMany({ where: { bookId: { in: ids } }, select: { id: true, bookId: true } })).map((c) => [c.id, c.bookId]));
  const perBook = books.map((b) => {
    const mine = purchases.filter((p) => p.bookId === b.id);
    const monthly = ms.map((m) => mine.filter((p) => p.createdAt >= m.start && p.createdAt < m.end).length);
    const r = reviews.find((x) => x.bookId === b.id);
    return {
      ...b,
      copiesTotal: mine.length,
      revenueCents: mine.reduce((a, p) => a + p.amountCents, 0),
      monthly,
      views: views.find((v) => v.bookId === b.id)?._sum.views ?? 0,
      reviewCount: r?._count._all ?? 0,
      avgRating: r?._avg.rating ?? null,
      comments: commentsAll.filter((c) => chapterBook.get(c.chapterId) === b.id).reduce((a, c) => a + c._count._all, 0),
      commentsMonthly: ms.map((m) => commentsRecent.filter((c) => c.chapter.bookId === b.id && c.createdAt >= m.start && c.createdAt < m.end).length),
    };
  });
  return {
    months: ms.map((m) => m.label),
    books: perBook,
    totals: {
      copies: perBook.reduce((a, b) => a + b.copiesTotal, 0),
      monthly: ms.map((_, i) => perBook.reduce((a, b) => a + b.monthly[i], 0)),
      likes: perBook.reduce((a, b) => a + b._count.likes, 0),
      wishlists: perBook.reduce((a, b) => a + b._count.wishlist, 0),
      views: perBook.reduce((a, b) => a + b.views, 0),
      reviews: perBook.reduce((a, b) => a + b.reviewCount, 0),
      comments: perBook.reduce((a, b) => a + b.comments, 0),
    },
  };
}

// ─────────────── Editor / Admin ───────────────

type Breakdown = { key: string; copies: number; cents: number }[];

function addTo(map: Map<string, { copies: number; cents: number }>, key: string, copies: number, cents: number) {
  const v = map.get(key) ?? { copies: 0, cents: 0 };
  v.copies += copies;
  v.cents += cents;
  map.set(key, v);
}
const toList = (m: Map<string, { copies: number; cents: number }>): Breakdown => [...m].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.cents - a.cents);

/** Sales statistics for one editor's books, or for all books (admins). */
export async function salesStats(scope: { editorId: string } | "all", period: Period) {
  const where: Prisma.BookWhereInput = { status: { in: ["ON_SALE", "UNLISTED"] }, ...(scope === "all" ? {} : { editorId: scope.editorId }) };
  const books = await db.book.findMany({
    where,
    select: {
      id: true, code: true, title: true, genres: true, ageRating: true, language: true, publishedAt: true,
      penName: { select: { name: true, author: { select: { id: true, user: { select: { displayName: true } } } } } },
      _count: { select: { wishlist: true, likes: true } },
    },
  });
  const ids = books.map((b) => b.id);
  const [sales, reviews] = await Promise.all([
    db.purchase.groupBy({ by: ["bookId"], where: { bookId: { in: ids }, createdAt: { gte: period.start, lt: period.end } }, _sum: { amountCents: true }, _count: { _all: true } }),
    db.review.groupBy({ by: ["bookId"], where: { bookId: { in: ids } }, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  const newCutoff = new Date(period.end.getTime() - NEW_BOOK_WINDOW_DAYS * DAY);
  const byAge = new Map(), byGenre = new Map(), byLang = new Map(), byNew = new Map(), byAuthor = new Map<string, { copies: number; cents: number }>();
  const authorNames = new Map<string, string>();
  const rows = books.map((b) => {
    const s = sales.find((x) => x.bookId === b.id);
    const copies = s?._count._all ?? 0, cents = s?._sum.amountCents ?? 0;
    const r = reviews.find((x) => x.bookId === b.id);
    addTo(byAge, b.ageRating as AgeRating, copies, cents);
    addTo(byLang, b.language, copies, cents);
    addTo(byNew, b.publishedAt && b.publishedAt >= newCutoff ? "New (last 40 days)" : "Older", copies, cents);
    for (const g of b.genres.length ? b.genres : ["(none)"]) addTo(byGenre, g, copies, cents);
    if (b.penName) {
      addTo(byAuthor, b.penName.author.id, copies, cents);
      authorNames.set(b.penName.author.id, b.penName.author.user.displayName);
    }
    return { code: b.code, title: b.title, penName: b.penName?.name ?? "", copies, cents, wishlists: b._count.wishlist, likes: b._count.likes, reviewCount: r?._count._all ?? 0, avgRating: r?._avg.rating ?? null };
  });
  const reviewed = rows.filter((r) => r.reviewCount > 0);
  return {
    books: rows.sort((a, b) => b.cents - a.cents),
    totals: { copies: rows.reduce((a, r) => a + r.copies, 0), cents: rows.reduce((a, r) => a + r.cents, 0) },
    byNew: toList(byNew), byGenre: toList(byGenre), byAgeRating: toList(byAge), byLanguage: toList(byLang),
    bestSellingAuthors: toList(byAuthor).slice(0, 10).map((a) => ({ ...a, name: authorNames.get(a.key) ?? a.key })),
    bestReviewed: [...reviewed].sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0) || b.reviewCount - a.reviewCount).slice(0, 5),
    worstReviewed: [...reviewed].sort((a, b) => (a.avgRating ?? 0) - (b.avgRating ?? 0) || b.reviewCount - a.reviewCount).slice(0, 5),
  };
}

/** Admin: how each editor is performing in a period. */
export async function editorPerformance(period: Period) {
  const inP = { gte: period.start, lt: period.end };
  const editors = await db.editorProfile.findMany({ where: { user: { role: { in: ["EDITOR", "ADMIN"] } } }, include: { user: { select: { displayName: true } } } });
  return Promise.all(
    editors.map(async (e) => {
      const books = { editorId: e.id };
      const [taken, sales, wish, reviews, views, onSale] = await Promise.all([
        db.book.count({ where: { ...books, acceptedAt: inP } }),
        db.purchase.aggregate({ where: { book: books, createdAt: inP }, _sum: { amountCents: true }, _count: { _all: true } }),
        db.wishlistItem.count({ where: { book: books, createdAt: inP } }),
        db.review.aggregate({ where: { book: books, createdAt: inP }, _avg: { rating: true }, _count: { _all: true } }),
        db.chapterView.count({ where: { chapter: { book: books }, createdAt: inP } }),
        db.book.count({ where: { ...books, status: "ON_SALE" } }),
      ]);
      return {
        editorId: e.id, name: e.user.displayName, booksOnSale: onSale, newBooksTaken: taken,
        copies: sales._count._all, cents: sales._sum.amountCents ?? 0, wishlists: wish,
        reviews: reviews._count._all, avgRating: reviews._avg.rating, views,
      };
    }),
  ).then((rows) => rows.sort((a, b) => b.cents - a.cents));
}

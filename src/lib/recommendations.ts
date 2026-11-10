import { db } from "./db";
import { bookCardSelect } from "./catalog";

/**
 * "You might like": on-sale books sharing genres with what the reader has read, bought or liked,
 * in languages they read, excluding books they already have. Ranked by genre overlap, then sales.
 */
export async function recommendFor(userId: string, take = 12) {
  const [progress, purchases, likes, wishlist] = await Promise.all([
    db.readingProgress.findMany({ where: { userId }, select: { book: { select: { id: true, genres: true, language: true } } } }),
    db.purchase.findMany({ where: { userId }, select: { book: { select: { id: true, genres: true, language: true } } } }),
    db.bookLike.findMany({ where: { userId }, select: { book: { select: { id: true, genres: true, language: true } } } }),
    db.wishlistItem.findMany({ where: { userId }, select: { bookId: true } }),
  ]);
  const seen = [...progress, ...purchases, ...likes].map((x) => x.book);
  const exclude = new Set([...seen.map((b) => b.id), ...wishlist.map((w) => w.bookId)]);
  const genreWeight = new Map<string, number>();
  for (const b of seen) for (const g of b.genres) genreWeight.set(g, (genreWeight.get(g) ?? 0) + 1);
  const languages = [...new Set(seen.map((b) => b.language))];

  const candidates = await db.book.findMany({
    where: {
      status: "ON_SALE",
      id: { notIn: [...exclude] },
      ...(genreWeight.size ? { genres: { hasSome: [...genreWeight.keys()] } } : {}),
      ...(languages.length ? { language: { in: languages } } : {}),
    },
    select: { ...bookCardSelect, _count: { select: { purchases: true, likes: true } } },
    take: 200,
  });
  return candidates
    .map((b) => ({ b, score: b.genres.reduce((s, g) => s + (genreWeight.get(g) ?? 0), 0) * 1000 + b._count.purchases * 2 + b._count.likes }))
    .sort((x, y) => y.score - x.score)
    .slice(0, take)
    .map((x) => x.b);
}

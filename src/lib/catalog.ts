import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { NEW_BOOK_WINDOW_DAYS } from "./submissions";

export const bookCardSelect = {
  id: true, code: true, title: true, coverUrl: true, language: true, genres: true, ageRating: true,
  penName: { select: { name: true, slug: true } },
} satisfies Prisma.BookSelect;

export const LANGUAGES: Record<string, string> = { en: "English", sn: "Shona", nd: "Ndebele" };
export const GENRES = ["Fantasy", "Romance", "Action", "Thriller", "Mystery", "Sci-Fi", "Horror", "Drama"];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Admin-approved homepage list, shuffled so visitors see variety. */
export async function homepageList(list: "EDITORS_PICKS" | "POPULAR" | "BEST_SELLING" | "FEATURED_LANGUAGE", language?: string) {
  const now = new Date();
  const slots = await db.homepageSlot.findMany({
    where: { list, status: "APPROVED", startsAt: { lte: now }, endsAt: { gt: now }, book: { status: "ON_SALE" }, ...(language ? { language } : {}) },
    select: { book: { select: bookCardSelect } },
  });
  return shuffle(slots.map((s) => s.book));
}

export function newBooks(take = 12) {
  const since = new Date(Date.now() - NEW_BOOK_WINDOW_DAYS * 86_400_000);
  return db.book.findMany({ where: { status: "ON_SALE", publishedAt: { gte: since } }, orderBy: { publishedAt: "desc" }, take, select: bookCardSelect });
}

export function searchBooks(f: { q?: string; genre?: string; language?: string }) {
  return db.book.findMany({
    where: {
      status: "ON_SALE",
      ...(f.language ? { language: f.language } : {}),
      ...(f.genre ? { genres: { has: f.genre } } : {}),
      ...(f.q
        ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { penName: { name: { contains: f.q, mode: "insensitive" } } }] }
        : {}),
    },
    orderBy: { publishedAt: "desc" },
    take: 60,
    select: bookCardSelect,
  });
}

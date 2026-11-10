import type { MediaKind } from "@prisma/client";
import { db } from "./db";
import { DomainError } from "./errors";

type Manager = { role: string; editorProfile: { id: string } | null };

async function managedBook(actor: Manager, bookId: string) {
  const book = await db.book.findUnique({ where: { id: bookId } });
  if (!book) throw new DomainError("NOT_FOUND", "Book not found");
  if (actor.role !== "ADMIN" && book.editorId !== actor.editorProfile?.id) throw new DomainError("FORBIDDEN", "Not your book");
  return book;
}

export function validMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

export async function addMedia(actor: Manager, bookId: string, kind: MediaKind, title: string, url: string) {
  await managedBook(actor, bookId);
  if (!validMediaUrl(url)) throw new DomainError("INVALID", "Media links must be https:// URLs");
  if (!title.trim()) throw new DomainError("INVALID", "Give the track a title");
  const last = await db.mediaItem.aggregate({ where: { bookId, kind }, _max: { number: true } });
  return db.mediaItem.create({ data: { bookId, kind, title: title.trim().slice(0, 150), url, number: (last._max.number ?? 0) + 1 } });
}

export async function removeMedia(actor: Manager, mediaId: string) {
  const item = await db.mediaItem.findUnique({ where: { id: mediaId } });
  if (!item) throw new DomainError("NOT_FOUND", "Not found");
  await managedBook(actor, item.bookId);
  await db.mediaItem.delete({ where: { id: mediaId } });
}

export async function setMediaPricing(actor: Manager, bookId: string, p: { audioPriceCents: number | null; videoPriceCents: number | null; videoDiscountPercentForOwners: number }) {
  await managedBook(actor, bookId);
  for (const v of [p.audioPriceCents, p.videoPriceCents]) if (v != null && (!Number.isInteger(v) || v < 0)) throw new DomainError("INVALID", "Invalid price");
  if (!Number.isInteger(p.videoDiscountPercentForOwners) || p.videoDiscountPercentForOwners < 0 || p.videoDiscountPercentForOwners > 100) throw new DomainError("INVALID", "Discount must be 0–100%");
  return db.book.update({ where: { id: bookId }, data: p });
}

/** Link two books as language editions of the same story. */
export async function linkEdition(actor: Manager, bookId: string, otherCode: string) {
  const book = await managedBook(actor, bookId);
  const other = await db.book.findUnique({ where: { code: otherCode.trim().toUpperCase() } });
  if (!other || other.id === book.id) throw new DomainError("NOT_FOUND", "No other book with that code");
  if (other.language === book.language) throw new DomainError("INVALID", "Editions must be in different languages");
  const group = book.editionGroup ?? other.editionGroup ?? book.id;
  await db.book.updateMany({ where: { OR: [{ id: { in: [book.id, other.id] } }, ...(other.editionGroup ? [{ editionGroup: other.editionGroup }] : [])] }, data: { editionGroup: group } });
}

export async function unlinkEdition(actor: Manager, bookId: string) {
  await managedBook(actor, bookId);
  await db.book.update({ where: { id: bookId }, data: { editionGroup: null } });
}

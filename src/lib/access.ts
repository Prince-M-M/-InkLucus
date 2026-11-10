import type { Role } from "@prisma/client";

export type ChapterAccessInput = {
  chapterNumber: number;
  lockChapter: number | null;
  viewer: { id: string; role: Role } | null;
  /** user id of the book's author (owner of the pen name) */
  authorUserId: string | null;
  /** user id of the book's assigned editor */
  editorUserId: string | null;
  ownsWholeBook: boolean;
  ownedSections: { firstChapter: number; lastChapter: number }[];
};

export type AccessResult = { allowed: true; reason: string } | { allowed: false; reason: "LOGIN_REQUIRED" | "PURCHASE_REQUIRED" };

/** Pure rule for whether a viewer may read a given chapter. */
export function canReadChapter(i: ChapterAccessInput): AccessResult {
  if (i.lockChapter == null || i.chapterNumber < i.lockChapter) return { allowed: true, reason: "FREE" };
  if (!i.viewer) return { allowed: false, reason: "LOGIN_REQUIRED" };
  if (i.viewer.id === i.authorUserId) return { allowed: true, reason: "AUTHOR" };
  if (i.viewer.role === "ADMIN") return { allowed: true, reason: "ADMIN" };
  if (i.viewer.role === "EDITOR" && i.viewer.id === i.editorUserId) return { allowed: true, reason: "EDITOR" };
  if (i.ownsWholeBook) return { allowed: true, reason: "PURCHASED" };
  if (i.ownedSections.some((s) => i.chapterNumber >= s.firstChapter && i.chapterNumber <= s.lastChapter)) {
    return { allowed: true, reason: "PURCHASED_SECTION" };
  }
  return { allowed: false, reason: "PURCHASE_REQUIRED" };
}

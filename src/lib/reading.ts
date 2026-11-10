import type { Role, AccountStatus } from "@prisma/client";
import { db } from "./db";
import { canReadChapter, type AccessResult } from "./access";
import { checkAge } from "./age";

export type Viewer = { id: string; role: Role; status: AccountStatus; dateOfBirth: Date | null } | null;

export type ReadAccess = AccessResult | { allowed: false; reason: "AGE_LOGIN" | "DOB_REQUIRED" | "TOO_YOUNG"; minAge: number };

/** Loads what's needed and decides whether `viewer` may read chapter `n` of an on-sale book. */
export async function chapterAccess(viewer: Viewer, bookId: string, n: number): Promise<ReadAccess> {
  const book = await db.book.findUniqueOrThrow({ where: { id: bookId }, include: { penName: { include: { author: true } }, editor: true } });
  const isStaffOrOwner = !!viewer && (viewer.role === "ADMIN" || viewer.id === book.penName?.author.userId || viewer.id === book.editor?.userId);
  if (!isStaffOrOwner) {
    const age = checkAge(book.ageRating, viewer);
    if (!age.ok) return { allowed: false, reason: age.reason === "LOGIN_REQUIRED" ? "AGE_LOGIN" : age.reason, minAge: age.minAge };
  }
  const purchases = viewer ? await db.purchase.findMany({ where: { userId: viewer.id, bookId, format: "TEXT" }, include: { section: true } }) : [];
  return canReadChapter({
    chapterNumber: n,
    lockChapter: book.lockChapter,
    viewer,
    authorUserId: book.penName?.author.userId ?? null,
    editorUserId: book.editor?.userId ?? null,
    ownsWholeBook: purchases.some((p) => p.sectionId === null),
    ownedSections: purchases.flatMap((p) => (p.section ? [p.section] : [])),
  });
}

/** Whether viewer may play a book's audio or video (bought, or author/editor/admin). */
export async function mediaAccess(viewer: Viewer, bookId: string, kind: "AUDIO" | "VIDEO"): Promise<boolean> {
  if (!viewer || viewer.status === "BLOCKED") return false;
  const book = await db.book.findUniqueOrThrow({ where: { id: bookId }, include: { penName: { include: { author: true } }, editor: true } });
  if (viewer.role === "ADMIN" || viewer.id === book.penName?.author.userId || viewer.id === book.editor?.userId) return true;
  if (!checkAge(book.ageRating, viewer).ok) return false;
  return !!(await db.purchase.findFirst({ where: { userId: viewer.id, bookId, format: kind } }));
}

/** Count a view once per reader per chapter; keep reading progress. */
export async function recordRead(userId: string, bookId: string, chapterId: string, n: number) {
  const created = await db.chapterView.createMany({ data: [{ userId, chapterId }], skipDuplicates: true });
  if (created.count === 1) await db.chapter.update({ where: { id: chapterId }, data: { views: { increment: 1 } } });
  await db.readingProgress.upsert({
    where: { userId_bookId: { userId, bookId } },
    update: { lastChapter: n },
    create: { userId, bookId, lastChapter: n },
  });
}

/** All chapter numbers `viewer` can open (one query instead of one per chapter). */
export async function readableChapters(viewer: Viewer, bookId: string): Promise<number[]> {
  const first = await chapterAccess(viewer, bookId, 1);
  if (!first.allowed && (first.reason === "AGE_LOGIN" || first.reason === "DOB_REQUIRED" || first.reason === "TOO_YOUNG")) return [];
  const book = await db.book.findUniqueOrThrow({
    where: { id: bookId },
    select: { lockChapter: true, chapters: { select: { number: true }, orderBy: { number: "asc" } }, penName: { select: { author: { select: { userId: true } } } }, editor: { select: { userId: true } } },
  });
  const purchases = viewer ? await db.purchase.findMany({ where: { userId: viewer.id, bookId, format: "TEXT" }, include: { section: true } }) : [];
  const input = {
    lockChapter: book.lockChapter, viewer,
    authorUserId: book.penName?.author.userId ?? null, editorUserId: book.editor?.userId ?? null,
    ownsWholeBook: purchases.some((p) => p.sectionId === null), ownedSections: purchases.flatMap((p) => (p.section ? [p.section] : [])),
  };
  return book.chapters.map((c) => c.number).filter((n) => canReadChapter({ ...input, chapterNumber: n }).allowed);
}

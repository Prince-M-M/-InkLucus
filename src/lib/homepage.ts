import type { HomepageList } from "@prisma/client";
import { db } from "./db";
import { DomainError } from "./errors";

/** Homepage lists run in fixed two-week periods starting on Mondays (UTC). */
export const PERIOD_DAYS = 14;
export const PERIOD_EPOCH = Date.UTC(2026, 0, 5); // Monday 5 Jan 2026
export const MAX_APPROVED_PER_LIST = 12;
const PERIOD_MS = PERIOD_DAYS * 86_400_000;

export const LIST_LABELS: Record<HomepageList, string> = {
  EDITORS_PICKS: "Editor's Picks",
  POPULAR: "Popular",
  BEST_SELLING: "Best Selling",
  FEATURED_LANGUAGE: "Featured language",
};

export type Period = { start: Date; end: Date };

export function periodFor(date: Date): Period {
  const n = Math.floor((date.getTime() - PERIOD_EPOCH) / PERIOD_MS);
  const start = PERIOD_EPOCH + n * PERIOD_MS;
  return { start: new Date(start), end: new Date(start + PERIOD_MS) };
}

/** The current period and the next one: admins can schedule up to two weeks ahead. */
export function schedulablePeriods(now = new Date()): Period[] {
  const current = periodFor(now);
  return [current, { start: current.end, end: new Date(current.end.getTime() + PERIOD_MS) }];
}

function assertSchedulable(start: Date, now: Date) {
  if (!schedulablePeriods(now).some((p) => p.start.getTime() === start.getTime())) {
    throw new DomainError("INVALID", "Pick the current or the next two-week period");
  }
}

/** Editors submit their lists for a period. Only their own on-sale books (admins: any). */
export async function proposeSlot(
  proposer: { editorProfileId: string; isAdmin: boolean },
  input: { bookId: string; list: HomepageList; periodStart: Date },
  now = new Date(),
) {
  assertSchedulable(input.periodStart, now);
  const book = await db.book.findUnique({ where: { id: input.bookId } });
  if (!book || book.status !== "ON_SALE") throw new DomainError("INVALID", "Only books on sale can be featured");
  if (!proposer.isAdmin && book.editorId !== proposer.editorProfileId) throw new DomainError("FORBIDDEN", "You can only propose your own books");
  const { start, end } = periodFor(input.periodStart);
  try {
    return await db.homepageSlot.create({
      data: {
        list: input.list, bookId: book.id, proposedById: proposer.editorProfileId, startsAt: start, endsAt: end,
        language: input.list === "FEATURED_LANGUAGE" ? book.language : null,
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new DomainError("CONFLICT", "That book is already proposed for this list and period");
    throw e;
  }
}

export async function withdrawProposal(editorProfileId: string, slotId: string) {
  const res = await db.homepageSlot.deleteMany({ where: { id: slotId, proposedById: editorProfileId, status: "PROPOSED" } });
  if (res.count !== 1) throw new DomainError("FORBIDDEN", "Only your own pending proposals can be withdrawn");
}

/** Admin approves/declines a proposal (or un-approves by declining). */
export async function reviewSlot(adminId: string, slotId: string, approve: boolean, now = new Date()) {
  return db.$transaction(async (tx) => {
    const slot = await tx.homepageSlot.findUnique({ where: { id: slotId } });
    if (!slot) throw new DomainError("NOT_FOUND", "Proposal not found");
    if (slot.endsAt <= now) throw new DomainError("INVALID", "That period is over");
    if (approve) {
      const approved = await tx.homepageSlot.count({
        where: { list: slot.list, startsAt: slot.startsAt, status: "APPROVED", language: slot.language, id: { not: slot.id } },
      });
      if (approved >= MAX_APPROVED_PER_LIST) throw new DomainError("LIMIT", `A list can show at most ${MAX_APPROVED_PER_LIST} books per period`);
    }
    return tx.homepageSlot.update({ where: { id: slotId }, data: { status: approve ? "APPROVED" : "DECLINED", approvedById: approve ? adminId : null } });
  });
}

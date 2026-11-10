import { db } from "./db";
import { DomainError } from "./errors";

export const DEFAULT_DELETE_AFTER_DAYS = 30;
const DAY = 86_400_000;

export async function flagUser(reporterId: string, targetId: string, reason: string, commentId?: string) {
  const clean = reason.trim().slice(0, 500);
  if (!clean) throw new DomainError("INVALID", "Say why you're reporting this account");
  if (reporterId === targetId) throw new DomainError("INVALID", "You can't report yourself");
  const reporter = await db.user.findUnique({ where: { id: reporterId } });
  if (!reporter || reporter.status === "BLOCKED") throw new DomainError("FORBIDDEN", "Your account can't report others");
  // One flag per reporter per account: reporting again just updates the reason.
  return db.flag.upsert({
    where: { targetId_reporterId: { targetId, reporterId } },
    update: { reason: clean, commentId },
    create: { targetId, reporterId, reason: clean, commentId },
  });
}

/** Accounts with flags, most-flagged first. */
export async function flaggedAccounts() {
  const groups = await db.flag.groupBy({ by: ["targetId"], _count: { _all: true }, _max: { createdAt: true }, orderBy: { _count: { targetId: "desc" } }, take: 100 });
  const users = await db.user.findMany({
    where: { id: { in: groups.map((g) => g.targetId) } },
    include: { flagsReceived: { orderBy: { createdAt: "desc" }, take: 5, include: { reporter: { select: { displayName: true } } } } },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return groups.flatMap((g) => {
    const user = byId.get(g.targetId);
    return user ? [{ user, count: g._count._all, lastFlaggedAt: g._max.createdAt }] : [];
  });
}

/**
 * Restrict: can only read what they bought (no reviews, comments or submissions).
 * Block: the user sees the reason; the account is deleted after `deleteAfterDays` unless they appeal.
 */
export async function setAccountStatus(
  actorId: string,
  targetId: string,
  status: "ACTIVE" | "RESTRICTED" | "BLOCKED",
  reason: string | undefined,
  opts: { deleteAfterDays?: number; now?: Date } = {},
) {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Admins only");
  if (actorId === targetId) throw new DomainError("FORBIDDEN", "You can't change your own account status");
  const target = await db.user.findUnique({ where: { id: targetId } });
  if (!target) throw new DomainError("NOT_FOUND", "User not found");
  if (target.role === "ADMIN") throw new DomainError("FORBIDDEN", "Change the admin's account type before restricting them");
  if (status !== "ACTIVE" && !reason?.trim()) throw new DomainError("INVALID", "Give a reason. The user will see it");

  const now = opts.now ?? new Date();
  const days = opts.deleteAfterDays ?? DEFAULT_DELETE_AFTER_DAYS;
  if (!Number.isInteger(days) || days < 1) throw new DomainError("INVALID", "Deletion delay must be at least 1 day");

  return db.user.update({
    where: { id: targetId },
    data: {
      status,
      statusReason: status === "ACTIVE" ? null : reason!.trim(),
      deletionScheduledAt: status === "BLOCKED" ? new Date(now.getTime() + days * DAY) : null,
    },
  });
}

export async function submitAppeal(userId: string, message: string) {
  const clean = message.trim().slice(0, 2000);
  if (clean.length < 10) throw new DomainError("INVALID", "Explain your appeal in a few sentences");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.status === "ACTIVE") throw new DomainError("INVALID", "Your account is not restricted");
  if (await db.appeal.findFirst({ where: { userId, resolved: false } })) throw new DomainError("CONFLICT", "You already have an appeal waiting for review");
  return db.appeal.create({ data: { userId, message: clean } });
}

/** Reinstate (account becomes active) or uphold. An upheld block gets at least 7 more days before deletion. */
export async function resolveAppeal(actorId: string, appealId: string, reinstate: boolean, resolution: string, now = new Date()) {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.role !== "ADMIN") throw new DomainError("FORBIDDEN", "Admins only");
  if (!resolution.trim()) throw new DomainError("INVALID", "Write a reply to the user");
  return db.$transaction(async (tx) => {
    const appeal = await tx.appeal.findUnique({ where: { id: appealId }, include: { user: true } });
    if (!appeal || appeal.resolved) throw new DomainError("NOT_FOUND", "Appeal not found or already resolved");
    await tx.appeal.update({ where: { id: appealId }, data: { resolved: true, reinstated: reinstate, resolution: resolution.trim(), resolvedById: actorId, resolvedAt: now } });
    if (reinstate) {
      await tx.user.update({ where: { id: appeal.userId }, data: { status: "ACTIVE", statusReason: null, deletionScheduledAt: null } });
    } else if (appeal.user.status === "BLOCKED") {
      const minDate = new Date(now.getTime() + 7 * DAY);
      const current = appeal.user.deletionScheduledAt;
      if (!current || current < minDate) await tx.user.update({ where: { id: appeal.userId }, data: { deletionScheduledAt: minDate } });
    }
  });
}

/**
 * Scheduled job. Deletes blocked accounts whose grace period ended with no pending appeal.
 * Personal data and public content are removed; purchase and wallet records are kept (anonymised) for accounting.
 */
export async function purgeBlockedAccounts(now = new Date()) {
  const due = await db.user.findMany({
    where: { status: "BLOCKED", deletionScheduledAt: { lte: now }, appeals: { none: { resolved: false } }, email: { not: { endsWith: "@deleted.invalid" } } },
    select: { id: true },
  });
  for (const { id } of due) {
    await db.$transaction([
      db.comment.deleteMany({ where: { replies: { none: {} }, userId: id } }),
      db.comment.updateMany({ where: { userId: id }, data: { body: "[deleted]" } }),
      db.review.deleteMany({ where: { userId: id } }),
      db.wishlistItem.deleteMany({ where: { userId: id } }),
      db.bookLike.deleteMany({ where: { userId: id } }),
      db.readingProgress.deleteMany({ where: { userId: id } }),
      db.flag.deleteMany({ where: { reporterId: id } }),
      db.user.update({
        where: { id },
        data: { email: `${id}@deleted.invalid`, displayName: "Deleted user", passwordHash: "!", statusReason: "Deleted", deletionScheduledAt: null },
      }),
    ]);
  }
  return due.length;
}

import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { config } from "./config";
import { DomainError } from "./errors";
import { periodFor, type Period } from "./homepage";

/**
 * Royalty formula (per book, per two-week period):
 *   basis  = gross sales × (100 − ROYALTY_COST_DEDUCTION_PERCENT) / 100
 *   amount = basis × contract royaltyPercent / 100   (rounded to the cent)
 * Gross sales = everything readers paid for the book in the period (text, sections, audio, video).
 */
export function royaltyFor(grossCents: number, royaltyPercent: number, deductionPercent = config().ROYALTY_COST_DEDUCTION_PERCENT) {
  return Math.round((grossCents * (100 - deductionPercent) * royaltyPercent) / 10_000);
}

async function requireAccounting(actorId: string) {
  const a = await db.user.findUnique({ where: { id: actorId } });
  if (!a || a.role !== "ACCOUNTING" || a.status !== "ACTIVE") throw new DomainError("FORBIDDEN", "Accounting only");
  return a;
}

/** The period that ended most recently (what the biweekly job settles). */
export function lastCompletedPeriod(now = new Date()): Period {
  const current = periodFor(now);
  return periodFor(new Date(current.start.getTime() - 1));
}

/**
 * Creates/refreshes DRAFT statements for every author with sales in the period.
 * FINAL statements are never touched. Safe to run repeatedly.
 */
export async function generateStatements(period: Period) {
  const sales = await db.purchase.groupBy({
    by: ["bookId"],
    where: { createdAt: { gte: period.start, lt: period.end } },
    _sum: { amountCents: true },
    _count: { _all: true },
  });
  const contracts = await db.contract.findMany({ where: { bookId: { in: sales.map((s) => s.bookId) } } });
  const byAuthor = new Map<string, { bookId: string; copies: number; gross: number; pct: number }[]>();
  for (const s of sales) {
    for (const c of contracts.filter((c) => c.bookId === s.bookId)) {
      const list = byAuthor.get(c.authorId) ?? [];
      list.push({ bookId: s.bookId, copies: s._count._all, gross: s._sum.amountCents ?? 0, pct: c.royaltyPercent });
      byAuthor.set(c.authorId, list);
    }
  }
  let touched = 0;
  for (const [authorId, lines] of byAuthor) {
    await db.$transaction(async (tx) => {
      const existing = await tx.royaltyStatement.findUnique({ where: { authorId_periodStart: { authorId, periodStart: period.start } }, include: { adjustments: true } });
      if (existing?.status === "FINAL") return;
      const lineData = lines.map((l) => ({ bookId: l.bookId, copies: l.copies, grossCents: l.gross, royaltyPercent: l.pct, amountCents: royaltyFor(l.gross, l.pct) }));
      const linesTotal = lineData.reduce((a, l) => a + l.amountCents, 0);
      const adj = existing?.adjustments.reduce((a, x) => a + x.amountCents, 0) ?? 0;
      const gross = lineData.reduce((a, l) => a + l.grossCents, 0);
      if (existing) {
        await tx.royaltyLine.deleteMany({ where: { statementId: existing.id } });
        await tx.royaltyStatement.update({ where: { id: existing.id }, data: { grossCents: gross, amountCents: linesTotal + adj, lines: { create: lineData } } });
      } else {
        await tx.royaltyStatement.create({ data: { authorId, periodStart: period.start, periodEnd: period.end, grossCents: gross, amountCents: linesTotal, lines: { create: lineData } } });
      }
      touched++;
    });
  }
  return touched;
}

async function recalcTotal(tx: Prisma.TransactionClient, statementId: string) {
  const [lines, adj] = await Promise.all([
    tx.royaltyLine.aggregate({ where: { statementId }, _sum: { amountCents: true } }),
    tx.royaltyAdjustment.aggregate({ where: { statementId }, _sum: { amountCents: true } }),
  ]);
  await tx.royaltyStatement.update({ where: { id: statementId }, data: { amountCents: (lines._sum.amountCents ?? 0) + (adj._sum.amountCents ?? 0) } });
}

export async function addAdjustment(actorId: string, statementId: string, amountCents: number, note: string) {
  await requireAccounting(actorId);
  if (!Number.isInteger(amountCents) || amountCents === 0) throw new DomainError("INVALID", "Enter a non-zero amount");
  if (!note.trim()) throw new DomainError("INVALID", "Explain the adjustment");
  return db.$transaction(async (tx) => {
    const st = await tx.royaltyStatement.findUnique({ where: { id: statementId } });
    if (!st) throw new DomainError("NOT_FOUND", "Statement not found");
    if (st.status === "FINAL") throw new DomainError("INVALID", "Final statements can't be changed");
    await tx.royaltyAdjustment.create({ data: { statementId, amountCents, note: note.trim(), createdById: actorId } });
    await recalcTotal(tx, statementId);
  });
}

export async function finalizeStatement(actorId: string, statementId: string, now = new Date()) {
  await requireAccounting(actorId);
  const st = await db.royaltyStatement.findUnique({ where: { id: statementId } });
  if (!st) throw new DomainError("NOT_FOUND", "Statement not found");
  if (st.periodEnd > now) throw new DomainError("INVALID", "The period hasn't ended yet");
  const res = await db.royaltyStatement.updateMany({ where: { id: statementId, status: "DRAFT" }, data: { status: "FINAL", finalizedAt: now, finalizedById: actorId } });
  if (res.count !== 1) throw new DomainError("INVALID", "Already final");
}

/** Author's "income" = final statements only. */
export async function authorIncome(authorId: string) {
  const statements = await db.royaltyStatement.findMany({
    where: { authorId, status: "FINAL" },
    orderBy: { periodStart: "desc" },
    include: { lines: { include: { book: { select: { title: true } } } }, adjustments: true },
  });
  return { totalCents: statements.reduce((a, s) => a + s.amountCents, 0), statements };
}

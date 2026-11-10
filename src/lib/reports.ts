import { db } from "./db";
import type { Period } from "./homepage";

/** Live financial position plus activity in a period. */
export async function financeSummary(period: Period, now = new Date()) {
  const inPeriod = { gte: period.start, lt: period.end };
  const [wallets, activeCards, expiredCards, topUps, purchases, byFormat, redeemed, royaltiesFinal, royaltiesDraft] = await Promise.all([
    db.wallet.aggregate({ _sum: { balanceCents: true }, _count: { _all: true } }),
    db.giftCard.aggregate({ where: { status: "ACTIVE", expiresAt: { gt: now } }, _sum: { amountCents: true }, _count: { _all: true } }),
    db.giftCard.aggregate({ where: { OR: [{ status: "EXPIRED" }, { status: "ACTIVE", expiresAt: { lte: now } }] }, _sum: { amountCents: true }, _count: { _all: true } }),
    db.payment.aggregate({ where: { status: "PAID", paidAt: inPeriod }, _sum: { amountCents: true }, _count: { _all: true } }),
    db.purchase.aggregate({ where: { createdAt: inPeriod }, _sum: { amountCents: true }, _count: { _all: true } }),
    db.purchase.groupBy({ by: ["format"], where: { createdAt: inPeriod }, _sum: { amountCents: true }, _count: { _all: true } }),
    db.giftCard.aggregate({ where: { status: "REDEEMED", redeemedAt: inPeriod }, _sum: { amountCents: true }, _count: { _all: true } }),
    db.royaltyStatement.aggregate({ where: { periodStart: period.start, status: "FINAL" }, _sum: { amountCents: true } }),
    db.royaltyStatement.aggregate({ where: { periodStart: period.start, status: "DRAFT" }, _sum: { amountCents: true } }),
  ]);
  return {
    walletReservesCents: wallets._sum.balanceCents ?? 0,
    walletCount: wallets._count._all,
    giftCardReservesCents: activeCards._sum.amountCents ?? 0,
    activeGiftCards: activeCards._count._all,
    expiredUnredeemedCents: expiredCards._sum.amountCents ?? 0,
    topUpsCents: topUps._sum.amountCents ?? 0,
    topUpsCount: topUps._count._all,
    salesCents: purchases._sum.amountCents ?? 0,
    salesCount: purchases._count._all,
    salesByFormat: byFormat.map((f) => ({ format: f.format, cents: f._sum.amountCents ?? 0, count: f._count._all })),
    giftCardsRedeemedCents: redeemed._sum.amountCents ?? 0,
    royaltiesFinalCents: royaltiesFinal._sum.amountCents ?? 0,
    royaltiesDraftCents: royaltiesDraft._sum.amountCents ?? 0,
  };
}

/** Gross income of all books under each editor in a period. */
export async function editorGross(period: Period) {
  const sales = await db.purchase.groupBy({ by: ["bookId"], where: { createdAt: { gte: period.start, lt: period.end } }, _sum: { amountCents: true }, _count: { _all: true } });
  const books = await db.book.findMany({ where: { id: { in: sales.map((s) => s.bookId) } }, select: { id: true, editorId: true } });
  const editors = await db.editorProfile.findMany({ include: { user: { select: { displayName: true } } } });
  const totals = new Map<string, { cents: number; copies: number }>();
  for (const s of sales) {
    const ed = books.find((b) => b.id === s.bookId)?.editorId ?? "none";
    const t = totals.get(ed) ?? { cents: 0, copies: 0 };
    t.cents += s._sum.amountCents ?? 0;
    t.copies += s._count._all;
    totals.set(ed, t);
  }
  return editors
    .map((e) => ({ editorId: e.id, name: e.user.displayName, ...(totals.get(e.id) ?? { cents: 0, copies: 0 }) }))
    .concat(totals.has("none") ? [{ editorId: "none", name: "No editor", ...totals.get("none")! }] : [])
    .sort((a, b) => b.cents - a.cents);
}

/** Book purchase tracking for a period. */
export async function purchasesByBook(period: Period) {
  const sales = await db.purchase.groupBy({ by: ["bookId", "format"], where: { createdAt: { gte: period.start, lt: period.end } }, _sum: { amountCents: true }, _count: { _all: true } });
  const books = await db.book.findMany({ where: { id: { in: [...new Set(sales.map((s) => s.bookId))] } }, select: { id: true, code: true, title: true, isbn: true, penName: { select: { name: true } }, contracts: { select: { royaltyPercent: true } } } });
  const rows = books.map((b) => {
    const mine = sales.filter((s) => s.bookId === b.id);
    const by = (f: string) => mine.filter((s) => s.format === f).reduce((a, s) => a + (s._sum.amountCents ?? 0), 0);
    return {
      code: b.code, title: b.title, isbn: b.isbn, penName: b.penName?.name ?? "",
      copies: mine.reduce((a, s) => a + s._count._all, 0),
      textCents: by("TEXT"), audioCents: by("AUDIO"), videoCents: by("VIDEO"),
      totalCents: mine.reduce((a, s) => a + (s._sum.amountCents ?? 0), 0),
      hasContract: b.contracts.length > 0,
    };
  });
  return rows.sort((a, b) => b.totalCents - a.totalCents);
}

const csvCell = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function toCsv(rows: Record<string, string | number | null>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  if (cols.length === 0) return "";
  return [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
}

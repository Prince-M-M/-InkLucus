import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/guards";
import { formatCents } from "@/lib/money";
import { editorGross, financeSummary, purchasesByBook } from "@/lib/reports";
import { reportPeriod } from "@/lib/periods";
import { periodFor } from "@/lib/homepage";
import { config } from "@/lib/config";
import { ActionForm } from "@/components/ActionForm";
import { PeriodPicker } from "@/components/PeriodPicker";
import { StatTile } from "@/components/StatTile";
import { Tabs, pickTab } from "@/components/Tabs";
import { Card, Field, btnCls, inputCls } from "@/components/ui";
import { generateAction, walletAdjustmentAction } from "./actions";

export const metadata: Metadata = { title: "Accounting" };
const TABS = [["overview", "Overview"], ["royalties", "Author royalties"], ["purchases", "Book purchases"], ["editors", "Editors' gross income"], ["wallets", "Wallets"]] as const;
const DAY = 86_400_000;
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function Accounting({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string; p?: string; q?: string }> }) {
  const sp = await searchParams;
  await requireRole("ACCOUNTING", "ADMIN");
  const tab = pickTab(TABS, sp.tab);
  const period = reportPeriod(sp.period);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Accounting</h1>
      <Tabs base="/accounting" tabs={TABS} active={tab} />
      {tab === "overview" && <Overview period={period} />}
      {tab === "royalties" && <Royalties p={sp.p} />}
      {tab === "purchases" && <Purchases period={period} />}
      {tab === "editors" && <Editors period={period} />}
      {tab === "wallets" && <Wallets q={sp.q} />}
    </div>
  );
}

type RP = ReturnType<typeof reportPeriod>;

async function Overview({ period }: { period: RP }) {
  const f = await financeSummary(period);
  return (
    <div className="space-y-6">
      <PeriodPicker base="/accounting?tab=overview" active={period.key} />
      <h2 className="font-semibold">Right now</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Wallet reserves" value={formatCents(f.walletReservesCents)} hint={`Unspent money in ${f.walletCount} wallets`} />
        <StatTile label="Gift card reserves" value={formatCents(f.giftCardReservesCents)} hint={`${f.activeGiftCards} active, unredeemed cards`} />
        <StatTile label="Expired, never redeemed" value={formatCents(f.expiredUnredeemedCents)} />
      </div>
      <h2 className="font-semibold">{period.label}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Wallet top-ups" value={formatCents(f.topUpsCents)} hint={`${f.topUpsCount} payments`} />
        <StatTile label="Book sales" value={formatCents(f.salesCents)} hint={`${f.salesCount} purchases`} />
        <StatTile label="Gift cards redeemed" value={formatCents(f.giftCardsRedeemedCents)} hint="Moved into wallets" />
      </div>
      <Card title="Sales by format">
        <ul className="text-sm">{f.salesByFormat.map((s) => <li key={s.format} className="flex justify-between border-b border-stone-100 py-1 dark:border-stone-900"><span>{s.format.toLowerCase()}</span><span className="tabular-nums">{s.count} · {formatCents(s.cents)}</span></li>)}</ul>
        {f.salesByFormat.length === 0 && <p className="text-sm text-stone-500">No sales in this period.</p>}
      </Card>
    </div>
  );
}

async function Royalties({ p }: { p?: string }) {
  const now = new Date();
  const current = periodFor(now);
  const periods = Array.from({ length: 8 }, (_, i) => periodFor(new Date(current.start.getTime() - i * 14 * DAY)));
  const active = periods.find((x) => x.start.toISOString() === p) ?? periods[1];
  const statements = await db.royaltyStatement.findMany({
    where: { periodStart: active.start },
    orderBy: { amountCents: "desc" },
    include: { author: { include: { user: { select: { displayName: true } } } }, _count: { select: { lines: true, adjustments: true } } },
  });
  const deduction = config().ROYALTY_COST_DEDUCTION_PERCENT;
  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-500">
        Each author&apos;s income per two-week period = sales of their books × (100% − {deduction}% costs) × their contract royalty %.
        Statements are recalculated daily while in draft. Finalise them to show them to authors.
      </p>
      <div className="flex flex-wrap gap-2">
        {periods.map((x, i) => (
          <Link key={x.start.toISOString()} href={`/accounting?tab=royalties&p=${x.start.toISOString()}`}
            className={`rounded-full border px-3 py-1 text-xs ${x.start.getTime() === active.start.getTime() ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900" : "border-stone-300 dark:border-stone-700"}`}>
            {i === 0 ? "Current: " : ""}{fmtDate(x.start)}
          </Link>
        ))}
      </div>
      <form action={generateAction}><input type="hidden" name="periodStart" value={active.start.toISOString()} /><button className={btnCls}>Recalculate this period</button></form>
      {statements.length === 0 ? <p className="text-sm text-stone-500">No statements for {fmtDate(active.start)} – {fmtDate(new Date(active.end.getTime() - 1))}. Recalculate to create them from sales.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs uppercase text-stone-500"><tr><th className="py-1">Author</th><th>ID</th><th>Gross sales</th><th>Income</th><th>Status</th><th /></tr></thead>
            <tbody>{statements.map((s) => (
              <tr key={s.id} className="border-t border-stone-100 dark:border-stone-900">
                <td className="py-1.5">{s.author.user.displayName}</td><td className="font-mono text-xs">{s.author.internalCode}</td>
                <td>{formatCents(s.grossCents)}</td><td className="font-semibold">{formatCents(s.amountCents)}</td>
                <td className={s.status === "FINAL" ? "text-green-700" : "text-amber-700"}>{s.status.toLowerCase()}{s._count.adjustments > 0 && " · adjusted"}</td>
                <td><Link href={`/accounting/statements/${s.id}`} className="underline">Open</Link></td>
              </tr>
            ))}</tbody>
            <tfoot><tr className="border-t border-stone-300 font-semibold dark:border-stone-700"><td className="py-1.5" colSpan={2}>Total</td><td>{formatCents(statements.reduce((a, s) => a + s.grossCents, 0))}</td><td>{formatCents(statements.reduce((a, s) => a + s.amountCents, 0))}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

async function Purchases({ period }: { period: RP }) {
  const rows = await purchasesByBook(period);
  const recent = await db.purchase.findMany({ where: { createdAt: { gte: period.start, lt: period.end } }, orderBy: { createdAt: "desc" }, take: 50, include: { book: { select: { title: true } }, user: { select: { email: true } }, section: true } });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker base="/accounting?tab=purchases" active={period.key} />
        <a href={`/accounting/export?period=${period.key}`} className="text-sm underline">Download CSV</a>
      </div>
      <Card title={`By book · ${period.label}`}>
        {rows.length === 0 ? <p className="text-sm text-stone-500">No purchases.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-left text-xs uppercase text-stone-500"><tr><th className="py-1">Book</th><th>ISBN</th><th>Copies</th><th>Text</th><th>Audio</th><th>Video</th><th>Total</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.code} className="border-t border-stone-100 dark:border-stone-900">
                  <td className="py-1.5">{r.title} <span className="text-xs text-stone-500">{r.penName}</span>{!r.hasContract && <span className="ml-1 text-xs text-red-700">no contract</span>}</td>
                  <td className="text-xs">{r.isbn ?? "—"}</td><td>{r.copies}</td><td>{formatCents(r.textCents)}</td><td>{formatCents(r.audioCents)}</td><td>{formatCents(r.videoCents)}</td><td className="font-semibold">{formatCents(r.totalCents)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Latest purchases">
        <ul className="text-sm">{recent.map((p) => (
          <li key={p.id} className="flex flex-wrap justify-between gap-2 border-b border-stone-100 py-1 dark:border-stone-900">
            <span>{p.book.title} · {p.format === "TEXT" ? (p.section ? `ch. ${p.section.firstChapter}–${p.section.lastChapter}` : "whole book") : p.format.toLowerCase()} <span className="text-xs text-stone-500">{p.user.email} · {p.createdAt.toLocaleString()}</span></span>
            <span className="tabular-nums">{formatCents(p.amountCents)}</span>
          </li>
        ))}</ul>
      </Card>
    </div>
  );
}

async function Editors({ period }: { period: RP }) {
  const rows = await editorGross(period);
  return (
    <div className="space-y-4">
      <PeriodPicker base="/accounting?tab=editors" active={period.key} />
      <Card title={`Total gross income of books under each editor · ${period.label}`}>
        <table className="w-full text-sm tabular-nums">
          <thead className="text-left text-xs uppercase text-stone-500"><tr><th className="py-1">Editor</th><th>Copies</th><th>Gross income</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.editorId} className="border-t border-stone-100 dark:border-stone-900"><td className="py-1.5">{r.name}</td><td>{r.copies}</td><td>{formatCents(r.cents)}</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}

async function Wallets({ q }: { q?: string }) {
  const user = q ? await db.user.findUnique({ where: { email: q.toLowerCase() }, include: { wallet: { include: { entries: { orderBy: { createdAt: "desc" }, take: 50 } } } } }) : null;
  return (
    <div className="space-y-6">
      <form className="flex gap-2"><input type="hidden" name="tab" value="wallets" /><input name="q" type="email" defaultValue={q} placeholder="Account email" className={`${inputCls} max-w-sm`} /><button className={btnCls}>Look up</button></form>
      {q && !user && <p className="text-sm text-stone-500">No account with that email.</p>}
      {user && (
        <Card title={`${user.displayName}: ${formatCents(user.wallet?.balanceCents ?? 0)}`}>
          <ul className="text-sm">{user.wallet?.entries.map((e) => (
            <li key={e.id} className="flex justify-between gap-3 border-b border-stone-100 py-1 dark:border-stone-900">
              <span>{e.type.toLowerCase()} {e.note && <span className="text-stone-500">· {e.note}</span>} <span className="text-xs text-stone-500">{e.createdAt.toLocaleString()} {e.reference && `· ref ${e.reference}`}</span></span>
              <span className="tabular-nums">{formatCents(e.amountCents)}</span>
            </li>
          ))}</ul>
        </Card>
      )}
      <Card title="Adjust a wallet">
        <p className="mb-3 text-sm text-stone-500">For corrections, e.g. a payment that went through at the provider but not here. Every adjustment is logged with your name and note.</p>
        <ActionForm action={walletAdjustmentAction} submitLabel="Apply adjustment">
          <Field label="Account email"><input name="email" type="email" required defaultValue={q} className={inputCls} /></Field>
          <Field label="Amount" hint="Positive adds money, negative removes it."><input name="amount" required placeholder="5.00" className={inputCls} /></Field>
          <Field label="Reason"><input name="note" required className={inputCls} /></Field>
        </ActionForm>
      </Card>
    </div>
  );
}

import Link from "next/link";
import type { salesStats } from "@/lib/stats";
import { AGE_LABEL } from "@/lib/age";
import { LANGUAGES } from "@/lib/catalog";
import { formatCents } from "@/lib/money";
import { BreakdownTable, StatTile } from "./StatTile";
import { Stars } from "./Stars";
import { Card } from "./ui";

type S = Awaited<ReturnType<typeof salesStats>>;

export function SalesStatsView({ s }: { s: S }) {
  const rows = (list: S["byGenre"], label?: (k: string) => string) => list.map((r) => ({ key: label ? label(r.key) : r.key, value: r.cents, extra: `${r.copies} copies` }));
  const ReviewList = ({ list }: { list: S["bestReviewed"] }) => list.length === 0 ? <p className="text-sm text-stone-500">No reviews yet.</p> : (
    <ul className="space-y-1 text-sm">{list.map((b) => <li key={b.code}><Stars value={b.avgRating ?? 0} /> {(b.avgRating ?? 0).toFixed(1)} <Link href={`/books/${b.code}`} className="underline">{b.title}</Link> <span className="text-stone-500">({b.reviewCount})</span></li>)}</ul>
  );
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Sales" value={formatCents(s.totals.cents)} /><StatTile label="Copies" value={s.totals.copies} />
        <StatTile label="Books" value={s.books.length} /><StatTile label="On wishlists" value={s.books.reduce((a, b) => a + b.wishlists, 0)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="New vs older books"><BreakdownTable rows={rows(s.byNew)} valueLabel="Sales" format={formatCents} /></Card>
        <Card title="By language"><BreakdownTable rows={rows(s.byLanguage, (k) => LANGUAGES[k] ?? k)} valueLabel="Sales" format={formatCents} /></Card>
        <Card title="By genre"><BreakdownTable rows={rows(s.byGenre)} valueLabel="Sales" format={formatCents} /></Card>
        <Card title="By age rating"><BreakdownTable rows={rows(s.byAgeRating, (k) => AGE_LABEL[k as keyof typeof AGE_LABEL] ?? k)} valueLabel="Sales" format={formatCents} /></Card>
        <Card title="Best-selling authors"><BreakdownTable rows={s.bestSellingAuthors.map((a) => ({ key: a.name, value: a.cents, extra: `${a.copies} copies` }))} valueLabel="Sales" format={formatCents} /></Card>
        <div className="grid gap-6">
          <Card title="Best reviewed"><ReviewList list={s.bestReviewed} /></Card>
          <Card title="Worst reviewed"><ReviewList list={s.worstReviewed} /></Card>
        </div>
      </div>
      <Card title="Every book">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs uppercase text-stone-500"><tr><th className="py-1">Book</th><th>Pen name</th><th>Copies</th><th>Sales</th><th>Likes</th><th>Wishlists</th><th>Rating</th></tr></thead>
            <tbody>{s.books.map((b) => (
              <tr key={b.code} className="border-t border-stone-100 dark:border-stone-900">
                <td className="py-1.5"><Link href={`/books/${b.code}`} className="underline">{b.title}</Link></td><td>{b.penName}</td>
                <td>{b.copies}</td><td>{formatCents(b.cents)}</td><td>{b.likes}</td><td>{b.wishlists}</td><td>{b.avgRating != null ? `${b.avgRating.toFixed(1)} (${b.reviewCount})` : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAuthor } from "@/lib/guards";
import { authorStats } from "@/lib/stats";
import { authorIncome } from "@/lib/royalties";
import { formatCents } from "@/lib/money";
import { Tabs, pickTab } from "@/components/Tabs";
import { StatTile } from "@/components/StatTile";
import { Stars } from "@/components/Stars";
import { Card, StatusBadge, btnCls } from "@/components/ui";

export const metadata: Metadata = { title: "Author dashboard" };
const TABS = [["books", "Books"], ["stats", "Statistics"], ["income", "Income"]] as const;

export default async function AuthorDashboard({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = pickTab(TABS, (await searchParams).tab);
  const { user, author } = await requireAuthor();
  const profile = await db.authorProfile.findUniqueOrThrow({
    where: { id: author.id },
    include: { editor: { include: { user: true } }, penNames: { include: { editor: { include: { user: true } } } } },
  });
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Author dashboard</h1><p className="text-sm text-stone-500">Author ID {profile.internalCode}</p></div>
        <Link href="/author/submit" className={btnCls}>Submit new book</Link>
      </header>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Your editor">
          {profile.editor ? (
            <p className="text-sm">{profile.editor.user.displayName}<br /><a className="underline" href={`mailto:${profile.editor.contactEmail}`}>{profile.editor.contactEmail}</a>{profile.editor.contactPhone && <> · {profile.editor.contactPhone}</>}</p>
          ) : <p className="text-sm text-stone-500">No editor assigned yet.</p>}
        </Card>
        <Card title={`Pen names (${profile.penNames.length}/5)`}>
          {profile.penNames.length === 0 ? <p className="text-sm text-stone-500">Your editor sets up pen names with you.</p> : (
            <ul className="space-y-1 text-sm">{profile.penNames.map((p) => (
              <li key={p.id}><Link href={`/pen/${p.slug}`} className="underline">{p.name}</Link>{p.editor && <span className="text-stone-500"> · editor {p.editor.user.displayName} (<a className="underline" href={`mailto:${p.editor.contactEmail}`}>{p.editor.contactEmail}</a>)</span>}</li>
            ))}</ul>
          )}
        </Card>
      </div>
      <Tabs base="/author" tabs={TABS} active={tab} />
      {tab === "books" && <Books userId={user.id} authorId={author.id} />}
      {tab === "stats" && <Stats authorId={author.id} />}
      {tab === "income" && <Income authorId={author.id} />}
    </div>
  );
}

async function Books({ userId, authorId }: { userId: string; authorId: string }) {
  const [books, socials] = await Promise.all([
    db.book.findMany({
      where: { OR: [{ submitterId: userId }, { penName: { authorId } }] },
      orderBy: { createdAt: "desc" },
      include: { penName: true, editor: { include: { user: true } }, _count: { select: { chapters: true, wishlist: true, likes: true, purchases: true } } },
    }),
    db.socialLink.findMany({ where: { audience: "AUTHOR" } }),
  ]);
  return (
    <div className="space-y-6">
      {books.length === 0 ? <p className="text-sm text-stone-500">No books yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-stone-500"><tr><th className="py-2">Title</th><th>Status</th><th>Chapters</th><th>Sales</th><th>Likes</th><th>Wishlists</th><th>Editor contact</th></tr></thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
              {books.map((b) => (
                <tr key={b.id}>
                  <td className="py-2"><Link href={`/author/books/${b.id}`} className="underline">{b.title}</Link>{b.penName && <div className="text-xs text-stone-500">as {b.penName.name}</div>}</td>
                  <td><StatusBadge status={b.status} /></td>
                  <td>{b._count.chapters}</td><td>{b._count.purchases}</td><td>{b._count.likes}</td><td>{b._count.wishlist}</td>
                  <td className="text-xs">{b.editor ? <a href={`mailto:${b.editor.contactEmail}`} className="underline">{b.editor.user.displayName}</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {socials.length > 0 && <Card title="Author community">{socials.map((s) => <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="mr-4 text-sm underline">{s.label}</a>)}</Card>}
    </div>
  );
}

async function Stats({ authorId }: { authorId: string }) {
  const s = await authorStats(authorId, 6);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Copies sold" value={s.totals.copies} /><StatTile label="Likes" value={s.totals.likes} /><StatTile label="On wishlists" value={s.totals.wishlists} />
        <StatTile label="Chapter reads" value={s.totals.views} /><StatTile label="Reviews" value={s.totals.reviews} /><StatTile label="Comments" value={s.totals.comments} />
      </div>
      <Card title="Copies sold per month">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm tabular-nums">
            <thead className="text-xs uppercase text-stone-500"><tr><th className="py-1 text-left">Book</th>{s.months.map((m) => <th key={m}>{m}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {s.books.map((b) => <tr key={b.id} className="border-t border-stone-100 dark:border-stone-900"><td className="py-1.5 text-left">{b.title}</td>{b.monthly.map((n, i) => <td key={i}>{n}</td>)}<td className="font-semibold">{b.copiesTotal}</td></tr>)}
              <tr className="border-t border-stone-300 font-semibold dark:border-stone-700"><td className="py-1.5 text-left">All books</td>{s.totals.monthly.map((n, i) => <td key={i}>{n}</td>)}<td>{s.totals.copies}</td></tr>
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Per book">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-stone-500"><tr><th className="py-1">Book</th><th>Likes</th><th>Wishlists</th><th>Reads</th><th>Readers</th><th>Rating</th><th>Comments (this month)</th></tr></thead>
            <tbody>{s.books.map((b) => (
              <tr key={b.id} className="border-t border-stone-100 tabular-nums dark:border-stone-900">
                <td className="py-1.5"><Link href={`/books/${b.code}`} className="underline">{b.title}</Link></td>
                <td>{b._count.likes}</td><td>{b._count.wishlist}</td><td>{b.views}</td><td>{b._count.progress}</td>
                <td>{b.avgRating != null ? <><Stars value={b.avgRating} /> {b.avgRating.toFixed(1)} ({b.reviewCount})</> : "—"}</td>
                <td>{b.comments} ({b.commentsMonthly.at(-1)})</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

async function Income({ authorId }: { authorId: string }) {
  const inc = await authorIncome(authorId);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return (
    <div className="space-y-6">
      <StatTile label="Total income" value={formatCents(inc.totalCents)} hint="Your profit share under your contracts, settled every two weeks." />
      {inc.statements.length === 0 ? <p className="text-sm text-stone-500">No settled statements yet. Statements appear here once accounting finalises each two-week period.</p> : inc.statements.map((st) => (
        <Card key={st.id} title={`${fmt(st.periodStart)} – ${fmt(new Date(st.periodEnd.getTime() - 1))}: ${formatCents(st.amountCents)}`}>
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs uppercase text-stone-500"><tr><th className="py-1">Book</th><th>Copies</th><th>Sales</th><th>Your share</th><th>Income</th></tr></thead>
            <tbody>
              {st.lines.map((l) => <tr key={l.id} className="border-t border-stone-100 dark:border-stone-900"><td className="py-1">{l.book.title}</td><td>{l.copies}</td><td>{formatCents(l.grossCents)}</td><td>{l.royaltyPercent}%</td><td>{formatCents(l.amountCents)}</td></tr>)}
              {st.adjustments.map((a) => <tr key={a.id} className="border-t border-stone-100 text-stone-600 dark:border-stone-900 dark:text-stone-400"><td className="py-1" colSpan={4}>Adjustment: {a.note}</td><td>{formatCents(a.amountCents)}</td></tr>)}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

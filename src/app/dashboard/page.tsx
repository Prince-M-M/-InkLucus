import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { recommendFor } from "@/lib/recommendations";
import { readerStats } from "@/lib/stats";
import { enabledProviders } from "@/lib/payments";
import { MAX_TOP_UP_CENTS, MIN_TOP_UP_CENTS } from "@/lib/wallet";
import { ActionForm } from "@/components/ActionForm";
import { BookCard, BookRow } from "@/components/BookCard";
import { Tabs, pickTab } from "@/components/Tabs";
import { Stars } from "@/components/Stars";
import { Card, Field, Notice, StatusBadge, inputCls } from "@/components/ui";
import { appealAction, buyGiftCardAction, redeemGiftCardAction, transferAction } from "@/app/actions";
import { topUpAction } from "@/app/wallet/actions";

export const metadata: Metadata = { title: "Dashboard" };

const TABS = [["overview", "Overview"], ["library", "Library"], ["wishlist", "Wishlist"], ["wallet", "Wallet"], ["stats", "Statistics"]] as const;
const PROVIDER_LABEL = { PAYNOW: "EcoCash / OneMoney / card (Paynow)", STRIPE: "Card (Stripe)", DEV: "Test payment (development)" } as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ tab?: string; submitted?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard");
  const hasWallet = user.role === "READER" || user.role === "AUTHOR";
  const tab = pickTab(TABS, sp.tab);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Hi, {user.displayName}</h1>
        <p className="text-sm text-stone-500">{user.role.toLowerCase()} account{user.authorProfile && <> · ID {user.authorProfile.internalCode}</>}</p>
      </header>
      {user.status !== "ACTIVE" && <AccountStatusPanel userId={user.id} status={user.status} reason={user.statusReason} deletionAt={user.deletionScheduledAt} />}
      {sp.submitted && <Notice tone="success">Thanks! Your book has been submitted. An editor will review it and leave you a message here.</Notice>}
      {user.role === "AUTHOR" && <Notice>Manage your books in the <Link href="/author" className="underline">author dashboard</Link>.</Notice>}
      {(user.role === "EDITOR" || user.role === "ADMIN") && <Notice>Go to the <Link href="/editor" className="underline">editor dashboard</Link>{user.role === "ADMIN" && <> or <Link href="/admin" className="underline">admin</Link></>}.</Notice>}
      {user.role === "ACCOUNTING" && <Notice>Go to <Link href="/accounting" className="underline">accounting</Link>.</Notice>}
      {hasWallet && <Tabs base="/dashboard" tabs={TABS} active={tab} />}
      {(!hasWallet || tab === "overview") && <Overview userId={user.id} role={user.role} />}
      {hasWallet && tab === "library" && <Library userId={user.id} />}
      {hasWallet && tab === "wishlist" && <Wishlist userId={user.id} />}
      {hasWallet && tab === "wallet" && user.status !== "BLOCKED" && <Wallet userId={user.id} />}
      {hasWallet && tab === "stats" && <Stats userId={user.id} />}
    </div>
  );
}

async function Overview({ userId, role }: { userId: string; role: string }) {
  const [progress, submissions, socials, recs] = await Promise.all([
    db.readingProgress.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 6, include: { book: { select: { code: true, title: true, _count: { select: { chapters: true } } } } } }),
    db.book.findMany({ where: { submitterId: userId }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, decisionMessage: true, createdAt: true } }),
    db.socialLink.findMany({ where: { audience: role as "READER" } }),
    role === "READER" || role === "AUTHOR" ? recommendFor(userId) : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-8">
      {role === "READER" && submissions.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Your submissions</h2>
          <ul className="space-y-3">{submissions.map((b) => (
            <li key={b.id} className="rounded-md border border-stone-200 p-3 dark:border-stone-800">
              <div className="flex flex-wrap items-center gap-2"><b>{b.title}</b><StatusBadge status={b.status} /><span className="text-xs text-stone-500">{b.createdAt.toDateString()}</span></div>
              {b.decisionMessage && <p className="mt-1 text-sm"><span className="text-stone-500">Editor&apos;s message:</span> {b.decisionMessage}</p>}
            </li>
          ))}</ul>
        </section>
      )}
      {(role === "READER" || role === "AUTHOR") && (
        <section>
          <h2 className="mb-2 font-semibold">Continue reading</h2>
          {progress.length === 0 ? <p className="text-sm text-stone-500">Nothing yet. <Link href="/browse" className="underline">Find a book</Link>.</p> : (
            <ul className="space-y-1">{progress.map((p) => (
              <li key={p.bookId}><Link className="underline" href={`/books/${p.book.code}/${p.lastChapter}`}>{p.book.title}</Link> <span className="text-sm text-stone-500">ch. {p.lastChapter}/{p.book._count.chapters}</span></li>
            ))}</ul>
          )}
        </section>
      )}
      <BookRow title="Recommended for you" books={recs} />
      {socials.length > 0 && <Card title="Community">{socials.map((s) => <a key={s.id} href={s.url} rel="noopener noreferrer" target="_blank" className="mr-4 underline">{s.label}</a>)}</Card>}
      {role === "READER" && <p><Link href="/become-an-author" className="underline">Want to become an author? See the requirements →</Link></p>}
    </div>
  );
}

async function Library({ userId }: { userId: string }) {
  const purchases = await db.purchase.findMany({
    where: { userId }, orderBy: { createdAt: "desc" },
    include: { book: { select: { id: true, code: true, title: true, coverUrl: true, language: true, genres: true, penName: { select: { name: true, slug: true } } } }, section: true },
  });
  const byBook = new Map<string, { book: (typeof purchases)[number]["book"]; items: string[] }>();
  for (const p of purchases) {
    const e = byBook.get(p.bookId) ?? { book: p.book, items: [] };
    e.items.push(p.format === "AUDIO" ? "Audiobook" : p.format === "VIDEO" ? "Video" : p.section ? `Ch. ${p.section.firstChapter}–${p.section.lastChapter}` : "Whole book");
    byBook.set(p.bookId, e);
  }
  if (byBook.size === 0) return <p className="text-sm text-stone-500">You haven&apos;t bought any books yet. <Link href="/browse" className="underline">Browse</Link></p>;
  return (
    <div className="flex flex-wrap gap-6">
      {[...byBook.values()].map(({ book, items }) => (
        <div key={book.id}><BookCard book={book} /><p className="mt-1 w-36 text-xs text-stone-500">{items.join(" · ")}</p></div>
      ))}
    </div>
  );
}

async function Wishlist({ userId }: { userId: string }) {
  const items = await db.wishlistItem.findMany({ where: { userId, book: { status: "ON_SALE" } }, orderBy: { createdAt: "desc" }, include: { book: { select: { code: true, title: true, coverUrl: true, language: true, genres: true, penName: { select: { name: true, slug: true } } } } } });
  return items.length === 0 ? <p className="text-sm text-stone-500">Your wishlist is empty.</p> : <div className="flex flex-wrap gap-6">{items.map((w) => <BookCard key={w.bookId} book={w.book} />)}</div>;
}

async function Wallet({ userId }: { userId: string }) {
  const [wallet, cards] = await Promise.all([
    db.wallet.upsert({ where: { userId }, update: {}, create: { userId }, include: { entries: { orderBy: { createdAt: "desc" }, take: 30 } } }),
    db.giftCard.findMany({ where: { buyerId: userId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const providers = enabledProviders();
  const now = new Date();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-3xl font-bold tabular-nums">{formatCents(wallet.balanceCents)}</p>
        <p className="text-xs text-stone-500">Wallet funds can only be spent on books, sent to other accounts or turned into gift cards. They can&apos;t be withdrawn.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Top up">
          {providers.length === 0 ? <p className="text-sm text-stone-500">Online payments aren&apos;t set up yet.</p> : (
            <ActionForm action={topUpAction} submitLabel="Continue to payment">
              <Field label="Amount" hint={`Between ${formatCents(MIN_TOP_UP_CENTS)} and ${formatCents(MAX_TOP_UP_CENTS)}`}><input name="amount" inputMode="decimal" required placeholder="10.00" className={inputCls} /></Field>
              <Field label="Pay with"><select name="provider" className={inputCls}>{providers.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}</select></Field>
            </ActionForm>
          )}
        </Card>
        <Card title="Send to a friend">
          <ActionForm action={transferAction} submitLabel="Send">
            <Field label="Friend's email"><input name="email" type="email" required className={inputCls} /></Field>
            <Field label="Amount"><input name="amount" inputMode="decimal" required placeholder="5.00" className={inputCls} /></Field>
          </ActionForm>
        </Card>
        <Card title="Buy a gift card">
          <ActionForm action={buyGiftCardAction} submitLabel="Buy gift card" inlineSuccess>
            <Field label="Amount" hint="Gift cards are valid for a year."><input name="amount" inputMode="decimal" required placeholder="10.00" className={inputCls} /></Field>
          </ActionForm>
        </Card>
        <Card title="Redeem a gift card">
          <ActionForm action={redeemGiftCardAction} submitLabel="Redeem">
            <Field label="Code"><input name="code" required placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" className={`${inputCls} uppercase`} /></Field>
          </ActionForm>
        </Card>
      </div>
      {cards.length > 0 && (
        <Card title="Gift cards you bought">
          <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">{cards.map((c) => {
            const status = c.status === "ACTIVE" && c.expiresAt <= now ? "EXPIRED" : c.status;
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-mono">{c.code}</span>
                <span>{formatCents(c.amountCents)} · {status.toLowerCase()}{status === "ACTIVE" && <> · until {c.expiresAt.toLocaleDateString()} · <Link className="underline" href={`/gift/${c.code}`}>share link</Link></>}</span>
              </li>
            );
          })}</ul>
        </Card>
      )}
      <Card title="History">
        {wallet.entries.length === 0 ? <p className="text-sm text-stone-500">No transactions yet.</p> : (
          <ul className="text-sm">{wallet.entries.map((e) => (
            <li key={e.id} className="flex justify-between gap-3 border-b border-stone-200 py-1.5 dark:border-stone-800">
              <span>{e.type.replaceAll("_", " ").toLowerCase()}{e.note && <span className="text-stone-500">: {e.note}</span>} <span className="text-xs text-stone-500">{e.createdAt.toLocaleDateString()}</span></span>
              <span className={`tabular-nums ${e.amountCents < 0 ? "" : "text-green-700 dark:text-green-400"}`}>{e.amountCents > 0 ? "+" : ""}{formatCents(e.amountCents)}</span>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

async function Stats({ userId }: { userId: string }) {
  const s = await readerStats(userId);
  const stat = (label: string, v: number) => <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800"><p className="text-xs uppercase text-stone-500">{label}</p><p className="text-2xl font-semibold tabular-nums">{v}</p></div>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stat("Books started", s.booksStarted)}{stat("Finished", s.booksFinished)}{stat("Favourites", s.likes.length)}{stat("Reviews", s.reviews.length)}{stat("Comments", s.commentCount)}
      </div>
      <Card title="How far you've got">
        {s.books.length === 0 ? <p className="text-sm text-stone-500">Start a book to see your progress.</p> : (
          <ul className="space-y-2 text-sm">{s.books.map((b) => (
            <li key={b.code}>
              <div className="flex justify-between"><Link href={`/books/${b.code}/${b.lastChapter}`} className="underline">{b.title}</Link><span className="tabular-nums text-stone-500">{b.lastChapter}/{b.chapters} · {b.percent}%</span></div>
              <div className="mt-1 h-1.5 rounded bg-stone-200 dark:bg-stone-800"><div className="h-1.5 rounded bg-stone-900 dark:bg-stone-100" style={{ width: `${b.percent}%` }} /></div>
            </li>
          ))}</ul>
        )}
      </Card>
      {s.likes.length > 0 && <Card title="Favourites"><ul className="flex flex-wrap gap-x-4 text-sm">{s.likes.map((l) => <li key={l.bookId}><Link href={`/books/${l.book.code}`} className="underline">{l.book.title}</Link></li>)}</ul></Card>}
      {s.reviews.length > 0 && <Card title="Your reviews"><ul className="space-y-2 text-sm">{s.reviews.map((r) => <li key={r.id}><Stars value={r.rating} /> <Link href={`/books/${r.book.code}`} className="underline">{r.book.title}</Link>{r.body && <p className="text-stone-600 dark:text-stone-400">{r.body}</p>}</li>)}</ul></Card>}
    </div>
  );
}

async function AccountStatusPanel({ userId, status, reason, deletionAt }: { userId: string; status: "RESTRICTED" | "BLOCKED"; reason: string | null; deletionAt: Date | null }) {
  const appeals = await db.appeal.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5 });
  const pending = appeals.find((a) => !a.resolved);
  return (
    <section className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-5 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
      <h2 className="font-semibold">{status === "BLOCKED" ? "Your account is blocked" : "Your account is restricted"}</h2>
      <p className="text-sm"><b>Reason:</b> {reason}</p>
      <p className="text-sm">
        {status === "BLOCKED"
          ? <>You can&apos;t buy, read paid chapters, comment or review. {deletionAt && <>Unless you appeal, the account will be deleted on <b>{deletionAt.toDateString()}</b>.</>}</>
          : <>You can still read the books you bought, but you can&apos;t comment, review, like or submit books.</>}
      </p>
      {appeals.filter((a) => a.resolved).slice(0, 1).map((a) => <p key={a.id} className="text-sm"><b>Reply to your last appeal:</b> {a.resolution}</p>)}
      {pending ? <p className="text-sm">Your appeal from {pending.createdAt.toDateString()} is waiting for review.</p> : (
        <ActionForm action={appealAction} submitLabel="Send appeal">
          <textarea name="message" required minLength={10} rows={3} placeholder="Explain why this should be reviewed" className={inputCls} />
        </ActionForm>
      )}
    </section>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { Notice, StatusBadge, inputCls } from "@/components/ui";
import { buyGiftCardAction, redeemGiftCardAction, transferAction } from "@/app/actions";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  const { submitted } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");

  const [wallet, library, wishlist, socials, submissions] = await Promise.all([
    db.wallet.findUnique({ where: { userId: user.id }, include: { entries: { orderBy: { createdAt: "desc" }, take: 10 } } }),
    db.readingProgress.findMany({ where: { userId: user.id }, include: { book: { select: { code: true, title: true, _count: { select: { chapters: true } } } } }, orderBy: { updatedAt: "desc" } }),
    db.wishlistItem.findMany({ where: { userId: user.id }, include: { book: { select: { code: true, title: true } } } }),
    db.socialLink.findMany({ where: { audience: user.role } }),
    db.book.findMany({ where: { submitterId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, decisionMessage: true, createdAt: true } }),
  ]);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold">Hi, {user.displayName}</h1>
        <p className="text-sm text-stone-500">{user.role.toLowerCase()} account{user.authorProfile && <> · ID {user.authorProfile.internalCode}</>}</p>
        {user.status !== "ACTIVE" && <p className="mt-2 rounded bg-red-100 p-2 text-sm text-red-800">Your account is {user.status.toLowerCase()}: {user.statusReason}</p>}
      </header>

      {submitted && <Notice tone="success">Thanks! Your book has been submitted. An editor will review it and leave you a message here.</Notice>}
      {user.role === "AUTHOR" && <Notice>Go to your <Link href="/author" className="underline">author dashboard</Link> to manage your books.</Notice>}
      {(user.role === "EDITOR" || user.role === "ADMIN") && <Notice>Go to the <Link href="/editor" className="underline">editor dashboard</Link>.</Notice>}

      {user.role === "READER" && submissions.length > 0 && (
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

      <section>
        <h2 className="mb-2 font-semibold">Continue reading</h2>
        {library.length === 0 ? <p className="text-sm text-stone-500">Nothing yet — <Link href="/browse" className="underline">find a book</Link>.</p> : (
          <ul className="space-y-1">{library.map((p) => (
            <li key={p.bookId}><Link className="underline" href={`/books/${p.book.code}/${p.lastChapter}`}>{p.book.title}</Link> <span className="text-sm text-stone-500">ch. {p.lastChapter}/{p.book._count.chapters}</span></li>
          ))}</ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Wishlist</h2>
        <ul>{wishlist.map((w) => <li key={w.bookId}><Link className="underline" href={`/books/${w.book.code}`}>{w.book.title}</Link></li>)}</ul>
      </section>

      {wallet && (
        <section>
          <h2 className="font-semibold">Wallet: {formatCents(wallet.balanceCents)}</h2>
          <p className="text-xs text-stone-500">Wallet funds can only be spent on books and cannot be withdrawn.</p>
          <div className="mt-4 grid gap-6 sm:grid-cols-3">
            <ActionForm action={transferAction} submitLabel="Send to a friend">
              <input name="email" type="email" placeholder="Friend's email" required className={inputCls} />
              <input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount" required className={inputCls} />
            </ActionForm>
            <ActionForm action={buyGiftCardAction} submitLabel="Buy gift card">
              <input name="amount" type="number" step="0.01" min="1" placeholder="Gift card amount" required className={inputCls} />
            </ActionForm>
            <ActionForm action={redeemGiftCardAction} submitLabel="Redeem gift card">
              <input name="code" placeholder="XXXX-XXXX-XXXX-XXXX" required className={inputCls} />
            </ActionForm>
          </div>
          <ul className="mt-4 text-sm">{wallet.entries.map((e) => (
            <li key={e.id} className="flex justify-between border-b border-stone-200 py-1 dark:border-stone-800"><span>{e.type.replaceAll("_", " ").toLowerCase()}</span><span>{formatCents(e.amountCents)}</span></li>
          ))}</ul>
        </section>
      )}

      {socials.length > 0 && (
        <section><h2 className="mb-2 font-semibold">Community</h2>
          {socials.map((s) => <a key={s.id} href={s.url} className="mr-4 underline">{s.label}</a>)}
        </section>
      )}
      {user.role === "READER" && <p><Link href="/become-an-author" className="underline">Want to become an author? See the requirements →</Link></p>}
    </div>
  );
}

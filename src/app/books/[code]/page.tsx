import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { LANGUAGES } from "@/lib/catalog";
import { formatCents } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { buyAction, toggleWishlist } from "@/app/actions";

export default async function BookPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await currentUser();
  const book = await db.book.findUnique({
    where: { code },
    // Note: ISBN is deliberately NOT selected – it's internal only.
    select: {
      id: true, code: true, title: true, synopsis: true, coverUrl: true, language: true, genres: true, ageRating: true, status: true,
      lockChapter: true, wholeBookPriceCents: true, hasAudio: true, hasVideo: true, editorReview: true,
      penName: { select: { name: true, slug: true } },
      editor: { select: { user: { select: { displayName: true } } } },
      sections: { orderBy: { index: "asc" } },
      chapters: { orderBy: { number: "asc" }, select: { number: true, title: true } },
      _count: { select: { likes: true, wishlist: true } },
    },
  });
  if (!book || book.status !== "ON_SALE") notFound();

  const [owned, wished] = user
    ? await Promise.all([
        db.purchase.findMany({ where: { userId: user.id, bookId: book.id, format: "TEXT" } }),
        db.wishlistItem.findUnique({ where: { userId_bookId: { userId: user.id, bookId: book.id } } }),
      ])
    : [[], null];
  const ownsAll = owned.some((p) => p.sectionId === null);
  const ownedSections = new Set(owned.map((p) => p.sectionId));

  return (
    <div className="grid gap-8 md:grid-cols-[220px_1fr]">
      <div className="aspect-[2/3] rounded-md bg-stone-200 dark:bg-stone-800" />
      <div>
        <span className="rounded bg-stone-900 px-2 py-0.5 text-xs font-bold uppercase text-white dark:bg-stone-100 dark:text-stone-900">{LANGUAGES[book.language] ?? book.language}</span>
        <h1 className="mt-2 text-3xl font-bold">{book.title}</h1>
        {book.penName && <Link href={`/pen/${book.penName.slug}`} className="text-stone-600 underline dark:text-stone-400">{book.penName.name}</Link>}
        <p className="mt-1 text-sm text-stone-500">{book.genres.join(" · ")} · {book._count.likes} likes · on {book._count.wishlist} wishlists</p>
        <p className="mt-4 max-w-2xl whitespace-pre-line">{book.synopsis}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/books/${book.code}/1`} className="rounded-md bg-stone-900 px-4 py-2 text-white dark:bg-stone-100 dark:text-stone-900">Read</Link>
          {book.hasAudio && <button className="rounded-md border px-4 py-2">Listen</button>}
          {book.hasVideo && <button className="rounded-md border px-4 py-2">Watch</button>}
          {user && (
            <form action={toggleWishlist}>
              <input type="hidden" name="bookId" value={book.id} /><input type="hidden" name="code" value={book.code} />
              <button className="rounded-md border border-stone-300 px-4 py-2 dark:border-stone-700">{wished ? "♥ On wishlist" : "♡ Add to wishlist"}</button>
            </form>
          )}
        </div>

        {book.editorReview && (
          <blockquote className="mt-6 max-w-2xl border-l-4 border-amber-500 pl-4">
            <p className="text-xs font-bold uppercase text-amber-700">Editor&apos;s review — {book.editor?.user.displayName}</p>
            <p className="mt-1 italic">{book.editorReview}</p>
          </blockquote>
        )}

        <section className="mt-8">
          <h2 className="font-semibold">Buy</h2>
          {book.lockChapter && <p className="text-sm text-stone-500">Chapters 1–{book.lockChapter - 1} are free.</p>}
          {ownsAll ? <p className="mt-2 text-green-700">You own this book.</p> : !user ? (
            <p className="mt-2 text-sm"><Link href="/login" className="underline">Log in</Link> to buy.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-3">
              {book.wholeBookPriceCents != null && (
                <ActionForm action={buyAction} submitLabel={`Whole book – ${formatCents(book.wholeBookPriceCents)}`} className="flex flex-col gap-1">
                  <input type="hidden" name="bookId" value={book.id} />
                </ActionForm>
              )}
              {book.sections.map((s) => ownedSections.has(s.id) ? (
                <span key={s.id} className="self-start rounded-md border border-green-600 px-4 py-2 text-green-700 dark:text-green-400">✓ Owned: ch. {s.firstChapter}–{s.lastChapter}</span>
              ) : (
                <ActionForm key={s.id} action={buyAction} submitLabel={`Ch. ${s.firstChapter}–${s.lastChapter} – ${formatCents(s.priceCents)}`} className="flex flex-col gap-1">
                  <input type="hidden" name="bookId" value={book.id} /><input type="hidden" name="sectionId" value={s.id} />
                </ActionForm>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="font-semibold">Chapters</h2>
          <ol className="mt-2 divide-y divide-stone-200 dark:divide-stone-800">
            {book.chapters.map((c) => (
              <li key={c.number}>
                <Link href={`/books/${book.code}/${c.number}`} className="flex justify-between py-2 hover:underline">
                  <span>{c.number}. {c.title}</span>
                  {book.lockChapter && c.number >= book.lockChapter && <span className="text-xs text-stone-500">🔒</span>}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

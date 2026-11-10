import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { LANGUAGES } from "@/lib/catalog";
import { AGE_LABEL, checkAge } from "@/lib/age";
import { can } from "@/lib/rbac";
import { readableChapters } from "@/lib/reading";
import { formatCents } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { Cover } from "@/components/Cover";
import { Stars } from "@/components/Stars";
import { OfflineDownload } from "@/components/OfflineDownload";
import { Card, Field, Notice, btnCls, btnOutlineCls, inputCls } from "@/components/ui";
import { buyAction, deleteReviewAction, reviewAction, toggleLikeAction, toggleWishlistAction } from "@/app/actions";

// Never select the ISBN here: it is internal only.
const bookSelect = {
  id: true, code: true, title: true, synopsis: true, coverUrl: true, language: true, genres: true, ageRating: true, status: true,
  lockChapter: true, wholeBookPriceCents: true, audioPriceCents: true, videoPriceCents: true, videoDiscountPercentForOwners: true,
  editorReview: true, editionGroup: true, publishedAt: true,
  penName: { select: { name: true, slug: true, author: { select: { userId: true } } } },
  editor: { select: { userId: true, user: { select: { displayName: true } } } },
  sections: { orderBy: { index: "asc" as const } },
  chapters: { orderBy: { number: "asc" as const }, select: { number: true, title: true } },
  _count: { select: { likes: true, wishlist: true } },
} as const;

async function load(code: string) {
  return db.book.findUnique({ where: { code }, select: bookSelect });
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const book = await load((await params).code);
  if (!book || book.status !== "ON_SALE") return { title: "Book not found" };
  return { title: book.title, description: book.synopsis.slice(0, 160) };
}

export default async function BookPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await currentUser();
  const book = await load(code);
  if (!book || book.status !== "ON_SALE") notFound();

  const [owned, wished, liked, progress, reviews, ratingAgg, editions, media, myReview] = await Promise.all([
    user ? db.purchase.findMany({ where: { userId: user.id, bookId: book.id } }) : [],
    user ? db.wishlistItem.findUnique({ where: { userId_bookId: { userId: user.id, bookId: book.id } } }) : null,
    user ? db.bookLike.findUnique({ where: { userId_bookId: { userId: user.id, bookId: book.id } } }) : null,
    user ? db.readingProgress.findUnique({ where: { userId_bookId: { userId: user.id, bookId: book.id } } }) : null,
    db.review.findMany({ where: { bookId: book.id }, orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { displayName: true } } } }),
    db.review.aggregate({ where: { bookId: book.id }, _avg: { rating: true }, _count: { _all: true } }),
    book.editionGroup ? db.book.findMany({ where: { editionGroup: book.editionGroup, status: "ON_SALE", id: { not: book.id } }, select: { code: true, language: true, title: true } }) : [],
    db.mediaItem.groupBy({ by: ["kind"], where: { bookId: book.id }, _count: { _all: true } }),
    user ? db.review.findUnique({ where: { userId_bookId: { userId: user.id, bookId: book.id } } }) : null,
  ]);

  const text = owned.filter((p) => p.format === "TEXT");
  const ownsAll = text.some((p) => p.sectionId === null);
  const ownedSections = new Set(text.map((p) => p.sectionId));
  const hasAudio = media.some((m) => m.kind === "AUDIO") && book.audioPriceCents != null;
  const hasVideo = media.some((m) => m.kind === "VIDEO") && book.videoPriceCents != null;
  const isAuthor = !!user && user.id === book.penName?.author.userId;
  const age = checkAge(book.ageRating, user);
  const ageOk = age.ok || isAuthor || user?.role === "ADMIN" || user?.id === book.editor?.userId;
  const startAt = progress?.lastChapter ?? 1;
  const canReview = !!user && can(user, "engage:comment") && !!progress && !isAuthor;

  // Chapters this reader can open right now, for offline saving.
  const offlineUrls = user && ageOk ? (await readableChapters(user, book.id)).map((n) => `/books/${book.code}/${n}`) : [];

  return (
    <div className="grid gap-8 md:grid-cols-[220px_1fr]">
      <Cover url={book.coverUrl} title={book.title} className="w-44 md:w-full" />
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <span className="rounded bg-stone-900 px-2 py-0.5 text-xs font-bold uppercase text-white dark:bg-stone-100 dark:text-stone-900">{LANGUAGES[book.language] ?? book.language}</span>
          {book.ageRating !== "ALL" && <span className="rounded border border-stone-400 px-2 py-0.5 text-xs font-bold">{AGE_LABEL[book.ageRating]}</span>}
        </div>
        <h1 className="mt-2 text-3xl font-bold">{book.title}</h1>
        {book.penName && <Link href={`/pen/${book.penName.slug}`} className="text-stone-600 underline dark:text-stone-400">{book.penName.name}</Link>}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-stone-500">
          {ratingAgg._count._all > 0 && <><Stars value={ratingAgg._avg.rating ?? 0} /> <span>{(ratingAgg._avg.rating ?? 0).toFixed(1)} ({ratingAgg._count._all})</span> ·</>}
          <span>{book.genres.join(" · ")}</span> · <span>{book._count.likes} likes</span> · <span>on {book._count.wishlist} wishlists</span>
        </p>
        {editions.length > 0 && (
          <p className="mt-2 text-sm">Also available in: {editions.map((e, i) => <span key={e.code}>{i > 0 && ", "}<Link href={`/books/${e.code}`} className="underline">{LANGUAGES[e.language] ?? e.language}</Link></span>)}</p>
        )}
        <p className="mt-4 max-w-2xl whitespace-pre-line">{book.synopsis}</p>

        {!ageOk && !age.ok && (
          <div className="mt-4"><Notice tone="warn">
            This book is for readers aged {age.minAge}+.{" "}
            {age.reason === "LOGIN_REQUIRED" && <><Link href={`/login?next=/books/${book.code}`} className="underline">Log in</Link> to read it.</>}
            {age.reason === "DOB_REQUIRED" && <>Add your date of birth in <Link href="/settings" className="underline">Settings</Link> to read it.</>}
          </Notice></div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {ageOk && <Link href={`/books/${book.code}/${startAt}`} className={btnCls}>{progress ? `Continue (ch. ${startAt})` : "Read"}</Link>}
          {hasAudio && ageOk && <Link href={`/books/${book.code}/listen`} className={btnOutlineCls}>🎧 Listen</Link>}
          {hasVideo && ageOk && <Link href={`/books/${book.code}/watch`} className={btnOutlineCls}>▶ Watch</Link>}
          {user && (
            <>
              <form action={toggleWishlistAction}><input type="hidden" name="bookId" value={book.id} /><input type="hidden" name="code" value={book.code} />
                <button className={btnOutlineCls}>{wished ? "♥ On wishlist" : "♡ Wishlist"}</button></form>
              {can(user, "engage:comment") && !isAuthor && (
                <form action={toggleLikeAction}><input type="hidden" name="bookId" value={book.id} /><input type="hidden" name="code" value={book.code} />
                  <button className={btnOutlineCls}>{liked ? "★ Liked" : "☆ Like"}</button></form>
              )}
            </>
          )}
        </div>
        {offlineUrls.length > 0 && <div className="mt-4"><OfflineDownload urls={offlineUrls} bookCode={book.code} /></div>}

        {book.editorReview && (
          <blockquote className="mt-6 max-w-2xl border-l-4 border-amber-500 pl-4">
            <p className="text-xs font-bold uppercase text-amber-700">Editor&apos;s review: {book.editor?.user.displayName}</p>
            <p className="mt-1 italic">{book.editorReview}</p>
          </blockquote>
        )}

        <section className="mt-8">
          <h2 className="font-semibold">Buy</h2>
          {book.lockChapter && book.lockChapter > 1 && <p className="text-sm text-stone-500">Chapters 1–{book.lockChapter - 1} are free.</p>}
          {isAuthor ? <p className="mt-2 text-sm text-stone-500">This is your book. You can read all of it for free.</p>
            : ownsAll ? <p className="mt-2 text-green-700 dark:text-green-400">You own this book, including future chapters.</p>
            : !user ? <p className="mt-2 text-sm"><Link href={`/login?next=/books/${book.code}`} className="underline">Log in</Link> to buy.</p>
            : !ageOk ? null
            : (
              <div className="mt-3 flex flex-wrap gap-3">
                {book.wholeBookPriceCents != null && (() => {
                  const paid = text.reduce((a, p) => a + p.amountCents, 0);
                  const price = Math.max(0, book.wholeBookPriceCents - paid);
                  return (
                    <ActionForm action={buyAction} submitLabel={`Whole book: ${formatCents(price)}${paid ? " (after sections you own)" : ""}`} className="flex flex-col gap-1">
                      <input type="hidden" name="bookId" value={book.id} />
                    </ActionForm>
                  );
                })()}
                {book.sections.map((s) => ownedSections.has(s.id) ? (
                  <span key={s.id} className="self-start rounded-md border border-green-600 px-4 py-2 text-green-700 dark:text-green-400">✓ Owned: ch. {s.firstChapter}–{s.lastChapter}</span>
                ) : (
                  <ActionForm key={s.id} action={buyAction} submitLabel={`Ch. ${s.firstChapter}–${s.lastChapter}: ${formatCents(s.priceCents)}`} className="flex flex-col gap-1">
                    <input type="hidden" name="bookId" value={book.id} /><input type="hidden" name="sectionId" value={s.id} />
                  </ActionForm>
                ))}
              </div>
            )}
          {user && <p className="mt-2 text-xs text-stone-500">Purchases use your wallet. <Link href="/dashboard?tab=wallet" className="underline">Top up</Link></p>}
        </section>

        <section className="mt-8">
          <h2 className="font-semibold">Chapters ({book.chapters.length})</h2>
          <ol className="mt-2 max-h-[28rem] divide-y divide-stone-200 overflow-y-auto dark:divide-stone-800">
            {book.chapters.map((c) => (
              <li key={c.number}>
                <Link href={`/books/${book.code}/${c.number}`} className="flex justify-between gap-3 py-2 hover:underline">
                  <span>{c.number}. {c.title}</span>
                  {book.lockChapter && c.number >= book.lockChapter && !ownsAll && !isAuthor && <span className="text-xs text-stone-500" aria-label="Paid chapter">🔒</span>}
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="font-semibold">Reviews</h2>
          {canReview && (
            <Card title={myReview ? "Your review" : "Write a review"}>
              <ActionForm action={reviewAction} submitLabel={myReview ? "Update review" : "Post review"}>
                <input type="hidden" name="bookId" value={book.id} /><input type="hidden" name="code" value={book.code} />
                <fieldset className="flex gap-3 text-sm"><legend className="mb-1 font-medium">Rating</legend>
                  {[1, 2, 3, 4, 5].map((n) => <label key={n} className="flex items-center gap-1"><input type="radio" name="rating" value={n} required defaultChecked={myReview?.rating === n} /> {n}★</label>)}
                </fieldset>
                <Field label="Review (optional)"><textarea name="body" rows={3} maxLength={5000} defaultValue={myReview?.body} className={inputCls} /></Field>
              </ActionForm>
            </Card>
          )}
          {user && !progress && !isAuthor && <p className="text-sm text-stone-500">Start reading to leave a review.</p>}
          {reviews.length === 0 ? <p className="text-sm text-stone-500">No reviews yet.</p> : (
            <ul className="space-y-4">{reviews.map((r) => (
              <li key={r.id} className="border-b border-stone-200 pb-3 dark:border-stone-800">
                <p className="text-sm"><Stars value={r.rating} /> <b>{r.user.displayName}</b> <span className="text-stone-500">· {r.createdAt.toLocaleDateString()}</span></p>
                {r.body && <p className="mt-1 whitespace-pre-line">{r.body}</p>}
                {user && (user.id === r.userId || user.role === "ADMIN" || user.id === book.editor?.userId) && (
                  <form action={deleteReviewAction}><input type="hidden" name="reviewId" value={r.id} /><input type="hidden" name="code" value={book.code} /><button className="text-xs text-stone-500 underline">Delete</button></form>
                )}
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}

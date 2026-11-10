import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { mediaAccess } from "@/lib/reading";
import { checkAge } from "@/lib/age";
import { formatCents } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { Card, Notice } from "./ui";
import { buyMediaAction } from "@/app/actions";

/** Shared page for the audiobook ("Listen") and video ("Watch") editions of a book. */
export async function MediaPage({ code, kind }: { code: string; kind: "AUDIO" | "VIDEO" }) {
  const user = await currentUser();
  const book = await db.book.findUnique({
    where: { code },
    select: { id: true, code: true, title: true, status: true, ageRating: true, audioPriceCents: true, videoPriceCents: true, videoDiscountPercentForOwners: true, media: { where: { kind }, orderBy: { number: "asc" }, select: { id: true, number: true, title: true } } },
  });
  const base = kind === "AUDIO" ? book?.audioPriceCents : book?.videoPriceCents;
  if (!book || book.status !== "ON_SALE" || book.media.length === 0 || base == null) notFound();

  const allowed = await mediaAccess(user, book.id, kind);
  const ownsText = user ? !!(await db.purchase.findFirst({ where: { userId: user.id, bookId: book.id, format: "TEXT", sectionId: null } })) : false;
  const price = kind === "VIDEO" && ownsText && book.videoDiscountPercentForOwners > 0 ? Math.round((base * (100 - book.videoDiscountPercentForOwners)) / 100) : base;
  const age = checkAge(book.ageRating, user);
  const label = kind === "AUDIO" ? "Audiobook" : "Video";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/books/${book.code}`} className="text-sm underline">← {book.title}</Link>
      <h1 className="text-2xl font-bold">{label}: {book.title}</h1>
      {!allowed && (
        <Card title={`Unlock the ${label.toLowerCase()}`}>
          <p className="mb-3 text-sm">{book.media.length} {kind === "AUDIO" ? "tracks" : "episodes"}{kind === "AUDIO" ? ", professionally narrated." : ", with dubbing and subtitles where available."}</p>
          {kind === "VIDEO" && book.videoDiscountPercentForOwners > 0 && (
            <p className="mb-3 text-sm text-green-700">{ownsText ? `Your ${book.videoDiscountPercentForOwners}% book-owner discount is applied.` : `Own the whole book? You get ${book.videoDiscountPercentForOwners}% off.`}</p>
          )}
          {!user ? <p className="text-sm"><Link href={`/login?next=/books/${book.code}/${kind === "AUDIO" ? "listen" : "watch"}`} className="underline">Log in</Link> to buy.</p>
            : !age.ok ? <Notice tone="warn">This book is for readers aged {age.minAge}+.</Notice>
            : (
              <ActionForm action={buyMediaAction} submitLabel={`Buy ${label.toLowerCase()}: ${formatCents(price)}`}>
                <input type="hidden" name="bookId" value={book.id} /><input type="hidden" name="kind" value={kind} />
              </ActionForm>
            )}
        </Card>
      )}
      <ol className="space-y-4">
        {book.media.map((m) => (
          <li key={m.id} className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
            <p className="mb-2 font-medium">{m.number}. {m.title}</p>
            {allowed ? (
              kind === "AUDIO" ? <audio controls preload="none" src={`/api/media/${m.id}`} className="w-full" /> : <video controls preload="none" src={`/api/media/${m.id}`} className="w-full rounded" />
            ) : <p className="text-sm text-stone-500">🔒 Locked</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

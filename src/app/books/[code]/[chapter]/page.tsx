import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { canReadChapter } from "@/lib/access";
import { can } from "@/lib/rbac";
import { ReadAloud } from "@/components/ReadAloud";
import { postComment } from "@/app/actions";

export default async function ChapterPage({ params }: { params: Promise<{ code: string; chapter: string }> }) {
  const { code, chapter } = await params;
  const number = Number(chapter);
  if (!Number.isInteger(number)) notFound();
  const user = await currentUser();

  const book = await db.book.findUnique({
    where: { code },
    include: { penName: { include: { author: true } }, editor: true, _count: { select: { chapters: true } } },
  });
  if (!book || book.status !== "ON_SALE") notFound();
  const ch = await db.chapter.findUnique({
    where: { bookId_number: { bookId: book.id, number } },
    include: { comments: { where: { parentId: null }, orderBy: { createdAt: "asc" }, include: { user: true, replies: { include: { user: true } } } } },
  });
  if (!ch) notFound();

  const purchases = user ? await db.purchase.findMany({ where: { userId: user.id, bookId: book.id, format: "TEXT" }, include: { section: true } }) : [];
  const access = canReadChapter({
    chapterNumber: number,
    lockChapter: book.lockChapter,
    viewer: user,
    authorUserId: book.penName?.author.userId ?? null,
    editorUserId: book.editor?.userId ?? null,
    ownsWholeBook: purchases.some((p) => p.sectionId === null),
    ownedSections: purchases.flatMap((p) => (p.section ? [p.section] : [])),
  });

  if (access.allowed && user) {
    await db.readingProgress.upsert({
      where: { userId_bookId: { userId: user.id, bookId: book.id } },
      update: { lastChapter: number },
      create: { userId: user.id, bookId: book.id, lastChapter: number },
    });
    await db.chapter.update({ where: { id: ch.id }, data: { views: { increment: 1 } } });
  }

  const penName = book.penName?.name;
  const label = (c: { asPenNameId: string | null; user: { displayName: string } }) =>
    c.asPenNameId ? <><b>{penName}</b> <span className="ml-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-black">Author</span></> : <b>{c.user.displayName}</b>;

  return (
    <article className="mx-auto max-w-2xl">
      <Link href={`/books/${book.code}`} className="text-sm text-stone-500 underline">{book.title}</Link>
      <h1 className="mt-2 text-2xl font-bold">{ch.number}. {ch.title}</h1>

      {access.allowed ? (
        <>
          <div className="my-4"><ReadAloud text={ch.content} lang={book.language} /></div>
          <div className="whitespace-pre-line text-lg leading-relaxed">{ch.content}</div>
        </>
      ) : (
        <div className="my-10 rounded-md border border-stone-300 p-6 text-center dark:border-stone-700">
          <p className="font-semibold">This chapter is locked.</p>
          <Link href={access.reason === "LOGIN_REQUIRED" ? "/login" : `/books/${book.code}`} className="mt-3 inline-block underline">
            {access.reason === "LOGIN_REQUIRED" ? "Log in to continue" : "Buy this book or section to continue"}
          </Link>
        </div>
      )}

      <nav className="my-8 flex justify-between">
        {number > 1 ? <Link href={`/books/${code}/${number - 1}`}>← Previous</Link> : <span />}
        {number < book._count.chapters ? <Link href={`/books/${code}/${number + 1}`}>Next →</Link> : <span />}
      </nav>

      {access.allowed && (
        <section className="border-t border-stone-200 pt-6 dark:border-stone-800">
          <h2 className="mb-4 font-semibold">Comments</h2>
          <ul className="space-y-4">
            {ch.comments.map((c) => (
              <li key={c.id}>
                <p className="text-sm">{label(c)}</p>
                <p>{c.body}</p>
                <ul className="ml-6 mt-2 space-y-2">
                  {c.replies.map((r) => <li key={r.id}><p className="text-sm">{label(r)}</p><p>{r.body}</p></li>)}
                </ul>
              </li>
            ))}
          </ul>
          {can(user, "engage:comment") && (
            <form action={postComment} className="mt-6 flex flex-col gap-2">
              <input type="hidden" name="chapterId" value={ch.id} />
              <textarea name="body" required rows={3} className="rounded-md border border-stone-300 bg-transparent p-2 dark:border-stone-700" placeholder="Write a comment…" />
              <button className="self-start rounded-md bg-stone-900 px-4 py-2 text-white dark:bg-stone-100 dark:text-stone-900">Post</button>
            </form>
          )}
        </section>
      )}
    </article>
  );
}

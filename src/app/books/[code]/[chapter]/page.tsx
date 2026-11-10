import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { chapterAccess, recordRead } from "@/lib/reading";
import { can } from "@/lib/rbac";
import { ReadAloud } from "@/components/ReadAloud";
import { ReportButton } from "@/components/ReportButton";
import { ActionForm } from "@/components/ActionForm";
import { inputCls } from "@/components/ui";
import { deleteCommentAction, postCommentAction } from "@/app/actions";

type Params = { params: Promise<{ code: string; chapter: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code, chapter } = await params;
  const book = await db.book.findUnique({ where: { code }, select: { title: true, status: true } });
  return { title: book?.status === "ON_SALE" ? `${book.title}, chapter ${chapter}` : "Not found", robots: { index: false } };
}

export default async function ChapterPage({ params }: Params) {
  const { code, chapter } = await params;
  const number = Number(chapter);
  if (!Number.isInteger(number) || number < 1) notFound();
  const user = await currentUser();

  const book = await db.book.findUnique({
    where: { code },
    select: { id: true, code: true, title: true, status: true, language: true, penName: { select: { name: true } }, editor: { select: { userId: true } }, _count: { select: { chapters: true } } },
  });
  if (!book || book.status !== "ON_SALE") notFound();
  const ch = await db.chapter.findUnique({ where: { bookId_number: { bookId: book.id, number } }, select: { id: true, number: true, title: true, content: true } });
  if (!ch) notFound();

  const access = await chapterAccess(user, book.id, number);
  if (access.allowed && user) await recordRead(user.id, book.id, ch.id, number);

  const comments = access.allowed
    ? await db.comment.findMany({
        where: { chapterId: ch.id, parentId: null },
        orderBy: { createdAt: "asc" },
        take: 200,
        include: { user: { select: { displayName: true } }, replies: { orderBy: { createdAt: "asc" }, include: { user: { select: { displayName: true } } } } },
      })
    : [];
  const path = `/books/${book.code}/${number}`;
  const canComment = !!user && can(user, "engage:comment");
  const canModerate = (userId: string) => !!user && (user.id === userId || user.role === "ADMIN" || user.id === book.editor?.userId);

  type C = { id: string; userId: string; body: string; asPenNameId: string | null; createdAt: Date; user: { displayName: string } };
  const CommentBody = ({ c, reply }: { c: C; reply?: boolean }) => (
    <div>
      <p className="text-sm">
        {c.asPenNameId ? <><b>{book.penName?.name}</b> <span className="ml-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-black">Author</span></> : <b>{c.user.displayName}</b>}
        <span className="ml-2 text-xs text-stone-500">{c.createdAt.toLocaleDateString()}</span>
      </p>
      <p className="whitespace-pre-line">{c.body}</p>
      <div className="mt-1 flex flex-wrap items-start gap-4">
        {canComment && !reply && (
          <details className="text-xs text-stone-500">
            <summary className="cursor-pointer select-none">Reply</summary>
            <ActionForm action={postCommentAction} submitLabel="Reply" className="mt-2 flex max-w-md flex-col gap-2">
              <input type="hidden" name="chapterId" value={ch.id} /><input type="hidden" name="parentId" value={c.id} /><input type="hidden" name="path" value={path} />
              <textarea name="body" required rows={2} maxLength={4000} className={`${inputCls} text-sm`} />
            </ActionForm>
          </details>
        )}
        {user && user.id !== c.userId && <ReportButton targetId={c.userId} commentId={c.id} />}
        {canModerate(c.userId) && c.body !== "[deleted]" && (
          <form action={deleteCommentAction}><input type="hidden" name="commentId" value={c.id} /><input type="hidden" name="path" value={path} /><button className="text-xs text-stone-500 underline">Delete</button></form>
        )}
      </div>
    </div>
  );

  return (
    <article className="mx-auto max-w-2xl">
      <Link href={`/books/${book.code}`} className="text-sm text-stone-500 underline">{book.title}</Link>
      <h1 className="mt-2 text-2xl font-bold">{ch.number}. {ch.title}</h1>

      {access.allowed ? (
        <>
          <div className="my-4"><ReadAloud text={ch.content} lang={book.language} /></div>
          <div className="whitespace-pre-line font-serif text-lg leading-relaxed">{ch.content}</div>
        </>
      ) : (
        <div className="my-10 rounded-md border border-stone-300 p-6 text-center dark:border-stone-700">
          {access.reason === "LOGIN_REQUIRED" && <><p className="font-semibold">This chapter is for members.</p><Link href={`/login?next=${path}`} className="mt-3 inline-block underline">Log in to continue</Link></>}
          {access.reason === "PURCHASE_REQUIRED" && <><p className="font-semibold">This chapter is locked.</p><Link href={`/books/${book.code}`} className="mt-3 inline-block underline">Buy the book or this section to continue</Link></>}
          {access.reason === "AGE_LOGIN" && <><p className="font-semibold">This book is for readers aged {access.minAge}+.</p><Link href={`/login?next=${path}`} className="mt-3 inline-block underline">Log in to continue</Link></>}
          {access.reason === "DOB_REQUIRED" && <><p className="font-semibold">This book is for readers aged {access.minAge}+.</p><Link href="/settings" className="mt-3 inline-block underline">Add your date of birth in Settings</Link></>}
          {access.reason === "TOO_YOUNG" && <p className="font-semibold">This book is for readers aged {access.minAge}+.</p>}
        </div>
      )}

      <nav className="my-8 flex justify-between">
        {number > 1 ? <Link href={`/books/${code}/${number - 1}`}>← Previous</Link> : <span />}
        {number < book._count.chapters ? <Link href={`/books/${code}/${number + 1}`}>Next →</Link> : <span />}
      </nav>

      {access.allowed && (
        <section className="border-t border-stone-200 pt-6 dark:border-stone-800">
          <h2 className="mb-4 font-semibold">Comments ({comments.reduce((a, c) => a + 1 + c.replies.length, 0)})</h2>
          <ul className="space-y-5">
            {comments.map((c) => (
              <li key={c.id}>
                <CommentBody c={c} />
                {c.replies.length > 0 && <ul className="ml-6 mt-3 space-y-3 border-l border-stone-200 pl-4 dark:border-stone-800">{c.replies.map((r) => <li key={r.id}><CommentBody c={r} reply /></li>)}</ul>}
              </li>
            ))}
          </ul>
          {canComment ? (
            <ActionForm action={postCommentAction} submitLabel="Post" className="mt-6 flex flex-col gap-2">
              <input type="hidden" name="chapterId" value={ch.id} /><input type="hidden" name="path" value={path} />
              <textarea name="body" required rows={3} maxLength={4000} placeholder="Write a comment…" className={inputCls} />
            </ActionForm>
          ) : user ? <p className="mt-6 text-sm text-stone-500">Your account can&apos;t comment right now.</p>
            : <p className="mt-6 text-sm"><Link href={`/login?next=${path}`} className="underline">Log in</Link> to comment.</p>}
        </section>
      )}
    </article>
  );
}

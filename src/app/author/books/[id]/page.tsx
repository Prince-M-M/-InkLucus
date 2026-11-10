import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAuthor } from "@/lib/guards";
import { ActionForm } from "@/components/ActionForm";
import { ManuscriptView } from "@/components/ManuscriptView";
import { Card, Field, Notice, StatusBadge, inputCls } from "@/components/ui";
import { addChapterAction } from "@/app/author/actions";

export default async function AuthorBook({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const [{ id }, { submitted }] = await Promise.all([params, searchParams]);
  const { user, author } = await requireAuthor();
  const book = await db.book.findUnique({
    where: { id },
    include: { penName: true, editor: { include: { user: true } }, reviewingEditor: { include: { user: true } }, chapters: { orderBy: { number: "asc" } } },
  });
  if (!book || (book.submitterId !== user.id && book.penName?.authorId !== author.id)) notFound();
  const editor = book.editor ?? book.reviewingEditor;

  return (
    <div className="space-y-6">
      <Link href="/author" className="text-sm underline">← Author dashboard</Link>
      {submitted && <Notice tone="success">Submitted! {editor ? `${editor.user.displayName} will review it.` : "It's waiting in the editors' pool."}</Notice>}
      <header>
        <h1 className="text-2xl font-bold">{book.title}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
          <StatusBadge status={book.status} /> {book.penName && <>as {book.penName.name}</>}
          {book.status === "ON_SALE" && <Link href={`/books/${book.code}`} className="underline">View public page</Link>}
        </p>
      </header>
      {book.decisionMessage && <Notice tone={book.status === "REJECTED" ? "warn" : "info"}><b>Message from your editor:</b> {book.decisionMessage}</Notice>}
      {editor && <p className="text-sm">Editor: {editor.user.displayName} · <a className="underline" href={`mailto:${editor.contactEmail}`}>{editor.contactEmail}</a></p>}

      <Card title={`Chapters (${book.chapters.length})`}><ManuscriptView chapters={book.chapters} /></Card>

      {book.status !== "REJECTED" && (
        <Card title="Post a new chapter">
          <ActionForm action={addChapterAction} submitLabel="Post chapter">
            <input type="hidden" name="bookId" value={book.id} />
            <Field label="Chapter title"><input name="title" placeholder={`Chapter ${book.chapters.length + 1}`} className={inputCls} /></Field>
            <Field label="Text"><textarea name="content" required rows={12} className={inputCls} /></Field>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/guards";
import { GENRES, LANGUAGES } from "@/lib/catalog";
import { formatCents } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { ManuscriptView } from "@/components/ManuscriptView";
import { Card, Field, Notice, StatusBadge, btnCls, inputCls } from "@/components/ui";
import { addMediaAction, addPenNameAction, claimAction, decideAction, linkEditionAction, mediaPricingAction, publishAction, removeMediaAction, returnToPoolAction, unlinkEditionAction, unlistAction, uploadCoverAction } from "@/app/editor/actions";
import { Cover } from "@/components/Cover";

const AGE: Record<string, string> = { ALL: "All ages", TEEN_13: "13+", MATURE_16: "16+", ADULT_18: "18+" };

export default async function EditorBook({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, editor } = await requireEditor();
  const book = await db.book.findUnique({
    where: { id },
    include: {
      submitter: { include: { authorProfile: { include: { penNames: true } } } },
      penName: true,
      reviewingEditor: { include: { user: true } },
      editor: { include: { user: true } },
      media: { orderBy: [{ kind: "asc" }, { number: "asc" }] },
      chapters: { orderBy: { number: "asc" } },
      sections: { orderBy: { index: "asc" } },
      contracts: true,
    },
  });
  if (!book) notFound();
  const isReviewer = book.status === "UNDER_REVIEW" && book.reviewingEditorId === editor.id;
  const isEditor = book.editorId === editor.id;
  const visible = user.role === "ADMIN" || book.status === "IN_POOL" || isReviewer || isEditor;
  if (!visible) notFound();

  const author = book.submitter.authorProfile;
  const editions = book.editionGroup ? await db.book.findMany({ where: { editionGroup: book.editionGroup, id: { not: book.id } }, select: { code: true, title: true, language: true } }) : [];
  const canSetup = (isEditor || user.role === "ADMIN") && ["ACCEPTED", "ON_SALE", "UNLISTED"].includes(book.status);
  const contract = book.contracts[0];
  const defaultSigned = (contract?.signedAt ?? new Date()).toISOString().slice(0, 10);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <Link href="/editor" className="text-sm underline">← Editor dashboard</Link>
        <header>
          <h1 className="text-2xl font-bold">{book.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
            <StatusBadge status={book.status} />
            {LANGUAGES[book.language] ?? book.language} · {book.genres.join(", ")} · {AGE[book.ageRating]} · code {book.code}
          </p>
          <p className="mt-1 text-sm text-stone-500">
            Submitted by {book.submitter.displayName} ({book.submitter.email}){author && <> · author {author.internalCode}</>}
            {book.referralCode && <> · referral {book.referralCode}</>}
          </p>
        </header>
        <Card title="Synopsis"><p className="whitespace-pre-line text-sm">{book.synopsis}</p></Card>
        {book.submissionNote && <Notice><b>Note from the submitter:</b> {book.submissionNote}</Notice>}
        {book.decisionMessage && <Notice><b>Your message to the submitter:</b> {book.decisionMessage}</Notice>}
        <Card title={`Manuscript (${book.chapters.length} chapters)`}><ManuscriptView chapters={book.chapters} /></Card>
      </div>

      <aside className="space-y-6">
        {book.status === "IN_POOL" && (
          <Card title="In the pool">
            <p className="mb-3 text-sm">Claim this book to review it. Other editors will no longer see it.</p>
            <form action={claimAction}><input type="hidden" name="bookId" value={book.id} /><button className={btnCls}>Start reviewing</button></form>
          </Card>
        )}

        {isEditor && book.status === "ACCEPTED" && (
          <Notice tone="success">Accepted. {author?.penNames.length ? "Next: set prices and publish once the contract is signed." : "Next: create a pen name, then publish once the contract is signed."}</Notice>
        )}
        {book.status === "REJECTED" && <Notice tone="warn">Not accepted. The submitter has been sent your message.</Notice>}
        {isEditor && book.status === "ON_SALE" && <Notice tone="success">Published and on sale.</Notice>}

        {book.status === "UNDER_REVIEW" && !isReviewer && <Notice>Being reviewed by {book.reviewingEditor?.user.displayName}.</Notice>}

        {isReviewer && (
          <>
            <Card title="Decision">
              <ActionForm action={decideAction} submitLabel="Send decision">
                <input type="hidden" name="bookId" value={book.id} />
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1"><input type="radio" name="decision" value="accept" required /> Accept</label>
                  <label className="flex items-center gap-1"><input type="radio" name="decision" value="reject" /> Reject</label>
                </div>
                <Field label="Message to the submitter" hint="Shown on their account. On accept, a reader account becomes an author account."><textarea name="message" required rows={4} className={inputCls} /></Field>
              </ActionForm>
            </Card>
            <Card title="Not my genre?">
              <ActionForm action={returnToPoolAction} submitLabel="Return to pool">
                <input type="hidden" name="bookId" value={book.id} />
                <fieldset className="text-sm">
                  <legend className="mb-1 text-xs text-stone-500">Retag genres so the right editors find it (optional)</legend>
                  <div className="flex flex-wrap gap-2">{GENRES.map((g) => <label key={g} className="flex items-center gap-1"><input type="checkbox" name="genres" value={g} defaultChecked={book.genres.includes(g)} /> {g}</label>)}</div>
                </fieldset>
              </ActionForm>
            </Card>
          </>
        )}

        {isEditor && (book.status === "ACCEPTED" || book.status === "UNLISTED") && author && (
          <>
            <Card title={`Author's pen names (${author.penNames.length}/5)`}>
              {author.penNames.length === 0 ? <p className="mb-3 text-sm text-stone-500">Create a pen name before publishing.</p> : (
                <ul className="mb-3 list-disc pl-5 text-sm">{author.penNames.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
              )}
              {author.penNames.length < 5 && (
                <ActionForm action={addPenNameAction} submitLabel="Add pen name">
                  <input type="hidden" name="authorId" value={author.id} />
                  <Field label="New pen name"><input name="name" required className={inputCls} /></Field>
                </ActionForm>
              )}
            </Card>
            <Card title={book.status === "UNLISTED" ? "Relist" : "Put on sale"}>
              <ActionForm action={publishAction} submitLabel="Publish">
                <input type="hidden" name="bookId" value={book.id} />
                <Field label="Pen name">
                  <select name="penNameId" required defaultValue={book.penNameId ?? ""} className={inputCls}>
                    <option value="" disabled>Choose…</option>
                    {author.penNames.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Lock chapter" hint="First paid chapter"><input name="lockChapter" type="number" min={1} required defaultValue={book.lockChapter ?? 6} className={inputCls} /></Field>
                  <Field label="Whole book ($)"><input name="wholePrice" inputMode="decimal" required defaultValue={book.wholeBookPriceCents != null ? (book.wholeBookPriceCents / 100).toFixed(2) : ""} placeholder="9.99" className={inputCls} /></Field>
                  <Field label="Chapters / section" hint="For long books"><input name="chaptersPerSection" type="number" min={1} placeholder="50" className={inputCls} /></Field>
                  <Field label="Section price ($)"><input name="sectionPrice" inputMode="decimal" placeholder="4.49" className={inputCls} /></Field>
                  <Field label="Author royalty (%)"><input name="royaltyPercent" type="number" min={0} max={100} required defaultValue={contract?.royaltyPercent ?? ""} className={inputCls} /></Field>
                  <Field label="Contract signed"><input name="signedAt" type="date" required defaultValue={defaultSigned} className={inputCls} /></Field>
                </div>
                <Field label="ISBN (internal, optional)"><input name="isbn" defaultValue={book.isbn ?? ""} className={inputCls} /></Field>
                <Field label="Editor's review (shown on the book page)"><textarea name="editorReview" rows={3} defaultValue={book.editorReview ?? ""} className={inputCls} /></Field>
              </ActionForm>
            </Card>
          </>
        )}

        {isEditor && book.status === "ON_SALE" && (
          <Card title="On sale">
            <ul className="mb-3 space-y-1 text-sm">
              <li>Free up to chapter {(book.lockChapter ?? 1) - 1}</li>
              {book.wholeBookPriceCents != null && <li>Whole book {formatCents(book.wholeBookPriceCents)}</li>}
              {book.sections.map((s) => <li key={s.id}>Ch. {s.firstChapter}–{s.lastChapter}: {formatCents(s.priceCents)}</li>)}
            </ul>
            <Link href={`/books/${book.code}`} className="mb-3 block text-sm underline">View public page</Link>
            <ActionForm action={unlistAction} submitLabel="Unlist book"><input type="hidden" name="bookId" value={book.id} /></ActionForm>
          </Card>
        )}
        {canSetup && (
          <>
            <Card title="Cover">
              <div className="mb-3 w-28"><Cover url={book.coverUrl} title={book.title} /></div>
              <ActionForm action={uploadCoverAction} submitLabel="Upload cover">
                <input type="hidden" name="bookId" value={book.id} />
                <input type="file" name="cover" accept="image/jpeg,image/png,image/webp" required className="text-sm" />
                <p className="text-xs text-stone-500">JPEG, PNG or WebP, up to 2 MB. Portrait 2:3 works best.</p>
              </ActionForm>
            </Card>
            <Card title="Language editions">
              {editions.length > 0 && <ul className="mb-3 text-sm">{editions.map((e) => <li key={e.code}>{LANGUAGES[e.language] ?? e.language}: {e.title} <span className="font-mono text-xs text-stone-500">{e.code}</span></li>)}</ul>}
              <ActionForm action={linkEditionAction} submitLabel="Link edition">
                <input type="hidden" name="bookId" value={book.id} />
                <Field label="Book code of the same story in another language"><input name="otherCode" required placeholder="BK…" className={`${inputCls} uppercase`} /></Field>
              </ActionForm>
              {book.editionGroup && <form action={unlinkEditionAction} className="mt-2"><input type="hidden" name="bookId" value={book.id} /><button className="text-xs underline">Unlink this book</button></form>}
            </Card>
            <Card title="Audiobook & video">
              <ActionForm action={mediaPricingAction} submitLabel="Save prices">
                <input type="hidden" name="bookId" value={book.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Audiobook ($)"><input name="audioPrice" inputMode="decimal" defaultValue={book.audioPriceCents != null ? (book.audioPriceCents / 100).toFixed(2) : ""} className={inputCls} /></Field>
                  <Field label="Video ($)"><input name="videoPrice" inputMode="decimal" defaultValue={book.videoPriceCents != null ? (book.videoPriceCents / 100).toFixed(2) : ""} className={inputCls} /></Field>
                </div>
                <Field label="Video discount for book owners (%)"><input name="discount" type="number" min={0} max={100} defaultValue={book.videoDiscountPercentForOwners} className={inputCls} /></Field>
              </ActionForm>
              <ul className="my-4 space-y-1 text-sm">
                {book.media.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span>{m.kind === "AUDIO" ? "🎧" : "▶"} {m.number}. {m.title}</span>
                    <form action={removeMediaAction}><input type="hidden" name="mediaId" value={m.id} /><input type="hidden" name="bookId" value={book.id} /><button className="text-xs underline">Remove</button></form>
                  </li>
                ))}
                {book.media.length === 0 && <li className="text-stone-500">No tracks yet. The Listen/Watch buttons appear once a track and a price are set.</li>}
              </ul>
              <ActionForm action={addMediaAction} submitLabel="Add track">
                <input type="hidden" name="bookId" value={book.id} />
                <Field label="Type"><select name="kind" className={inputCls}><option value="AUDIO">Audio</option><option value="VIDEO">Video</option></select></Field>
                <Field label="Title"><input name="title" required className={inputCls} /></Field>
                <Field label="File link (https)" hint="Host files on private storage (e.g. Cloudflare R2, S3). Readers only get the link after access is checked."><input name="url" type="url" required className={inputCls} /></Field>
              </ActionForm>
            </Card>
          </>
        )}
      </aside>
    </div>
  );
}

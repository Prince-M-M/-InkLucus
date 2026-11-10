import Link from "next/link";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/guards";
import { listPool } from "@/lib/submissions";
import { GENRES, LANGUAGES } from "@/lib/catalog";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, Notice, StatusBadge, btnOutlineCls, inputCls } from "@/components/ui";
import { addPenNameAction, claimAction, promoteReaderAction } from "./actions";

const TABS = [
  ["pool", "Submission pool"],
  ["reviewing", "Reviewing"],
  ["books", "My books"],
  ["authors", "My authors"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function EditorDashboard({ searchParams }: { searchParams: Promise<{ tab?: string; genre?: string; language?: string; error?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "pool") as Tab;
  const { user, editor } = await requireEditor();

  const [poolCount, reviewingCount] = await Promise.all([
    db.book.count({ where: { status: "IN_POOL" } }),
    db.book.count({ where: { status: "UNDER_REVIEW", reviewingEditorId: editor.id } }),
  ]);
  const counts: Partial<Record<Tab, number>> = { pool: poolCount, reviewing: reviewingCount };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Editor dashboard</h1>
        <p className="text-sm text-stone-500">{user.displayName}{editor.genres.length > 0 && <> · {editor.genres.join(", ")}</>}</p>
      </header>
      {sp.error === "claimed" && <Notice tone="warn">Another editor claimed that book first.</Notice>}
      <nav className="flex flex-wrap gap-1 border-b border-stone-200 dark:border-stone-800">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/editor?tab=${k}`} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-stone-900 font-semibold dark:border-stone-100" : "border-transparent text-stone-500"}`}>
            {label}{counts[k] ? ` (${counts[k]})` : ""}
          </Link>
        ))}
      </nav>
      {tab === "pool" && <Pool genre={sp.genre} language={sp.language} />}
      {tab === "reviewing" && <Reviewing editorId={editor.id} />}
      {tab === "books" && <MyBooks editorId={editor.id} />}
      {tab === "authors" && <MyAuthors editorId={editor.id} isAdmin={user.role === "ADMIN"} />}
    </div>
  );
}

async function Pool({ genre, language }: { genre?: string; language?: string }) {
  const books = await listPool({ genre, language });
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2">
        <input type="hidden" name="tab" value="pool" />
        <select name="genre" defaultValue={genre ?? ""} className="rounded-md border border-stone-300 bg-transparent px-2 py-1.5 text-sm dark:border-stone-700">
          <option value="">All genres</option>{GENRES.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select name="language" defaultValue={language ?? ""} className="rounded-md border border-stone-300 bg-transparent px-2 py-1.5 text-sm dark:border-stone-700">
          <option value="">All languages</option>{Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className={`${btnOutlineCls} py-1.5 text-sm`}>Filter</button>
      </form>
      {books.length === 0 ? <p className="text-sm text-stone-500">The pool is empty.</p> : (
        <ul className="space-y-3">
          {books.map((b) => (
            <li key={b.id} className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/editor/books/${b.id}`} className="font-semibold underline">{b.title}</Link>
                  <p className="text-xs text-stone-500">{LANGUAGES[b.language] ?? b.language} · {b.genres.join(", ")} · {b._count.chapters} chapters · by {b.submitter.displayName} · {b.createdAt.toDateString()}</p>
                  <p className="mt-2 line-clamp-2 text-sm">{b.synopsis}</p>
                </div>
                <form action={claimAction}><input type="hidden" name="bookId" value={b.id} /><button className={btnOutlineCls}>Start reviewing</button></form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function Reviewing({ editorId }: { editorId: string }) {
  const books = await db.book.findMany({ where: { status: "UNDER_REVIEW", reviewingEditorId: editorId }, orderBy: { updatedAt: "asc" }, include: { submitter: true } });
  return books.length === 0 ? <p className="text-sm text-stone-500">Nothing under review. Claim a book from the pool.</p> : (
    <ul className="divide-y divide-stone-200 dark:divide-stone-800">
      {books.map((b) => (
        <li key={b.id} className="flex justify-between py-3"><Link href={`/editor/books/${b.id}`} className="underline">{b.title}</Link><span className="text-sm text-stone-500">{b.submitter.displayName} · {b.submitter.role === "AUTHOR" ? "existing author" : "new submitter"}</span></li>
      ))}
    </ul>
  );
}

async function MyBooks({ editorId }: { editorId: string }) {
  const books = await db.book.findMany({
    where: { editorId, status: { in: ["ACCEPTED", "ON_SALE", "UNLISTED"] } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: { penName: true, _count: { select: { chapters: true, purchases: true, wishlist: true, likes: true } } },
  });
  return books.length === 0 ? <p className="text-sm text-stone-500">No books yet.</p> : (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-stone-500"><tr><th className="py-2">Title</th><th>Status</th><th>Pen name</th><th>Chapters</th><th>Sales</th><th>Likes</th><th>Wishlists</th></tr></thead>
        <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
          {books.map((b) => (
            <tr key={b.id}>
              <td className="py-2"><Link href={`/editor/books/${b.id}`} className="underline">{b.title}</Link></td>
              <td><StatusBadge status={b.status} /></td><td>{b.penName?.name ?? "—"}</td>
              <td>{b._count.chapters}</td><td>{b._count.purchases}</td><td>{b._count.likes}</td><td>{b._count.wishlist}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function MyAuthors({ editorId, isAdmin }: { editorId: string; isAdmin: boolean }) {
  const [authors, editors] = await Promise.all([
    db.authorProfile.findMany({ where: isAdmin ? {} : { editorId }, include: { user: true, penNames: { include: { editor: { include: { user: true } } } } }, orderBy: { createdAt: "desc" } }),
    db.editorProfile.findMany({ include: { user: true } }),
  ]);
  return (
    <div className="space-y-6">
      <Card title="Sign a new author">
        <p className="mb-3 text-sm text-stone-500">Converts an existing reader account into an author account assigned to you.</p>
        <ActionForm action={promoteReaderAction} submitLabel="Make author" className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <Field label="Reader's email"><input name="email" type="email" required className={inputCls} /></Field>
          <Field label="Referral code"><input name="referralCode" placeholder="AA1234" maxLength={6} className={`${inputCls} uppercase`} /></Field>
        </ActionForm>
      </Card>
      {authors.length === 0 ? <p className="text-sm text-stone-500">No authors assigned to you yet.</p> : authors.map((a) => (
        <Card key={a.id} title={<>{a.user.displayName} <span className="font-mono text-xs font-normal text-stone-500">{a.internalCode}</span></>}>
          <p className="mb-2 text-sm text-stone-500">{a.user.email}</p>
          <ul className="mb-3 space-y-1 text-sm">
            {a.penNames.map((p) => <li key={p.id}><Link href={`/pen/${p.slug}`} className="underline">{p.name}</Link> <span className="text-stone-500">· editor: {p.editor?.user.displayName ?? "—"}</span></li>)}
            {a.penNames.length === 0 && <li className="text-stone-500">No pen names yet.</li>}
          </ul>
          {a.penNames.length < 5 && (
            <ActionForm action={addPenNameAction} submitLabel="Add pen name" className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
              <input type="hidden" name="authorId" value={a.id} />
              <Field label="New pen name"><input name="name" required className={inputCls} /></Field>
              <Field label="Managed by">
                <select name="editorId" defaultValue={editorId} className={inputCls}>{editors.map((e) => <option key={e.id} value={e.id}>{e.user.displayName}</option>)}</select>
              </Field>
            </ActionForm>
          )}
        </Card>
      ))}
    </div>
  );
}

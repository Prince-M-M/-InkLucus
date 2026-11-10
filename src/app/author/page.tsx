import Link from "next/link";
import { db } from "@/lib/db";
import { requireAuthor } from "@/lib/guards";
import { Card, StatusBadge, btnCls } from "@/components/ui";

export default async function AuthorDashboard() {
  const { user, author } = await requireAuthor();
  const [profile, books, socials] = await Promise.all([
    db.authorProfile.findUniqueOrThrow({
      where: { id: author.id },
      include: { editor: { include: { user: true } }, penNames: { include: { editor: { include: { user: true } } } } },
    }),
    db.book.findMany({
      where: { OR: [{ submitterId: user.id }, { penName: { authorId: author.id } }] },
      orderBy: { createdAt: "desc" },
      include: { penName: true, editor: { include: { user: true } }, _count: { select: { chapters: true, wishlist: true, likes: true, purchases: true } } },
    }),
    db.socialLink.findMany({ where: { audience: "AUTHOR" } }),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Author dashboard</h1>
          <p className="text-sm text-stone-500">Author ID {profile.internalCode}</p>
        </div>
        <Link href="/author/submit" className={btnCls}>Submit new book</Link>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Your editor">
          {profile.editor ? (
            <p className="text-sm">{profile.editor.user.displayName}<br /><a className="underline" href={`mailto:${profile.editor.contactEmail}`}>{profile.editor.contactEmail}</a>{profile.editor.contactPhone && <> · {profile.editor.contactPhone}</>}</p>
          ) : <p className="text-sm text-stone-500">No editor assigned yet.</p>}
        </Card>
        <Card title={`Pen names (${profile.penNames.length}/5)`}>
          {profile.penNames.length === 0 ? <p className="text-sm text-stone-500">Your editor sets up pen names with you.</p> : (
            <ul className="space-y-1 text-sm">{profile.penNames.map((p) => (
              <li key={p.id}><Link href={`/pen/${p.slug}`} className="underline">{p.name}</Link>{p.editor && <span className="text-stone-500"> · editor {p.editor.user.displayName} ({p.editor.contactEmail})</span>}</li>
            ))}</ul>
          )}
        </Card>
      </div>

      <Card title="Your books">
        {books.length === 0 ? <p className="text-sm text-stone-500">No books yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-stone-500"><tr><th className="py-2">Title</th><th>Status</th><th>Chapters</th><th>Sales</th><th>Likes</th><th>Wishlists</th><th>Editor</th></tr></thead>
              <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                {books.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2"><Link href={`/author/books/${b.id}`} className="underline">{b.title}</Link>{b.penName && <div className="text-xs text-stone-500">as {b.penName.name}</div>}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td>{b._count.chapters}</td><td>{b._count.purchases}</td><td>{b._count.likes}</td><td>{b._count.wishlist}</td>
                    <td className="text-xs">{b.editor ? <a href={`mailto:${b.editor.contactEmail}`} className="underline">{b.editor.user.displayName}</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {socials.length > 0 && <Card title="Author community">{socials.map((s) => <a key={s.id} href={s.url} className="mr-4 text-sm underline">{s.label}</a>)}</Card>}
    </div>
  );
}

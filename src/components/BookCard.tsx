import Link from "next/link";
import { LANGUAGES } from "@/lib/catalog";

type Props = {
  book: { code: string; title: string; coverUrl: string | null; language: string; genres: string[]; penName: { name: string; slug: string } | null };
};

export function BookCard({ book }: Props) {
  return (
    <Link href={`/books/${book.code}`} className="group block w-36 shrink-0">
      <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-stone-200 dark:bg-stone-800">
        {book.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={book.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-sm font-semibold text-stone-500">{book.title}</div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          {LANGUAGES[book.language] ?? book.language}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-medium group-hover:underline">{book.title}</p>
      {book.penName && <p className="text-xs text-stone-500">{book.penName.name}</p>}
    </Link>
  );
}

export function BookRow({ title, books }: { title: string; books: Props["book"][] }) {
  if (books.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {books.map((b) => (
          <BookCard key={b.code} book={b} />
        ))}
      </div>
    </section>
  );
}

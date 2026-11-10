import { BookCard } from "@/components/BookCard";
import { newBooks } from "@/lib/catalog";
import { NEW_BOOK_WINDOW_DAYS } from "@/lib/submissions";

export const metadata = { title: "New books" };
export const dynamic = "force-dynamic";

export default async function NewBooks() {
  const books = await newBooks(120);
  return (
    <>
      <h1 className="text-2xl font-bold">New books</h1>
      <p className="mb-6 text-sm text-stone-500">Published in the last {NEW_BOOK_WINDOW_DAYS} days.</p>
      {books.length === 0 ? <p className="text-stone-500">No new books right now.</p> : <div className="flex flex-wrap gap-6">{books.map((b) => <BookCard key={b.code} book={b} />)}</div>}
    </>
  );
}

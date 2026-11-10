import { BookCard } from "@/components/BookCard";
import { SearchBar } from "@/components/SearchBar";
import { searchBooks } from "@/lib/catalog";

export default async function Browse({ searchParams }: { searchParams: Promise<{ q?: string; genre?: string; language?: string }> }) {
  const f = await searchParams;
  const books = await searchBooks(f);
  return (
    <>
      <div className="mb-8"><SearchBar {...f} /></div>
      {books.length === 0 ? <p className="text-stone-500">No books match those filters.</p> : (
        <div className="flex flex-wrap gap-6">{books.map((b) => <BookCard key={b.code} book={b} />)}</div>
      )}
    </>
  );
}

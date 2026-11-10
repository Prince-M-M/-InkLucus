import Link from "next/link";
import { BookRow } from "@/components/BookCard";
import { SearchBar } from "@/components/SearchBar";
import { GENRES, homepageList, newBooks } from "@/lib/catalog";

export const dynamic = "force-dynamic"; // lists shuffle on every visit

export default async function Home() {
  const [picks, popular, best, shona, fresh] = await Promise.all([
    homepageList("EDITORS_PICKS"),
    homepageList("POPULAR"),
    homepageList("BEST_SELLING"),
    homepageList("FEATURED_LANGUAGE", "sn"),
    newBooks(),
  ]);
  return (
    <>
      <div className="mb-8"><SearchBar /></div>
      <div className="mb-8 flex flex-wrap gap-2">
        {GENRES.map((g) => (
          <Link key={g} href={`/browse?genre=${encodeURIComponent(g)}`} className="rounded-full border border-stone-300 px-3 py-1 text-sm dark:border-stone-700">{g}</Link>
        ))}
      </div>
      <BookRow title="Editor's Picks" books={picks} />
      <BookRow title="Popular" books={popular} />
      <BookRow title="Best Selling" books={best} />
      <BookRow title="Featured Shona Books" books={shona} />
      <BookRow title="New Books" books={fresh} />
    </>
  );
}

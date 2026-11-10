import { GENRES, LANGUAGES } from "@/lib/catalog";

export function SearchBar({ q, genre, language }: { q?: string; genre?: string; language?: string }) {
  return (
    <form action="/browse" className="flex flex-wrap gap-2">
      <input name="q" defaultValue={q} placeholder="Search titles or pen names…" className="min-w-0 flex-1 rounded-md border border-stone-300 bg-transparent px-3 py-2 dark:border-stone-700" />
      <select name="genre" defaultValue={genre ?? ""} className="rounded-md border border-stone-300 bg-transparent px-2 py-2 dark:border-stone-700">
        <option value="">All genres</option>
        {GENRES.map((g) => <option key={g}>{g}</option>)}
      </select>
      <select name="language" defaultValue={language ?? ""} className="rounded-md border border-stone-300 bg-transparent px-2 py-2 dark:border-stone-700">
        <option value="">All languages</option>
        {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <button className="rounded-md bg-stone-900 px-4 py-2 text-white dark:bg-stone-100 dark:text-stone-900">Search</button>
    </form>
  );
}

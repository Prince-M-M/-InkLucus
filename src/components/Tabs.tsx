import Link from "next/link";

export function Tabs({ base, tabs, active, counts = {} }: { base: string; tabs: readonly (readonly [string, string])[]; active: string; counts?: Record<string, number | undefined> }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-stone-200 dark:border-stone-800" aria-label="Sections">
      {tabs.map(([k, label]) => (
        <Link key={k} href={`${base}?tab=${k}`} aria-current={active === k ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${active === k ? "border-stone-900 font-semibold dark:border-stone-100" : "border-transparent text-stone-500"}`}>
          {label}{counts[k] ? ` (${counts[k]})` : ""}
        </Link>
      ))}
    </nav>
  );
}

export function pickTab<T extends readonly (readonly [string, string])[]>(tabs: T, value: string | undefined): T[number][0] {
  return (tabs.find(([k]) => k === value)?.[0] ?? tabs[0][0]) as T[number][0];
}

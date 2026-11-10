export function ManuscriptView({ chapters }: { chapters: { id: string; number: number; title: string; content: string; wordCount: number }[] }) {
  if (chapters.length === 0) return <p className="text-sm text-stone-500">No chapters yet.</p>;
  return (
    <div className="divide-y divide-stone-200 dark:divide-stone-800">
      {chapters.map((c) => (
        <details key={c.id} className="py-2">
          <summary className="cursor-pointer">
            {c.number}. {c.title} <span className="text-xs text-stone-500">· {c.wordCount.toLocaleString()} words</span>
          </summary>
          <div className="mt-3 max-h-[60vh] overflow-y-auto whitespace-pre-line rounded bg-stone-100 p-4 leading-relaxed dark:bg-stone-900">{c.content}</div>
        </details>
      ))}
    </div>
  );
}

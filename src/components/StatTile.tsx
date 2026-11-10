export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

/** Small table of a breakdown with a proportional bar for the value column. */
export function BreakdownTable({ rows, valueLabel, format }: { rows: { key: string; value: number; extra?: string }[]; valueLabel: string; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-stone-500">No data for this period.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-stone-500"><tr><th className="py-1 font-medium">Group</th><th className="font-medium">{valueLabel}</th><th className="w-1/3" /></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.key} className="border-t border-stone-100 dark:border-stone-900">
          <td className="py-1.5">{r.key}{r.extra && <span className="text-xs text-stone-500"> · {r.extra}</span>}</td>
          <td className="tabular-nums">{format(r.value)}</td>
          <td><div className="h-2 rounded bg-stone-800 dark:bg-stone-200" style={{ width: `${(r.value / max) * 100}%` }} /></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

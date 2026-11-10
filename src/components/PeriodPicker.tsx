import Link from "next/link";
import { REPORT_PERIODS } from "@/lib/periods";

export function PeriodPicker({ base, active, extra = "" }: { base: string; active: string; extra?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {REPORT_PERIODS.map(([k, label]) => (
        <Link key={k} href={`${base}${base.includes("?") ? "&" : "?"}period=${k}${extra}`}
          className={`rounded-full border px-3 py-1 text-xs ${active === k ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900" : "border-stone-300 dark:border-stone-700"}`}>
          {label}
        </Link>
      ))}
    </div>
  );
}

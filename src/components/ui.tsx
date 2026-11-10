import type { BookStatus } from "@prisma/client";

export const inputCls = "w-full rounded-md border border-stone-300 bg-transparent px-3 py-2 dark:border-stone-700";
export const btnCls = "rounded-md bg-stone-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900";
export const btnOutlineCls = "rounded-md border border-stone-300 px-4 py-2 dark:border-stone-700";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

const STATUS_STYLE: Record<BookStatus, string> = {
  IN_POOL: "bg-sky-100 text-sky-900",
  UNDER_REVIEW: "bg-amber-100 text-amber-900",
  ACCEPTED: "bg-violet-100 text-violet-900",
  REJECTED: "bg-red-100 text-red-900",
  ON_SALE: "bg-green-100 text-green-900",
  UNLISTED: "bg-stone-200 text-stone-800",
};
const STATUS_LABEL: Record<BookStatus, string> = {
  IN_POOL: "Waiting for an editor",
  UNDER_REVIEW: "Under review",
  ACCEPTED: "Accepted",
  REJECTED: "Not accepted",
  ON_SALE: "On sale",
  UNLISTED: "Unlisted",
};

export function StatusBadge({ status }: { status: BookStatus }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function Card({ title, children, actions }: { title?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 p-5 dark:border-stone-800">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "warn"; children: React.ReactNode }) {
  const cls = { info: "bg-sky-50 text-sky-900 border-sky-200", success: "bg-green-50 text-green-900 border-green-200", warn: "bg-amber-50 text-amber-900 border-amber-200" }[tone];
  return <div className={`rounded-md border p-3 text-sm ${cls}`}>{children}</div>;
}
export const ACCOUNT_STATUS_STYLE = { ACTIVE: "text-green-700", RESTRICTED: "text-amber-700", BLOCKED: "text-red-700" } as const;

"use client";
import { useActionState } from "react";
import type { FormState } from "@/app/actions";

export function ActionForm({
  action,
  children,
  submitLabel,
  className = "flex flex-col gap-3",
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      <button disabled={pending} className="rounded-md bg-stone-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900">
        {pending ? "…" : submitLabel}
      </button>
      {state?.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>}
    </form>
  );
}

export const inputCls = "rounded-md border border-stone-300 bg-transparent px-3 py-2 dark:border-stone-700";

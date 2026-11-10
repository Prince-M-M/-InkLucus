"use client";
import { useActionState, useEffect, useRef, startTransition } from "react";
import type { FormState } from "@/lib/form";

/**
 * Form bound to a server action. Unlike a plain `<form action>`, fields keep what the user typed
 * when the action returns an error; they are cleared only after success.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  className = "flex flex-col gap-3",
  inlineSuccess = false,
  resetOnSuccess = true,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  /** Show the success message under the form too (e.g. a gift card code to copy). Otherwise a toast shows it. */
  inlineSuccess?: boolean;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}
      className={className}
    >
      {children}
      <button disabled={pending} className="rounded-md bg-stone-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900">
        {pending ? "…" : submitLabel}
      </button>
      {state?.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
      {inlineSuccess && state?.ok && <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>}
    </form>
  );
}

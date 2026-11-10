import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm } from "@/components/ActionForm";
import { Field, inputCls } from "@/components/ui";
import { login } from "@/app/account/actions";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Log in</h1>
      <ActionForm action={login} submitLabel="Log in">
        {next && <input type="hidden" name="next" value={next} />}
        <Field label="Email"><input name="email" type="email" autoComplete="email" required className={inputCls} /></Field>
        <Field label="Password"><input name="password" type="password" autoComplete="current-password" required className={inputCls} /></Field>
      </ActionForm>
      <p className="mt-4 text-sm"><Link href="/forgot-password" className="underline">Forgot your password?</Link></p>
      <p className="mt-2 text-sm">No account? <Link href="/register" className="underline">Sign up</Link></p>
    </div>
  );
}

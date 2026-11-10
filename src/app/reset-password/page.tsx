import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field, Notice, inputCls } from "@/components/ui";
import { resetPasswordAction } from "@/app/account/actions";

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Choose a new password</h1>
      {!token ? <Notice tone="warn">This link is incomplete. <Link href="/forgot-password" className="underline">Request a new one</Link>.</Notice> : (
        <ActionForm action={resetPasswordAction} submitLabel="Save password">
          <input type="hidden" name="token" value={token} />
          <Field label="New password"><input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputCls} /></Field>
          <Field label="Confirm"><input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={inputCls} /></Field>
        </ActionForm>
      )}
    </div>
  );
}

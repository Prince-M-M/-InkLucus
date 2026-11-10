import { ActionForm } from "@/components/ActionForm";
import { Field, inputCls } from "@/components/ui";
import { requestResetAction } from "@/app/account/actions";

export default function ForgotPassword() {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-2 text-2xl font-bold">Reset your password</h1>
      <p className="mb-6 text-sm text-stone-500">We&apos;ll email you a link to choose a new password.</p>
      <ActionForm action={requestResetAction} submitLabel="Send reset link" inlineSuccess>
        <Field label="Email"><input name="email" type="email" required autoComplete="email" className={inputCls} /></Field>
      </ActionForm>
    </div>
  );
}

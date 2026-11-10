import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm } from "@/components/ActionForm";
import { Field, inputCls } from "@/components/ui";
import { register } from "@/app/account/actions";

export const metadata: Metadata = { title: "Sign up" };

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Create a reader account</h1>
      <ActionForm action={register} submitLabel="Sign up">
        <Field label="Display name"><input name="displayName" required minLength={2} maxLength={40} autoComplete="nickname" className={inputCls} /></Field>
        <Field label="Email"><input name="email" type="email" required autoComplete="email" className={inputCls} /></Field>
        <Field label="Password" hint="At least 8 characters."><input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputCls} /></Field>
        <Field label="Date of birth" hint="Used only to show age-appropriate books. You must be 13 or older."><input name="dateOfBirth" type="date" required className={inputCls} /></Field>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="terms" className="mt-1" /> <span>I agree to the <Link href="/terms" className="underline">terms</Link> and <Link href="/privacy" className="underline">privacy policy</Link>.</span></label>
      </ActionForm>
      <p className="mt-4 text-sm">Already have an account? <Link href="/login" className="underline">Log in</Link></p>
    </div>
  );
}

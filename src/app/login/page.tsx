import Link from "next/link";
import { ActionForm, inputCls } from "@/components/ActionForm";
import { login } from "@/app/actions";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Log in</h1>
      <ActionForm action={login} submitLabel="Log in">
        <input name="email" type="email" placeholder="Email" required className={inputCls} />
        <input name="password" type="password" placeholder="Password" required className={inputCls} />
      </ActionForm>
      <p className="mt-4 text-sm">No account? <Link href="/register" className="underline">Sign up</Link></p>
    </div>
  );
}

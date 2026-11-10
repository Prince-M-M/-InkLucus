import { ActionForm } from "@/components/ActionForm";
import { inputCls } from "@/components/ui";
import { register } from "@/app/actions";

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Create a reader account</h1>
      <ActionForm action={register} submitLabel="Sign up">
        <input name="displayName" placeholder="Display name" required className={inputCls} />
        <input name="email" type="email" placeholder="Email" required className={inputCls} />
        <input name="password" type="password" placeholder="Password (8+ characters)" required minLength={8} className={inputCls} />
      </ActionForm>
    </div>
  );
}

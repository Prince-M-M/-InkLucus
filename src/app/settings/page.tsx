import type { Metadata } from "next";
import { requireUser } from "@/lib/guards";
import { GENRES, LANGUAGES } from "@/lib/catalog";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, btnOutlineCls, inputCls } from "@/components/ui";
import { changePassword, logoutEverywhere, updateProfile } from "@/app/account/actions";

export const metadata: Metadata = { title: "Settings" };

export default async function Settings() {
  const user = await requireUser();
  const ed = user.editorProfile;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Card title="Profile">
        <ActionForm action={updateProfile} submitLabel="Save profile">
          <Field label="Email"><input value={user.email} disabled className={`${inputCls} opacity-60`} /></Field>
          <Field label="Display name"><input name="displayName" defaultValue={user.displayName} required minLength={2} maxLength={40} className={inputCls} /></Field>
          <Field label="Date of birth" hint={user.dateOfBirth ? "Contact support to correct your date of birth." : "Needed to read 16+ and 18+ books. Can only be set once."}>
            <input name="dateOfBirth" type="date" disabled={!!user.dateOfBirth} defaultValue={user.dateOfBirth?.toISOString().slice(0, 10)} className={inputCls} />
          </Field>
          {ed && (
            <>
              <Field label="Contact email shown to your authors"><input name="contactEmail" type="email" defaultValue={ed.contactEmail} className={inputCls} /></Field>
              <Field label="Contact phone"><input name="contactPhone" defaultValue={ed.contactPhone ?? ""} className={inputCls} /></Field>
              <fieldset className="text-sm"><legend className="mb-1 font-medium">Genres you edit</legend>
                <div className="flex flex-wrap gap-3">{GENRES.map((g) => <label key={g} className="flex items-center gap-1"><input type="checkbox" name="genres" value={g} defaultChecked={ed.genres.includes(g)} /> {g}</label>)}</div>
              </fieldset>
              <fieldset className="text-sm"><legend className="mb-1 font-medium">Languages you edit</legend>
                <div className="flex flex-wrap gap-3">{Object.entries(LANGUAGES).map(([k, v]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" name="languages" value={k} defaultChecked={ed.languages.includes(k)} /> {v}</label>)}</div>
              </fieldset>
            </>
          )}
        </ActionForm>
      </Card>
      <Card title="Change password">
        <ActionForm action={changePassword} submitLabel="Change password">
          <Field label="Current password"><input name="current" type="password" required autoComplete="current-password" className={inputCls} /></Field>
          <Field label="New password"><input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputCls} /></Field>
          <Field label="Confirm new password"><input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={inputCls} /></Field>
        </ActionForm>
      </Card>
      <Card title="Sessions">
        <p className="mb-3 text-sm text-stone-500">Lost a phone or used a shared computer? Log out of every device.</p>
        <form action={logoutEverywhere}><button className={btnOutlineCls}>Log out everywhere</button></form>
      </Card>
    </div>
  );
}

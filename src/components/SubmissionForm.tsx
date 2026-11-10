import { ActionForm } from "./ActionForm";
import { Field, inputCls } from "./ui";
import { submitBookAction } from "@/app/author/actions";
import { GENRES, LANGUAGES } from "@/lib/catalog";

export function SubmissionForm({ penNames, showReferral }: { penNames?: { id: string; name: string }[]; showReferral: boolean }) {
  return (
    <ActionForm action={submitBookAction} submitLabel="Submit book">
      <Field label="Book title"><input name="title" required maxLength={150} className={inputCls} /></Field>
      {penNames && penNames.length > 0 && (
        <Field label="Publish under pen name" hint="Books under a pen name go to that pen name's editor.">
          <select name="penNameId" className={inputCls}>
            <option value="">Decide with my editor</option>
            {penNames.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Synopsis" hint="What is the book about? 20–3000 characters.">
        <textarea name="synopsis" required minLength={20} maxLength={3000} rows={4} className={inputCls} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Language">
          <select name="language" className={inputCls}>{Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="Age rating">
          <select name="ageRating" className={inputCls}>
            <option value="ALL">All ages</option><option value="TEEN_13">13+</option><option value="MATURE_16">16+</option><option value="ADULT_18">18+</option>
          </select>
        </Field>
      </div>
      <fieldset className="text-sm">
        <legend className="mb-1 font-medium">Genres (up to 3)</legend>
        <div className="flex flex-wrap gap-3">
          {GENRES.map((g) => <label key={g} className="flex items-center gap-1"><input type="checkbox" name="genres" value={g} /> {g}</label>)}
        </div>
      </fieldset>
      <Field label="Manuscript" hint='Paste your first chapters (up to 30). Start each chapter with a line like "# Chapter 1: The River".'>
        <textarea name="manuscript" required rows={14} className={`${inputCls} font-mono text-sm`} placeholder={"# Chapter 1: The River\nIt was raining when…\n\n# Chapter 2: …"} />
      </Field>
      <Field label="Note to the editor (optional)"><textarea name="note" rows={2} maxLength={1000} className={inputCls} /></Field>
      {showReferral && (
        <Field label="Referral code (optional)" hint="If an author scout or campaign referred you, e.g. AA1234.">
          <input name="referralCode" maxLength={6} className={`${inputCls} uppercase`} />
        </Field>
      )}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agree" className="mt-1" /> This is my original work and I meet the requirements above.</label>
    </ActionForm>
  );
}

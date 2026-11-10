import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/guards";
import { formatCents } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, Notice, inputCls } from "@/components/ui";
import { adjustmentAction, finalizeAction } from "../../actions";

export default async function Statement({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("ACCOUNTING", "ADMIN");
  const st = await db.royaltyStatement.findUnique({
    where: { id: (await params).id },
    include: { author: { include: { user: true } }, lines: { include: { book: { select: { title: true, code: true } } } }, adjustments: { orderBy: { createdAt: "asc" } } },
  });
  if (!st) notFound();
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const editable = st.status === "DRAFT" && user.role === "ACCOUNTING";
  return (
    <div className="space-y-6">
      <Link href={`/accounting?tab=royalties&p=${st.periodStart.toISOString()}`} className="text-sm underline">← Royalties</Link>
      <h1 className="text-2xl font-bold">{st.author.user.displayName} · {fmt(st.periodStart)} – {fmt(new Date(st.periodEnd.getTime() - 1))}</h1>
      <p className="text-sm text-stone-500">Author ID {st.author.internalCode} · {st.status === "FINAL" ? `Final since ${st.finalizedAt?.toLocaleString()}` : "Draft"}</p>
      <Card title={`Income: ${formatCents(st.amountCents)}`}>
        <table className="w-full text-sm tabular-nums">
          <thead className="text-left text-xs uppercase text-stone-500"><tr><th className="py-1">Book</th><th>Copies</th><th>Gross</th><th>Royalty</th><th>Amount</th></tr></thead>
          <tbody>
            {st.lines.map((l) => <tr key={l.id} className="border-t border-stone-100 dark:border-stone-900"><td className="py-1.5">{l.book.title}</td><td>{l.copies}</td><td>{formatCents(l.grossCents)}</td><td>{l.royaltyPercent}%</td><td>{formatCents(l.amountCents)}</td></tr>)}
            {st.adjustments.map((a) => <tr key={a.id} className="border-t border-stone-100 text-stone-600 dark:border-stone-900 dark:text-stone-400"><td className="py-1.5" colSpan={4}>Adjustment: {a.note} <span className="text-xs">({a.createdAt.toLocaleDateString()})</span></td><td>{formatCents(a.amountCents)}</td></tr>)}
          </tbody>
        </table>
      </Card>
      {editable ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Card title="Add an adjustment">
            <ActionForm action={adjustmentAction} submitLabel="Add adjustment">
              <input type="hidden" name="statementId" value={st.id} />
              <Field label="Amount" hint="Negative to deduct, e.g. -2.50"><input name="amount" required className={inputCls} /></Field>
              <Field label="Reason (shown to the author)"><input name="note" required className={inputCls} /></Field>
            </ActionForm>
          </Card>
          <Card title="Finalise">
            <p className="mb-3 text-sm text-stone-500">Locks the statement and shows it to the author as income. Only possible after the period has ended.</p>
            <ActionForm action={finalizeAction} submitLabel="Finalise statement"><input type="hidden" name="statementId" value={st.id} /></ActionForm>
          </Card>
        </div>
      ) : st.status === "FINAL" ? <Notice tone="success">This statement is final.</Notice> : null}
    </div>
  );
}

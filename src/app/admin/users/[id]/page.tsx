import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/guards";
import { formatCents } from "@/lib/money";
import { DEFAULT_DELETE_AFTER_DAYS } from "@/lib/moderation";
import { editorWorkload } from "@/lib/staff";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, Notice, ACCOUNT_STATUS_STYLE, inputCls } from "@/components/ui";
import { changeRoleAction, setStatusAction } from "@/app/admin/actions";

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireRole("ADMIN");
  const u = await db.user.findUnique({
    where: { id },
    include: {
      authorProfile: { include: { referral: true, editor: { include: { user: true } } } },
      editorProfile: true,
      wallet: true,
      flagsReceived: { orderBy: { createdAt: "desc" }, include: { reporter: true } },
      appeals: { orderBy: { createdAt: "desc" } },
      roleChanges: { orderBy: { createdAt: "desc" }, include: { actor: true } },
      _count: { select: { purchases: true, comments: true, reviews: true } },
    },
  });
  if (!u) notFound();
  const workload = u.editorProfile ? await editorWorkload(u.editorProfile.id) : null;
  const self = u.id === admin.id;

  return (
    <div className="space-y-6">
      <Link href="/admin?tab=users" className="text-sm underline">← Accounts</Link>
      <header>
        <h1 className="text-2xl font-bold">{u.displayName}</h1>
        <p className="text-sm text-stone-500">{u.email} · {u.role.toLowerCase()} · <span className={ACCOUNT_STATUS_STYLE[u.status]}>{u.status.toLowerCase()}</span> · joined {u.createdAt.toLocaleDateString()}</p>
        {u.authorProfile && <p className="text-sm text-stone-500">Author ID <span className="font-mono">{u.authorProfile.internalCode}</span> · referral {u.authorProfile.referral.label} · editor {u.authorProfile.editor?.user.displayName ?? "—"}</p>}
      </header>
      {u.status !== "ACTIVE" && <Notice tone="warn">{u.status === "BLOCKED" ? "Blocked" : "Restricted"}: {u.statusReason}{u.deletionScheduledAt && <> · deletion scheduled {u.deletionScheduledAt.toLocaleDateString()}</>}</Notice>}

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <p>Purchases <b>{u._count.purchases}</b></p><p>Comments <b>{u._count.comments}</b></p><p>Reviews <b>{u._count.reviews}</b></p>
        {u.wallet && <p>Wallet <b>{formatCents(u.wallet.balanceCents)}</b></p>}
      </div>

      {self ? <Notice>This is your own account. Another admin has to change its type or status.</Notice> : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card title="Account type">
            {u.role === "AUTHOR" ? <p className="text-sm text-stone-500">Author accounts keep their type. Use restrict or block if needed.</p> : (
              <ActionForm action={changeRoleAction} submitLabel="Change type">
                <input type="hidden" name="userId" value={u.id} />
                <Field label="New type">
                  <select name="role" defaultValue={u.role} className={inputCls}>
                    <option value="READER">Reader</option><option value="EDITOR">Editor</option><option value="ACCOUNTING">Accounting</option><option value="ADMIN">Admin</option>
                  </select>
                </Field>
                <Field label="Note (optional)"><input name="note" className={inputCls} /></Field>
                {workload && workload.total > 0 && <p className="text-xs text-stone-500">Manages {workload.authors} authors, {workload.books} books and {workload.reviewing} reviews. Hand these over before removing editor rights.</p>}
              </ActionForm>
            )}
          </Card>
          {u.role !== "ADMIN" && (
            <Card title="Restrict or block">
              <ActionForm action={setStatusAction} submitLabel="Update status">
                <input type="hidden" name="userId" value={u.id} />
                <Field label="Status">
                  <select name="status" defaultValue={u.status} className={inputCls}>
                    <option value="ACTIVE">Active</option>
                    <option value="RESTRICTED">Restricted: can read purchases, can&apos;t comment or review</option>
                    <option value="BLOCKED">Blocked: deleted after the grace period unless they appeal</option>
                  </select>
                </Field>
                <Field label="Reason (shown to the user)"><textarea name="reason" rows={2} defaultValue={u.statusReason ?? ""} className={inputCls} /></Field>
                <Field label="Delete after (days, if blocked)"><input name="days" type="number" min={1} defaultValue={DEFAULT_DELETE_AFTER_DAYS} className={inputCls} /></Field>
              </ActionForm>
            </Card>
          )}
        </div>
      )}

      <Card title={`Flags (${u.flagsReceived.length})`}>
        {u.flagsReceived.length === 0 ? <p className="text-sm text-stone-500">None.</p> : (
          <ul className="space-y-1 text-sm">{u.flagsReceived.map((f) => <li key={f.id}>{f.createdAt.toLocaleDateString()}: “{f.reason}” by {f.reporter.displayName}</li>)}</ul>
        )}
      </Card>
      <Card title="Appeals">
        {u.appeals.length === 0 ? <p className="text-sm text-stone-500">None.</p> : (
          <ul className="space-y-2 text-sm">{u.appeals.map((a) => (
            <li key={a.id}>{a.createdAt.toLocaleDateString()}: {a.message}{a.resolved && <p className="text-stone-500">→ {a.reinstated ? "Reinstated" : "Declined"}: {a.resolution}</p>}{!a.resolved && <span className="ml-1 text-amber-700">(waiting)</span>}</li>
          ))}</ul>
        )}
      </Card>
      <Card title="Account type history">
        {u.roleChanges.length === 0 ? <p className="text-sm text-stone-500">No changes.</p> : (
          <ul className="space-y-1 text-sm">{u.roleChanges.map((r) => <li key={r.id}>{r.createdAt.toLocaleDateString()}: {r.fromRole.toLowerCase()} → {r.toRole.toLowerCase()} by {r.actor.displayName}{r.note && <> · {r.note}</>}</li>)}</ul>
        )}
      </Card>
    </div>
  );
}

import Link from "next/link";
import type { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/guards";
import { flaggedAccounts } from "@/lib/moderation";
import { LIST_LABELS, MAX_APPROVED_PER_LIST, schedulablePeriods } from "@/lib/homepage";
import { LANGUAGES } from "@/lib/catalog";
import { ActionForm } from "@/components/ActionForm";
import { Card, Field, Notice, ACCOUNT_STATUS_STYLE, btnOutlineCls, inputCls } from "@/components/ui";
import { addSocialLinkAction, adminProposeAction, createStaffAction, reassignEditorAction, removeSocialLinkAction, resolveAppealAction, reviewSlotAction } from "./actions";
import { editorPerformance, salesStats } from "@/lib/stats";
import { reportPeriod, REPORT_PERIODS } from "@/lib/periods";
import { formatCents } from "@/lib/money";
import { PLATFORMS } from "@/lib/social";
import { SalesStatsView } from "@/components/SalesStatsView";

const TABS = [["overview", "Overview"], ["stats", "Statistics"], ["users", "Accounts"], ["moderation", "Moderation"], ["homepage", "Homepage"], ["community", "Community links"]] as const;
type Tab = (typeof TABS)[number][0];
type SP = { tab?: string; q?: string; role?: string; status?: string; period?: string; error?: string; range?: string };


export default async function AdminPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireRole("ADMIN");
  const tab: Tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "overview") as Tab;
  const [openAppeals, flagged] = await Promise.all([db.appeal.count({ where: { resolved: false } }), db.flag.groupBy({ by: ["targetId"] }).then((g) => g.length)]);
  const badge: Partial<Record<Tab, number>> = { moderation: openAppeals + flagged };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin</h1>
      <nav className="flex flex-wrap gap-1 border-b border-stone-200 dark:border-stone-800">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/admin?tab=${k}`} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-stone-900 font-semibold dark:border-stone-100" : "border-transparent text-stone-500"}`}>
            {label}{badge[k] ? ` (${badge[k]})` : ""}
          </Link>
        ))}
      </nav>
      {sp.error && <Notice tone="warn">{sp.error}</Notice>}
      {tab === "overview" && <Overview />}
      {tab === "users" && <Users sp={sp} />}
      {tab === "moderation" && <Moderation />}
      {tab === "homepage" && <Homepage period={sp.period} />}
      {tab === "stats" && <AdminStats period={sp.range} />}
      {tab === "community" && <Community />}
    </div>
  );
}

async function Overview() {
  const [byRole, byStatus, pool, reviewing, onSale] = await Promise.all([
    db.user.groupBy({ by: ["role"], _count: { _all: true } }),
    db.user.groupBy({ by: ["status"], _count: { _all: true } }),
    db.book.count({ where: { status: "IN_POOL" } }),
    db.book.count({ where: { status: "UNDER_REVIEW" } }),
    db.book.count({ where: { status: "ON_SALE" } }),
  ]);
  const stat = (label: string, n: number, href?: string) => (
    <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
      <p className="text-xs uppercase text-stone-500">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{href ? <Link href={href} className="underline decoration-stone-300">{n}</Link> : n}</p>
    </div>
  );
  const roles: Role[] = ["READER", "AUTHOR", "EDITOR", "ACCOUNTING", "ADMIN"];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {roles.map((r) => stat(`${r.toLowerCase()}s`, byRole.find((g) => g.role === r)?._count._all ?? 0, `/admin?tab=users&role=${r}`))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stat("Books in pool", pool)}{stat("Under review", reviewing)}{stat("On sale", onSale)}
        {stat("Restricted", byStatus.find((g) => g.status === "RESTRICTED")?._count._all ?? 0, "/admin?tab=users&status=RESTRICTED")}
        {stat("Blocked", byStatus.find((g) => g.status === "BLOCKED")?._count._all ?? 0, "/admin?tab=users&status=BLOCKED")}
      </div>
    </div>
  );
}

async function Users({ sp }: { sp: SP }) {
  const where: Prisma.UserWhereInput = {
    email: { not: { endsWith: "@deleted.invalid" } },
    ...(sp.q ? { OR: [{ email: { contains: sp.q, mode: "insensitive" } }, { displayName: { contains: sp.q, mode: "insensitive" } }, { authorProfile: { internalCode: { contains: sp.q.toUpperCase() } } }] } : {}),
    ...(sp.role ? { role: sp.role as Role } : {}),
    ...(sp.status ? { status: sp.status as "ACTIVE" } : {}),
  };
  const [users, editors] = await Promise.all([
    db.user.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { authorProfile: true, _count: { select: { flagsReceived: true } } } }),
    db.editorProfile.findMany({ where: { user: { role: { in: ["EDITOR", "ADMIN"] } } }, include: { user: true } }),
  ]);
  const sel = "rounded-md border border-stone-300 bg-transparent px-2 py-1.5 text-sm dark:border-stone-700";
  return (
    <div className="space-y-6">
      <form className="flex flex-wrap gap-2">
        <input type="hidden" name="tab" value="users" />
        <input name="q" defaultValue={sp.q} placeholder="Email, name or author ID" className={`${sel} min-w-0 flex-1`} />
        <select name="role" defaultValue={sp.role ?? ""} className={sel}><option value="">All types</option>{["READER", "AUTHOR", "EDITOR", "ACCOUNTING", "ADMIN"].map((r) => <option key={r}>{r}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} className={sel}><option value="">Any status</option>{["ACTIVE", "RESTRICTED", "BLOCKED"].map((r) => <option key={r}>{r}</option>)}</select>
        <button className={`${btnOutlineCls} py-1.5 text-sm`}>Search</button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-stone-500"><tr><th className="py-2">Name</th><th>Email</th><th>Type</th><th>Status</th><th>Flags</th><th>Joined</th></tr></thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="py-2"><Link href={`/admin/users/${u.id}`} className="underline">{u.displayName}</Link>{u.authorProfile && <div className="font-mono text-xs text-stone-500">{u.authorProfile.internalCode}</div>}</td>
                <td>{u.email}</td><td>{u.role.toLowerCase()}</td>
                <td className={ACCOUNT_STATUS_STYLE[u.status]}>{u.status.toLowerCase()}</td>
                <td>{u._count.flagsReceived || ""}</td><td className="text-xs text-stone-500">{u.createdAt.toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <p className="py-4 text-sm text-stone-500">No accounts match.</p>}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Create a staff account">
          <ActionForm action={createStaffAction} submitLabel="Create account">
            <Field label="Name"><input name="displayName" required className={inputCls} /></Field>
            <Field label="Email"><input name="email" type="email" required className={inputCls} /></Field>
            <Field label="Account type"><select name="role" className={inputCls}><option value="EDITOR">Editor</option><option value="ACCOUNTING">Accounting</option><option value="ADMIN">Admin</option></select></Field>
            <Field label="Temporary password" hint="At least 10 characters. Share it with them privately."><input name="password" type="text" required minLength={10} autoComplete="off" className={inputCls} /></Field>
          </ActionForm>
        </Card>
        <Card title="Hand over an editor's work">
          <p className="mb-3 text-sm text-stone-500">Moves all authors, pen names, books and open reviews from one editor to another, e.g. before someone leaves.</p>
          <ActionForm action={reassignEditorAction} submitLabel="Move everything">
            <Field label="From"><select name="fromEditorId" className={inputCls}>{editors.map((e) => <option key={e.id} value={e.id}>{e.user.displayName}</option>)}</select></Field>
            <Field label="To"><select name="toEditorId" className={inputCls}>{editors.map((e) => <option key={e.id} value={e.id}>{e.user.displayName}</option>)}</select></Field>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}

async function Moderation() {
  const [flagged, appeals] = await Promise.all([
    flaggedAccounts(),
    db.appeal.findMany({ where: { resolved: false }, orderBy: { createdAt: "asc" }, include: { user: true } }),
  ]);
  return (
    <div className="space-y-6">
      <Card title={`Appeals waiting (${appeals.length})`}>
        {appeals.length === 0 ? <p className="text-sm text-stone-500">No open appeals.</p> : (
          <ul className="space-y-4">{appeals.map((a) => (
            <li key={a.id} className="rounded-md border border-stone-200 p-3 dark:border-stone-800">
              <p className="text-sm"><Link href={`/admin/users/${a.userId}`} className="font-semibold underline">{a.user.displayName}</Link> · <span className={ACCOUNT_STATUS_STYLE[a.user.status]}>{a.user.status.toLowerCase()}</span> for “{a.user.statusReason}”</p>
              <p className="my-2 whitespace-pre-line text-sm">{a.message}</p>
              <ActionForm action={resolveAppealAction} submitLabel="Send decision" className="flex flex-col gap-2">
                <input type="hidden" name="appealId" value={a.id} />
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1"><input type="radio" name="decision" value="reinstate" required /> Reinstate account</label>
                  <label className="flex items-center gap-1"><input type="radio" name="decision" value="uphold" /> Keep restriction</label>
                </div>
                <textarea name="resolution" required rows={2} placeholder="Reply to the user" className={inputCls} />
              </ActionForm>
            </li>
          ))}</ul>
        )}
      </Card>
      <Card title="Flagged accounts">
        {flagged.length === 0 ? <p className="text-sm text-stone-500">No flagged accounts.</p> : (
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">{flagged.map(({ user, count, lastFlaggedAt }) => (
            <li key={user.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p><Link href={`/admin/users/${user.id}`} className="font-semibold underline">{user.displayName}</Link> <span className="text-sm text-stone-500">{user.role.toLowerCase()} · <span className={ACCOUNT_STATUS_STYLE[user.status]}>{user.status.toLowerCase()}</span></span></p>
                <p className="text-sm"><b>{count}</b> flag{count === 1 ? "" : "s"} · last {lastFlaggedAt?.toLocaleDateString()}</p>
              </div>
              <ul className="mt-1 text-sm text-stone-600 dark:text-stone-400">{user.flagsReceived.map((f) => <li key={f.id}>“{f.reason}” by {f.reporter.displayName}</li>)}</ul>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

async function Homepage({ period }: { period?: string }) {
  const periods = schedulablePeriods();
  const active = periods.find((p) => p.start.toISOString() === period) ?? periods[0];
  const slots = await db.homepageSlot.findMany({
    where: { startsAt: active.start, status: { not: "DECLINED" } },
    orderBy: { createdAt: "asc" },
    include: { book: { select: { title: true, code: true, language: true } }, proposedBy: { include: { user: true } } },
  });
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const lists = Object.keys(LIST_LABELS) as (keyof typeof LIST_LABELS)[];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {periods.map((p, i) => (
          <Link key={p.start.toISOString()} href={`/admin?tab=homepage&period=${p.start.toISOString()}`}
            className={`rounded-full border px-3 py-1 text-sm ${p === active ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900" : "border-stone-300 dark:border-stone-700"}`}>
            {i === 0 ? "Current" : "Next"}: {fmt(p.start)} – {fmt(new Date(p.end.getTime() - 1))}
          </Link>
        ))}
      </div>
      {lists.map((list) => {
        const inList = slots.filter((s) => s.list === list);
        const approved = inList.filter((s) => s.status === "APPROVED").length;
        return (
          <Card key={list} title={`${LIST_LABELS[list]} (${approved}/${MAX_APPROVED_PER_LIST} live)`}>
            {inList.length === 0 ? <p className="text-sm text-stone-500">No proposals yet.</p> : (
              <ul className="divide-y divide-stone-200 dark:divide-stone-800">{inList.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <Link href={`/books/${s.book.code}`} className="underline">{s.book.title}</Link>
                    {s.language && <span className="ml-1 text-xs uppercase text-stone-500">{LANGUAGES[s.language] ?? s.language}</span>}
                    <span className="text-stone-500"> · proposed by {s.proposedBy.user.displayName}</span>
                  </span>
                  <form action={reviewSlotAction} className="flex gap-2">
                    <input type="hidden" name="slotId" value={s.id} /><input type="hidden" name="period" value={active.start.toISOString()} />
                    {s.status === "APPROVED" ? (
                      <><span className="text-green-700">✓ Live</span><button name="decision" value="decline" className="text-xs underline">Remove</button></>
                    ) : (
                      <><button name="decision" value="approve" className={`${btnOutlineCls} py-1 text-xs`}>Approve</button><button name="decision" value="decline" className="text-xs underline">Decline</button></>
                    )}
                  </form>
                </li>
              ))}</ul>
            )}
          </Card>
        );
      })}
      <Card title="Add a book yourself">
        <ActionForm action={adminProposeAction} submitLabel="Add proposal" className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
          <input type="hidden" name="period" value={active.start.toISOString()} />
          <Field label="Book code"><input name="bookCode" required placeholder="BK…" className={`${inputCls} uppercase`} /></Field>
          <Field label="List"><select name="list" className={inputCls}>{lists.map((l) => <option key={l} value={l}>{LIST_LABELS[l]}</option>)}</select></Field>
        </ActionForm>
      </Card>
    </div>
  );
}

async function AdminStats({ period }: { period?: string }) {
  const p = reportPeriod(period);
  const [s, perf] = await Promise.all([salesStats("all", p), editorPerformance(p)]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {REPORT_PERIODS.map(([k, label]) => (
          <Link key={k} href={`/admin?tab=stats&range=${k}`} className={`rounded-full border px-3 py-1 text-xs ${p.key === k ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900" : "border-stone-300 dark:border-stone-700"}`}>{label}</Link>
        ))}
      </div>
      <Card title={`Editor performance · ${p.label}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs uppercase text-stone-500"><tr><th className="py-1">Editor</th><th>New books taken on</th><th>On sale</th><th>Copies</th><th>Sales</th><th>New wishlists</th><th>Reviews (avg)</th><th>New readers</th></tr></thead>
            <tbody>{perf.map((e) => (
              <tr key={e.editorId} className="border-t border-stone-100 dark:border-stone-900">
                <td className="py-1.5">{e.name}</td><td>{e.newBooksTaken}</td><td>{e.booksOnSale}</td><td>{e.copies}</td><td>{formatCents(e.cents)}</td><td>{e.wishlists}</td>
                <td>{e.reviews}{e.avgRating != null && ` (${e.avgRating.toFixed(1)})`}</td><td>{e.views}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-stone-500">“New readers” counts first-time chapter reads in the period.</p>
      </Card>
      <SalesStatsView s={s} />
    </div>
  );
}

async function Community() {
  const links = await db.socialLink.findMany({ orderBy: [{ audience: "asc" }, { createdAt: "asc" }] });
  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-500">Discord, Facebook, WhatsApp and other group links shown on dashboards. Choose which account type sees each link.</p>
      <Card title="Links">
        {links.length === 0 ? <p className="text-sm text-stone-500">No links yet.</p> : (
          <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">{links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><b>{l.label}</b> <span className="text-stone-500">· {l.platform} · shown to {l.audience.toLowerCase()}s</span><br /><a href={l.url} className="break-all text-xs underline" target="_blank" rel="noopener noreferrer">{l.url}</a></span>
              <form action={removeSocialLinkAction}><input type="hidden" name="id" value={l.id} /><button className="text-xs underline">Remove</button></form>
            </li>
          ))}</ul>
        )}
      </Card>
      <Card title="Add a link">
        <ActionForm action={addSocialLinkAction} submitLabel="Add link">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Label"><input name="label" required placeholder="Readers' Discord" className={inputCls} /></Field>
            <Field label="Platform"><select name="platform" className={inputCls}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></Field>
            <Field label="Shown to"><select name="audience" className={inputCls}>{["READER", "AUTHOR", "EDITOR", "ACCOUNTING", "ADMIN"].map((r) => <option key={r} value={r}>{r.toLowerCase()}s</option>)}</select></Field>
            <Field label="Link"><input name="url" type="url" required placeholder="https://discord.gg/…" className={inputCls} /></Field>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { changeRole, createStaffAccount, reassignEditor } from "@/lib/staff";
import { flagUser, flaggedAccounts, purgeBlockedAccounts, resolveAppeal, setAccountStatus, submitAppeal } from "@/lib/moderation";
import { periodFor, proposeSlot, reviewSlot, schedulablePeriods, withdrawProposal, MAX_APPROVED_PER_LIST } from "@/lib/homepage";
import { topUp } from "@/lib/wallet";
import { canReadChapter } from "@/lib/access";

type R = "READER" | "AUTHOR" | "EDITOR" | "ACCOUNTING" | "ADMIN";
const user = (email: string, role: R = "READER") => db.user.create({ data: { email, displayName: email, role, passwordHash: "x" } });
async function editor(email: string) {
  const u = await user(email, "EDITOR");
  return { u, p: await db.editorProfile.create({ data: { userId: u.id, contactEmail: email, genres: [], languages: [] } }) };
}
const DAY = 86_400_000;

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`);
});
afterAll(() => db.$disconnect());

describe("account types", () => {
  it("only admins change roles, never their own; history is recorded", async () => {
    const admin = await user("a@x.com", "ADMIN"), r = await user("r@x.com"), ed = await user("e@x.com", "EDITOR");
    await expect(changeRole(ed.id, r.id, "EDITOR")).rejects.toThrow(/Admins only/);
    await expect(changeRole(admin.id, admin.id, "READER")).rejects.toThrow(/own account/);
    await changeRole(admin.id, r.id, "EDITOR", "new hire");
    const after = await db.user.findUniqueOrThrow({ where: { id: r.id }, include: { editorProfile: true, roleChanges: true } });
    expect(after.role).toBe("EDITOR");
    expect(after.editorProfile).not.toBeNull();
    expect(after.roleChanges[0]).toMatchObject({ fromRole: "READER", toRole: "EDITOR", note: "new hire" });
  });

  it("protects authors, wallet money and editor workloads", async () => {
    const admin = await user("a@x.com", "ADMIN");
    const author = await user("au@x.com", "AUTHOR");
    await expect(changeRole(admin.id, author.id, "READER")).rejects.toThrow(/keep their role/);

    const rich = await user("rich@x.com");
    await topUp(rich.id, 500, "p1");
    await expect(changeRole(admin.id, rich.id, "ACCOUNTING")).rejects.toThrow(/wallet funds/);

    const a = await editor("e1@x.com"), b = await editor("e2@x.com");
    await db.book.create({ data: { code: "BK1", title: "t", synopsis: "s", language: "en", genres: [], submitterId: author.id, status: "UNDER_REVIEW", reviewingEditorId: a.p.id } });
    await expect(changeRole(admin.id, a.u.id, "READER")).rejects.toThrow(/Reassign/);
    await reassignEditor(admin.id, a.p.id, b.p.id);
    expect((await db.book.findUniqueOrThrow({ where: { code: "BK1" } })).reviewingEditorId).toBe(b.p.id);
    await changeRole(admin.id, a.u.id, "READER");
    expect(await db.wallet.findUnique({ where: { userId: a.u.id } })).not.toBeNull();
  });

  it("creates staff accounts and refuses duplicates or non-staff roles", async () => {
    const admin = await user("a@x.com", "ADMIN");
    const s = await createStaffAccount(admin.id, { email: "Ed@X.com ", displayName: "Ed", role: "EDITOR", passwordHash: "h" });
    expect(s.email).toBe("ed@x.com");
    expect(await db.editorProfile.findUnique({ where: { userId: s.id } })).not.toBeNull();
    await expect(createStaffAccount(admin.id, { email: "ed@x.com", displayName: "Ed", role: "EDITOR", passwordHash: "h" })).rejects.toThrow(/already exists/);
    await expect(createStaffAccount(admin.id, { email: "n@x.com", displayName: "N", role: "READER", passwordHash: "h" })).rejects.toThrow(/editor, accounting or admin/);
  });
});

describe("moderation", () => {
  it("one flag per reporter; most-flagged first; no self-flagging", async () => {
    const [a, b, c, bad, meh] = await Promise.all(["a", "b", "c", "bad", "meh"].map((n) => user(`${n}@x.com`)));
    await flagUser(a.id, bad.id, "spam");
    await flagUser(a.id, bad.id, "spam again"); // updates, doesn't duplicate
    await flagUser(b.id, bad.id, "rude");
    await flagUser(c.id, meh.id, "hmm");
    await expect(flagUser(a.id, a.id, "me")).rejects.toThrow(/yourself/);
    const list = await flaggedAccounts();
    expect(list.map((x) => [x.user.email, x.count])).toEqual([["bad@x.com", 2], ["meh@x.com", 1]]);
  });

  it("restricted users keep their library but can't comment; blocked users lose paid access", async () => {
    const admin = await user("a@x.com", "ADMIN"), r = await user("r@x.com"), other = await user("o@x.com", "ADMIN");
    await expect(setAccountStatus(admin.id, r.id, "RESTRICTED", "")).rejects.toThrow(/reason/);
    await expect(setAccountStatus(admin.id, other.id, "BLOCKED", "x")).rejects.toThrow(/admin/);
    await setAccountStatus(admin.id, r.id, "RESTRICTED", "Spoilers");
    const base = { chapterNumber: 10, lockChapter: 5, authorUserId: null, editorUserId: null, ownsWholeBook: true, ownedSections: [] };
    expect(canReadChapter({ ...base, viewer: { id: r.id, role: "READER", status: "RESTRICTED" } }).allowed).toBe(true);
    expect(canReadChapter({ ...base, viewer: { id: r.id, role: "READER", status: "BLOCKED" } }).allowed).toBe(false);
  });

  it("block → appeal → reinstate", async () => {
    const admin = await user("a@x.com", "ADMIN"), r = await user("r@x.com");
    const now = new Date("2026-11-10T00:00:00Z");
    const blocked = await setAccountStatus(admin.id, r.id, "BLOCKED", "Harassment", { deleteAfterDays: 30, now });
    expect(blocked.deletionScheduledAt?.getTime()).toBe(now.getTime() + 30 * DAY);
    const appeal = await submitAppeal(r.id, "It was my brother, sorry!");
    await expect(submitAppeal(r.id, "And another appeal")).rejects.toThrow(/already have/);
    await resolveAppeal(admin.id, appeal.id, true, "OK, reinstated.");
    const u = await db.user.findUniqueOrThrow({ where: { id: r.id } });
    expect([u.status, u.statusReason, u.deletionScheduledAt]).toEqual(["ACTIVE", null, null]);
  });

  it("purge deletes blocked accounts after the grace period unless an appeal is pending; keeps purchases", async () => {
    const admin = await user("a@x.com", "ADMIN"), r = await user("r@x.com"), appealing = await user("ap@x.com"), au = await user("au@x.com", "AUTHOR");
    const t0 = new Date("2026-01-01T00:00:00Z");
    await setAccountStatus(admin.id, r.id, "BLOCKED", "Spam", { deleteAfterDays: 1, now: t0 });
    await setAccountStatus(admin.id, appealing.id, "BLOCKED", "Spam", { deleteAfterDays: 1, now: t0 });
    await submitAppeal(appealing.id, "Please review my account");
    const book = await db.book.create({ data: { code: "BK1", title: "t", synopsis: "s", language: "en", genres: [], submitterId: au.id, chapters: { create: { number: 1, title: "c", content: "x" } } } });
    const ch = await db.chapter.findFirstOrThrow({ where: { bookId: book.id } });
    await db.comment.create({ data: { chapterId: ch.id, userId: r.id, body: "buy my stuff" } });
    await db.purchase.create({ data: { userId: r.id, bookId: book.id, amountCents: 100 } });

    expect(await purgeBlockedAccounts(new Date(t0.getTime() + DAY / 2))).toBe(0); // too early
    expect(await purgeBlockedAccounts(new Date(t0.getTime() + 2 * DAY))).toBe(1);
    const gone = await db.user.findUniqueOrThrow({ where: { id: r.id } });
    expect(gone.email).toBe(`${r.id}@deleted.invalid`);
    expect(gone.displayName).toBe("Deleted user");
    expect(await db.comment.count({ where: { userId: r.id } })).toBe(0);
    expect(await db.purchase.count({ where: { userId: r.id } })).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: appealing.id } })).email).toBe("ap@x.com");
    expect(await purgeBlockedAccounts(new Date(t0.getTime() + 3 * DAY))).toBe(0); // idempotent
  });
});

describe("homepage scheduling", () => {
  it("periods are fixed two-week windows starting on Mondays", () => {
    const p = periodFor(new Date("2026-11-10T12:00:00Z"));
    expect(p.start.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(p.start.getUTCDay()).toBe(1);
    expect(p.end.getTime() - p.start.getTime()).toBe(14 * DAY);
    expect(periodFor(new Date("2026-11-22T23:59:59Z")).start).toEqual(p.start);
    expect(periodFor(new Date("2026-11-23T00:00:00Z")).start).toEqual(p.end);
    const [cur, next] = schedulablePeriods(new Date("2026-11-10T00:00:00Z"));
    expect([cur.start, next.start]).toEqual([p.start, p.end]);
  });

  async function setup() {
    const admin = await user("a@x.com", "ADMIN"), au = await user("au@x.com", "AUTHOR");
    const mine = await editor("e1@x.com"), other = await editor("e2@x.com");
    const mk = (code: string, editorId: string, status: "ON_SALE" | "ACCEPTED" = "ON_SALE", language = "en") =>
      db.book.create({ data: { code, title: code, synopsis: "s", language, genres: [], submitterId: au.id, status, editorId } });
    return { admin, mine, other, mk };
  }
  const now = new Date("2026-11-10T00:00:00Z");
  const [cur, next] = schedulablePeriods(now);

  it("editors propose their own on-sale books for the current/next period only", async () => {
    const { mine, other, mk } = await setup();
    const b = await mk("BK1", mine.p.id, "ON_SALE", "sn");
    const draft = await mk("BK2", mine.p.id, "ACCEPTED");
    const theirs = await mk("BK3", other.p.id);
    const ed = { editorProfileId: mine.p.id, isAdmin: false };
    const slot = await proposeSlot(ed, { bookId: b.id, list: "FEATURED_LANGUAGE", periodStart: next.start }, now);
    expect([slot.language, slot.startsAt, slot.endsAt]).toEqual(["sn", next.start, next.end]);
    await expect(proposeSlot(ed, { bookId: b.id, list: "FEATURED_LANGUAGE", periodStart: next.start }, now)).rejects.toThrow(/already proposed/);
    await expect(proposeSlot(ed, { bookId: draft.id, list: "POPULAR", periodStart: cur.start }, now)).rejects.toThrow(/on sale/);
    await expect(proposeSlot(ed, { bookId: theirs.id, list: "POPULAR", periodStart: cur.start }, now)).rejects.toThrow(/own books/);
    await expect(proposeSlot(ed, { bookId: b.id, list: "POPULAR", periodStart: new Date(next.end) }, now)).rejects.toThrow(/current or the next/);
    await withdrawProposal(mine.p.id, slot.id);
    expect(await db.homepageSlot.count()).toBe(0);
  });

  it("admins approve up to the per-list cap", async () => {
    const { admin, mine, mk } = await setup();
    const ed = { editorProfileId: mine.p.id, isAdmin: false };
    const slots = [];
    for (let i = 0; i <= MAX_APPROVED_PER_LIST; i++) {
      const b = await mk(`BK${i}`, mine.p.id);
      slots.push(await proposeSlot(ed, { bookId: b.id, list: "EDITORS_PICKS", periodStart: cur.start }, now));
    }
    for (const s of slots.slice(0, -1)) await reviewSlot(admin.id, s.id, true, now);
    await expect(reviewSlot(admin.id, slots.at(-1)!.id, true, now)).rejects.toThrow(/at most/);
    await reviewSlot(admin.id, slots[0].id, false, now); // remove one…
    await reviewSlot(admin.id, slots.at(-1)!.id, true, now); // …makes room
    await expect(reviewSlot(admin.id, slots[1].id, true, new Date(cur.end))).rejects.toThrow(/over/);
  });
});

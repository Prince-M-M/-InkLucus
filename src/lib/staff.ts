import type { Role } from "@prisma/client";
import { db } from "./db";
import { DomainError } from "./errors";

const STAFF: Role[] = ["EDITOR", "ACCOUNTING", "ADMIN"];
const EDITING: Role[] = ["EDITOR", "ADMIN"];

async function requireAdmin(actorId: string) {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.role !== "ADMIN" || actor.status !== "ACTIVE") throw new DomainError("FORBIDDEN", "Admins only");
  return actor;
}

/** What still depends on this editor (must be reassigned before they stop being an editor). */
export async function editorWorkload(editorProfileId: string) {
  const [authors, penNames, books, reviewing] = await Promise.all([
    db.authorProfile.count({ where: { editorId: editorProfileId } }),
    db.penName.count({ where: { editorId: editorProfileId } }),
    db.book.count({ where: { editorId: editorProfileId } }),
    db.book.count({ where: { reviewingEditorId: editorProfileId, status: "UNDER_REVIEW" } }),
  ]);
  return { authors, penNames, books, reviewing, total: authors + penNames + books + reviewing };
}

/**
 * Admin changes an account type.
 * - Author accounts keep their role (they have books and contracts); restrict or block them instead.
 * - Making someone an author goes through the editor "sign author" flow, which assigns their ID code.
 * - Wallet money can't be withdrawn, so readers with a balance can't become staff (staff have no wallets).
 * - Editors must hand over their authors and books before losing editor rights.
 */
export async function changeRole(actorId: string, targetId: string, toRole: Role, note?: string) {
  await requireAdmin(actorId);
  if (actorId === targetId) throw new DomainError("FORBIDDEN", "You can't change your own account type");
  if (toRole === "AUTHOR") throw new DomainError("INVALID", "Use “Sign a new author” in the editor dashboard to create authors");

  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetId }, include: { wallet: true, editorProfile: true } });
    if (!target) throw new DomainError("NOT_FOUND", "User not found");
    if (target.role === toRole) return target;
    if (target.role === "AUTHOR") throw new DomainError("INVALID", "Author accounts keep their role. Restrict or block the account instead");
    if (STAFF.includes(toRole) && (target.wallet?.balanceCents ?? 0) > 0) {
      throw new DomainError("INVALID", "This account still has wallet funds. Staff accounts can't hold a wallet balance");
    }
    if (EDITING.includes(target.role) && !EDITING.includes(toRole) && target.editorProfile) {
      const w = await editorWorkload(target.editorProfile.id);
      if (w.total > 0) throw new DomainError("INVALID", `Reassign this editor's ${w.authors} authors, ${w.books} books and ${w.reviewing} reviews first`);
    }
    if (EDITING.includes(toRole) && !target.editorProfile) {
      await tx.editorProfile.create({ data: { userId: target.id, contactEmail: target.email, genres: [], languages: [] } });
    }
    if (toRole === "READER") await tx.wallet.upsert({ where: { userId: target.id }, update: {}, create: { userId: target.id } });

    await tx.roleChange.create({ data: { userId: target.id, actorId, fromRole: target.role, toRole, note } });
    return tx.user.update({ where: { id: target.id }, data: { role: toRole } });
  });
}

/** Moves everything an editor manages to another editor (e.g. before they leave). */
export async function reassignEditor(actorId: string, fromEditorId: string, toEditorId: string) {
  await requireAdmin(actorId);
  if (fromEditorId === toEditorId) throw new DomainError("INVALID", "Choose a different editor");
  const to = await db.editorProfile.findUnique({ where: { id: toEditorId }, include: { user: true } });
  if (!to || !EDITING.includes(to.user.role)) throw new DomainError("INVALID", "Target is not an active editor");
  return db.$transaction([
    db.authorProfile.updateMany({ where: { editorId: fromEditorId }, data: { editorId: toEditorId } }),
    db.penName.updateMany({ where: { editorId: fromEditorId }, data: { editorId: toEditorId } }),
    db.book.updateMany({ where: { editorId: fromEditorId }, data: { editorId: toEditorId } }),
    db.book.updateMany({ where: { reviewingEditorId: fromEditorId, status: "UNDER_REVIEW" }, data: { reviewingEditorId: toEditorId } }),
  ]);
}

/** Admin creates a staff account directly (password hashed by the caller). */
export async function createStaffAccount(actorId: string, data: { email: string; displayName: string; role: Role; passwordHash: string }) {
  await requireAdmin(actorId);
  if (!STAFF.includes(data.role)) throw new DomainError("INVALID", "Choose editor, accounting or admin");
  const email = data.email.trim().toLowerCase();
  if (await db.user.findUnique({ where: { email } })) throw new DomainError("CONFLICT", "An account with that email already exists. Change its account type instead");
  return db.user.create({
    data: {
      email, displayName: data.displayName.trim(), role: data.role, passwordHash: data.passwordHash,
      ...(EDITING.includes(data.role) ? { editorProfile: { create: { contactEmail: email, genres: [], languages: [] } } } : {}),
      roleChanges: { create: { actorId, fromRole: "READER", toRole: data.role, note: "Staff account created" } },
    },
  });
}

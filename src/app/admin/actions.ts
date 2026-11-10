"use server";
import { redirect } from "next/navigation";
import type { HomepageList, Role } from "@prisma/client";
import { requireRole } from "@/lib/guards";
import { hashPassword } from "@/lib/auth";
import { changeRole, createStaffAccount, reassignEditor } from "@/lib/staff";
import { resolveAppeal, setAccountStatus } from "@/lib/moderation";
import { proposeSlot, reviewSlot } from "@/lib/homepage";
import { int, optStr, runAction, str, type FormState } from "@/lib/form";

const ROLES: Role[] = ["READER", "EDITOR", "ACCOUNTING", "ADMIN"];

export async function changeRoleAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const role = str(form, "role") as Role;
  if (!ROLES.includes(role)) return { error: "Choose an account type" };
  return runAction(() => changeRole(admin.id, str(form, "userId"), role, optStr(form, "note")), "Account type updated.", "/admin");
}

export async function setStatusAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const status = str(form, "status");
  if (status !== "ACTIVE" && status !== "RESTRICTED" && status !== "BLOCKED") return { error: "Choose a status" };
  const days = str(form, "days") ? int(form, "days") : undefined;
  return runAction(() => setAccountStatus(admin.id, str(form, "userId"), status, optStr(form, "reason"), { deleteAfterDays: days }), "Status updated.", "/admin");
}

export async function createStaffAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const password = str(form, "password");
  if (password.length < 10) return { error: "Temporary password must be at least 10 characters" };
  const email = str(form, "email");
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email" };
  const passwordHash = await hashPassword(password);
  return runAction(
    () => createStaffAccount(admin.id, { email, displayName: str(form, "displayName"), role: str(form, "role") as Role, passwordHash }),
    "Staff account created. Share the temporary password with them privately.",
    "/admin",
  );
}

export async function reassignEditorAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  return runAction(() => reassignEditor(admin.id, str(form, "fromEditorId"), str(form, "toEditorId")), "Authors, pen names and books moved.", "/admin");
}

export async function resolveAppealAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const reinstate = str(form, "decision") === "reinstate";
  return runAction(() => resolveAppeal(admin.id, str(form, "appealId"), reinstate, str(form, "resolution")), reinstate ? "Account reinstated." : "Appeal declined.", "/admin");
}

export async function reviewSlotAction(form: FormData) {
  const admin = await requireRole("ADMIN");
  await reviewSlot(admin.id, str(form, "slotId"), str(form, "decision") === "approve").catch((e) => {
    if (e?.name !== "DomainError") throw e;
    redirect(`/admin?tab=homepage&period=${str(form, "period")}&error=${encodeURIComponent(e.message)}`);
  });
  redirect(`/admin?tab=homepage&period=${str(form, "period")}`);
}

export async function adminProposeAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const { db } = await import("@/lib/db");
  const profile = await db.editorProfile.upsert({ where: { userId: admin.id }, update: {}, create: { userId: admin.id, contactEmail: admin.email, genres: [], languages: [] } });
  const book = await db.book.findUnique({ where: { code: str(form, "bookCode").toUpperCase() } });
  if (!book) return { error: "No book with that code" };
  return runAction(
    () => proposeSlot({ editorProfileId: profile.id, isAdmin: true }, { bookId: book.id, list: str(form, "list") as HomepageList, periodStart: new Date(str(form, "period")) }),
    "Added as a proposal. Approve it below.",
    "/admin",
  );
}

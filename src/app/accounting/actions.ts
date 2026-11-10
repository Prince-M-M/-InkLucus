"use server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/guards";
import { addAdjustment, finalizeStatement, generateStatements } from "@/lib/royalties";
import { periodFor } from "@/lib/homepage";
import { adjustWallet } from "@/lib/wallet";
import { flash, runAction, str, type FormState } from "@/lib/form";

const centsSigned = (v: string) => (/^-?\d+(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : NaN);

export async function generateAction(form: FormData) {
  await requireRole("ACCOUNTING");
  const start = new Date(str(form, "periodStart"));
  if (Number.isNaN(start.getTime())) redirect("/accounting?tab=royalties");
  const n = await generateStatements(periodFor(start));
  await flash(`${n} statement${n === 1 ? "" : "s"} calculated.`);
  redirect(`/accounting?tab=royalties&p=${start.toISOString()}`);
}

export async function adjustmentAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireRole("ACCOUNTING");
  const cents = centsSigned(str(form, "amount"));
  if (Number.isNaN(cents)) return { error: "Enter an amount like 5.00 or -2.50" };
  const id = str(form, "statementId");
  return runAction(() => addAdjustment(user.id, id, cents, str(form, "note")), "Adjustment added.", `/accounting/statements/${id}`);
}

export async function finalizeAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireRole("ACCOUNTING");
  const id = str(form, "statementId");
  return runAction(() => finalizeStatement(user.id, id), "Statement finalised. The author can now see it as income.", `/accounting/statements/${id}`);
}

export async function walletAdjustmentAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireRole("ACCOUNTING");
  const target = await db.user.findUnique({ where: { email: str(form, "email").toLowerCase() } });
  if (!target) return { error: "No account with that email" };
  const cents = centsSigned(str(form, "amount"));
  if (Number.isNaN(cents)) return { error: "Enter an amount like 5.00 or -2.50" };
  return runAction(() => adjustWallet(user.id, target.id, cents, str(form, "note")), "Wallet adjusted.", "/accounting");
}

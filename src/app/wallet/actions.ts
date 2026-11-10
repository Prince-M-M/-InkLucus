"use server";
import { redirect } from "next/navigation";
import type { PaymentProvider } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { DomainError } from "@/lib/errors";
import { completePayment, failPayment, startTopUp } from "@/lib/payments";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { dollarsToCents, flash, str, type FormState } from "@/lib/form";

export async function topUpAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!(await rateLimit(`payment:${user.id}`, LIMITS.payment.limit, LIMITS.payment.window))) return { error: "Too many payment attempts. Try again later." };
  const cents = dollarsToCents(str(form, "amount"));
  if (Number.isNaN(cents)) return { error: "Enter an amount like 10.00" };
  let url: string;
  try {
    url = await startTopUp(user, str(form, "provider") as PaymentProvider, cents);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect(url);
}

/** Local development only: simulates the provider confirming the payment. */
export async function devPayAction(form: FormData) {
  const c = config();
  if (c.PAYMENTS_DEV_MODE !== "true" || c.NODE_ENV === "production") throw new Error("Dev payments are disabled");
  const user = await currentUser();
  if (!user) redirect("/login");
  const payment = await db.payment.findUnique({ where: { id: str(form, "paymentId") } });
  if (!payment || payment.userId !== user.id || payment.provider !== "DEV") redirect("/dashboard");
  if (str(form, "outcome") === "fail") await failPayment(payment.id);
  else await completePayment(payment.id, payment.amountCents, `dev:${payment.id}`);
  redirect(`/wallet/return?payment=${payment.id}`);
}

export async function cancelledTopUp() {
  await flash("Top-up cancelled.");
  redirect("/dashboard");
}

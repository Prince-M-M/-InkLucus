import type { PaymentProvider } from "@prisma/client";
import { db } from "../db";
import { config } from "../config";
import { DomainError } from "../errors";
import { MAX_TOP_UP_CENTS, MIN_TOP_UP_CENTS, topUp } from "../wallet";
import { createStripeCheckout } from "./stripe";
import { initiatePaynow } from "./paynow";

export function enabledProviders(): PaymentProvider[] {
  const c = config();
  const list: PaymentProvider[] = [];
  if (c.PAYNOW_INTEGRATION_ID && c.PAYNOW_INTEGRATION_KEY) list.push("PAYNOW");
  if (c.STRIPE_SECRET_KEY && c.STRIPE_WEBHOOK_SECRET) list.push("STRIPE");
  if (c.PAYMENTS_DEV_MODE === "true" && c.NODE_ENV !== "production") list.push("DEV");
  return list;
}

/** Creates a pending payment and returns where to send the user to pay. */
export async function startTopUp(user: { id: string; email: string; role: string; status: string }, provider: PaymentProvider, amountCents: number): Promise<string> {
  if (user.role !== "READER" && user.role !== "AUTHOR") throw new DomainError("FORBIDDEN", "Only reader and author accounts have wallets");
  if (user.status === "BLOCKED") throw new DomainError("FORBIDDEN", "Your account is blocked");
  if (!Number.isInteger(amountCents) || amountCents < MIN_TOP_UP_CENTS || amountCents > MAX_TOP_UP_CENTS) {
    throw new DomainError("INVALID_AMOUNT", `Top up between ${(MIN_TOP_UP_CENTS / 100).toFixed(2)} and ${(MAX_TOP_UP_CENTS / 100).toFixed(2)}`);
  }
  if (!enabledProviders().includes(provider)) throw new DomainError("INVALID", "That payment method isn't available");

  const c = config();
  const payment = await db.payment.create({ data: { userId: user.id, provider, amountCents } });
  const returnUrl = `${c.APP_URL}/wallet/return?payment=${payment.id}`;

  try {
    if (provider === "STRIPE") {
      const s = await createStripeCheckout({
        secretKey: c.STRIPE_SECRET_KEY!, paymentId: payment.id, amountCents, currency: c.CURRENCY, email: user.email,
        successUrl: returnUrl, cancelUrl: `${c.APP_URL}/dashboard?topup=cancelled`,
      });
      await db.payment.update({ where: { id: payment.id }, data: { providerRef: `stripe:${s.id}` } });
      return s.url;
    }
    if (provider === "PAYNOW") {
      const p = await initiatePaynow({
        integrationId: c.PAYNOW_INTEGRATION_ID!, integrationKey: c.PAYNOW_INTEGRATION_KEY!, reference: payment.id, amountCents,
        authEmail: c.PAYNOW_AUTH_EMAIL || user.email, returnUrl, resultUrl: `${c.APP_URL}/api/payments/paynow/result`,
      });
      await db.payment.update({ where: { id: payment.id }, data: { pollUrl: p.pollUrl } });
      return p.browserUrl;
    }
    return `/wallet/dev-pay?payment=${payment.id}`;
  } catch (e) {
    await db.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
    console.error("[payments] start failed", e);
    throw new DomainError("PAYMENT", "Couldn't reach the payment provider. Please try again.");
  }
}

/**
 * Marks a payment paid and credits the wallet exactly once, no matter how many times the
 * provider notifies us. The paid amount must match what we asked for.
 */
export async function completePayment(paymentId: string, paidAmountCents: number, providerRef?: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new DomainError("NOT_FOUND", "Unknown payment");
    if (payment.status === "PAID") return false;
    if (paidAmountCents !== payment.amountCents) {
      console.error(`[payments] amount mismatch for ${paymentId}: expected ${payment.amountCents}, got ${paidAmountCents}`);
      throw new DomainError("AMOUNT_MISMATCH", "Paid amount doesn't match");
    }
    const res = await tx.payment.updateMany({
      where: { id: paymentId, status: { not: "PAID" } },
      data: { status: "PAID", paidAt: new Date(), ...(providerRef && !payment.providerRef ? { providerRef } : {}) },
    });
    if (res.count !== 1) return false;
    await topUp(payment.userId, payment.amountCents, `payment:${payment.id}`, tx);
    return true;
  });
}

export async function failPayment(paymentId: string) {
  await db.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "FAILED" } });
}

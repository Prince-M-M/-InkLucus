import { db } from "../db";
import { config } from "../config";
import { DomainError } from "../errors";
import { completePayment, failPayment } from "./index";
import { verifyStripeSignature } from "./stripe";
import { field, parsePaynowMessage, pollPaynow, verifyPaynowMessage } from "./paynow";

const PAYNOW_PAID = new Set(["paid", "awaiting delivery", "delivered"]);
const PAYNOW_FAILED = new Set(["cancelled", "failed", "disputed", "refunded"]);

type Result = { status: number; body: string };

/** Handles a Stripe webhook request body. Exported separately from the route for testing. */
export async function handleStripeWebhook(rawBody: string, signature: string | null): Promise<Result> {
  const secret = config().STRIPE_WEBHOOK_SECRET;
  if (!secret || !verifyStripeSignature(rawBody, signature, secret)) return { status: 400, body: "bad signature" };
  const event = JSON.parse(rawBody) as { type: string; data: { object: { id: string; client_reference_id?: string; metadata?: { paymentId?: string }; payment_status?: string; amount_total?: number } } };
  const s = event.data.object;
  const paymentId = s.metadata?.paymentId ?? s.client_reference_id;
  if (!paymentId) return { status: 200, body: "ignored" };
  if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && s.payment_status === "paid") {
    try {
      await completePayment(paymentId, s.amount_total ?? -1, `stripe:${s.id}`);
    } catch (e) {
      if (e instanceof DomainError) return { status: 200, body: e.code }; // don't make Stripe retry forever
      throw e;
    }
  } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    await failPayment(paymentId);
  }
  return { status: 200, body: "ok" };
}

/** Handles Paynow's server-to-server status update (resulturl). */
export async function handlePaynowResult(rawBody: string): Promise<Result> {
  const key = config().PAYNOW_INTEGRATION_KEY;
  const fields = parsePaynowMessage(rawBody);
  if (!key || !verifyPaynowMessage(fields, key)) return { status: 400, body: "bad hash" };
  const paymentId = field(fields, "reference");
  const status = (field(fields, "status") ?? "").toLowerCase();
  if (!paymentId) return { status: 400, body: "no reference" };
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.provider !== "PAYNOW") return { status: 404, body: "unknown payment" };
  if (PAYNOW_PAID.has(status)) {
    const cents = Math.round(Number(field(fields, "amount")) * 100);
    try {
      await completePayment(paymentId, cents, `paynow:${field(fields, "paynowreference") ?? paymentId}`);
    } catch (e) {
      if (e instanceof DomainError) return { status: 200, body: e.code };
      throw e;
    }
  } else if (PAYNOW_FAILED.has(status)) {
    await failPayment(paymentId);
  }
  return { status: 200, body: "ok" };
}

/** When the user returns from Paynow, ask Paynow directly in case the callback hasn't arrived yet. */
export async function refreshPaynowPayment(paymentId: string) {
  const key = config().PAYNOW_INTEGRATION_KEY;
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!key || !payment || payment.provider !== "PAYNOW" || payment.status !== "PENDING" || !payment.pollUrl) return;
  try {
    const r = await pollPaynow(payment.pollUrl, key);
    const status = r.status.toLowerCase();
    if (r.reference !== payment.id) return;
    if (PAYNOW_PAID.has(status)) await completePayment(payment.id, Math.round(Number(r.amount) * 100), `paynow:${r.paynowReference || payment.id}`);
    else if (PAYNOW_FAILED.has(status)) await failPayment(payment.id);
  } catch (e) {
    console.error("[payments] paynow poll failed", e);
  }
}

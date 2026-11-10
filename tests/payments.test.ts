import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetConfigCache } from "@/lib/config";
import { completePayment, enabledProviders, startTopUp } from "@/lib/payments";
import { handlePaynowResult, handleStripeWebhook } from "@/lib/payments/handlers";
import { signStripePayload } from "@/lib/payments/stripe";
import { paynowHash } from "@/lib/payments/paynow";
import { makeUser, resetDb, setEnv } from "./helpers";

const balance = async (userId: string) => (await db.wallet.findUnique({ where: { userId } }))?.balanceCents ?? 0;

beforeEach(async () => {
  await resetDb();
  setEnv({ PAYMENTS_DEV_MODE: "true", STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_test", PAYNOW_INTEGRATION_ID: "1234", PAYNOW_INTEGRATION_KEY: "pnkey" });
  resetConfigCache();
});
afterEach(() => {
  setEnv({ PAYMENTS_DEV_MODE: undefined, STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined, PAYNOW_INTEGRATION_ID: undefined, PAYNOW_INTEGRATION_KEY: undefined });
  resetConfigCache();
});
afterAll(() => db.$disconnect());

async function pending(provider: "DEV" | "STRIPE" | "PAYNOW", amountCents = 1000) {
  const u = await makeUser();
  const p = await db.payment.create({ data: { userId: u.id, provider, amountCents } });
  return { u, p };
}

describe("top-ups", () => {
  it("lists configured providers; dev only outside production", () => {
    expect(enabledProviders()).toEqual(["PAYNOW", "STRIPE", "DEV"]);
    setEnv({ PAYMENTS_DEV_MODE: "false", STRIPE_SECRET_KEY: undefined });
    resetConfigCache();
    expect(enabledProviders()).toEqual(["PAYNOW"]);
  });

  it("validates amount, role and status before creating a payment", async () => {
    const r = await makeUser();
    await expect(startTopUp(r, "DEV", 50)).rejects.toThrow(/between/);
    await expect(startTopUp(r, "DEV", 1_000_000)).rejects.toThrow(/between/);
    const ed = await makeUser("EDITOR");
    await expect(startTopUp(ed, "DEV", 1000)).rejects.toThrow(/Only reader and author/);
    const blocked = await makeUser("READER", { status: "BLOCKED" });
    await expect(startTopUp(blocked, "DEV", 1000)).rejects.toThrow(/blocked/);
    const url = await startTopUp(r, "DEV", 1000);
    expect(url).toMatch(/^\/wallet\/dev-pay\?payment=/);
    expect(await db.payment.count({ where: { userId: r.id, status: "PENDING" } })).toBe(1);
  });

  it("credits exactly once, even with concurrent duplicate notifications", async () => {
    const { u, p } = await pending("DEV");
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => completePayment(p.id, 1000)));
    expect(results.filter((r) => r.status === "fulfilled" && r.value === true)).toHaveLength(1);
    expect(await balance(u.id)).toBe(1000);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PAID");
  });

  it("refuses a paid amount that doesn't match", async () => {
    const { u, p } = await pending("DEV");
    await expect(completePayment(p.id, 1)).rejects.toThrow(/doesn't match/);
    expect(await balance(u.id)).toBe(0);
  });
});

describe("Stripe webhook", () => {
  const event = (paymentId: string, amount: number, type = "checkout.session.completed", status = "paid") =>
    JSON.stringify({ type, data: { object: { id: "cs_1", client_reference_id: paymentId, metadata: { paymentId }, payment_status: status, amount_total: amount } } });

  it("credits on a correctly signed completed checkout", async () => {
    const { u, p } = await pending("STRIPE");
    const body = event(p.id, 1000);
    expect(await handleStripeWebhook(body, signStripePayload(body, "whsec_test"))).toEqual({ status: 200, body: "ok" });
    expect(await balance(u.id)).toBe(1000);
    // redelivery is harmless
    await handleStripeWebhook(body, signStripePayload(body, "whsec_test"));
    expect(await balance(u.id)).toBe(1000);
  });

  it("ignores forged requests", async () => {
    const { u, p } = await pending("STRIPE");
    const body = event(p.id, 1000);
    expect((await handleStripeWebhook(body, signStripePayload(body, "attacker"))).status).toBe(400);
    expect((await handleStripeWebhook(body, null)).status).toBe(400);
    expect(await balance(u.id)).toBe(0);
  });

  it("marks expired sessions failed and doesn't credit unpaid ones", async () => {
    const { u, p } = await pending("STRIPE");
    const unpaid = event(p.id, 1000, "checkout.session.completed", "unpaid");
    await handleStripeWebhook(unpaid, signStripePayload(unpaid, "whsec_test"));
    expect(await balance(u.id)).toBe(0);
    const expired = event(p.id, 1000, "checkout.session.expired", "unpaid");
    await handleStripeWebhook(expired, signStripePayload(expired, "whsec_test"));
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("FAILED");
  });
});

describe("Paynow result callback", () => {
  const message = (fields: [string, string][], key = "pnkey") => new URLSearchParams([...fields, ["hash", paynowHash(fields, key)]]).toString();

  it("credits on a correctly hashed Paid status", async () => {
    const { u, p } = await pending("PAYNOW", 1050);
    const body = message([["reference", p.id], ["paynowreference", "PN1"], ["amount", "10.50"], ["status", "Paid"], ["pollurl", "https://www.paynow.co.zw/x"]]);
    expect((await handlePaynowResult(body)).status).toBe(200);
    expect(await balance(u.id)).toBe(1050);
  });

  it("rejects bad hashes and wrong amounts; records failures", async () => {
    const { u, p } = await pending("PAYNOW", 1000);
    expect((await handlePaynowResult(message([["reference", p.id], ["amount", "10.00"], ["status", "Paid"]], "wrong"))).status).toBe(400);
    await handlePaynowResult(message([["reference", p.id], ["amount", "0.01"], ["status", "Paid"]]));
    expect(await balance(u.id)).toBe(0);
    await handlePaynowResult(message([["reference", p.id], ["amount", "10.00"], ["status", "Cancelled"]]));
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("FAILED");
  });

  it("won't complete a payment made with another provider", async () => {
    const { p } = await pending("STRIPE", 1000);
    expect((await handlePaynowResult(message([["reference", p.id], ["amount", "10.00"], ["status", "Paid"]]))).status).toBe(404);
  });
});

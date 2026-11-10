import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Paynow (Zimbabwe: EcoCash, OneMoney, Visa/Mastercard) – implemented from Paynow's
 * "Integration Guide" HTTP interface. Hash = uppercase SHA512 of all field values
 * (in order, excluding "hash") followed by the integration key.
 */
export const PAYNOW_INITIATE_URL = "https://www.paynow.co.zw/interface/initiatetransaction";

export function paynowHash(fields: [string, string][], integrationKey: string): string {
  const concat = fields.filter(([k]) => k.toLowerCase() !== "hash").map(([, v]) => v).join("") + integrationKey;
  return createHash("sha512").update(concat, "utf8").digest("hex").toUpperCase();
}

/** Parses a URL-encoded Paynow message, keeping field order. */
export function parsePaynowMessage(body: string): [string, string][] {
  return [...new URLSearchParams(body).entries()];
}

export function verifyPaynowMessage(fields: [string, string][], integrationKey: string): boolean {
  const hash = fields.find(([k]) => k.toLowerCase() === "hash")?.[1];
  if (!hash) return false;
  const a = Buffer.from(hash.toUpperCase());
  const b = Buffer.from(paynowHash(fields, integrationKey));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const field = (fields: [string, string][], name: string) => fields.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

export async function initiatePaynow(opts: {
  integrationId: string;
  integrationKey: string;
  reference: string;
  amountCents: number;
  authEmail: string;
  returnUrl: string;
  resultUrl: string;
}): Promise<{ browserUrl: string; pollUrl: string }> {
  const fields: [string, string][] = [
    ["id", opts.integrationId],
    ["reference", opts.reference],
    ["amount", (opts.amountCents / 100).toFixed(2)],
    ["additionalinfo", "InkLucus wallet top-up"],
    ["returnurl", opts.returnUrl],
    ["resulturl", opts.resultUrl],
    ["authemail", opts.authEmail],
    ["status", "Message"],
  ];
  fields.push(["hash", paynowHash(fields, opts.integrationKey)]);
  const res = await fetch(PAYNOW_INITIATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const reply = parsePaynowMessage(await res.text());
  const status = field(reply, "status")?.toLowerCase();
  if (status !== "ok") throw new Error(`Paynow error: ${field(reply, "error") ?? status ?? res.status}`);
  if (!verifyPaynowMessage(reply, opts.integrationKey)) throw new Error("Paynow reply failed hash check");
  return { browserUrl: field(reply, "browserurl")!, pollUrl: field(reply, "pollurl")! };
}

/** Asks Paynow for the current status of a transaction (used to confirm result callbacks). */
export async function pollPaynow(pollUrl: string, integrationKey: string) {
  if (!pollUrl.startsWith("https://www.paynow.co.zw/")) throw new Error("Unexpected Paynow poll URL");
  const res = await fetch(pollUrl, { method: "POST" });
  const reply = parsePaynowMessage(await res.text());
  if (!verifyPaynowMessage(reply, integrationKey)) throw new Error("Paynow poll failed hash check");
  return { status: field(reply, "status") ?? "", amount: field(reply, "amount") ?? "", reference: field(reply, "reference") ?? "", paynowReference: field(reply, "paynowreference") ?? "" };
}

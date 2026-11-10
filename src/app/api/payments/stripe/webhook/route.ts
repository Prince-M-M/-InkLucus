import { handleStripeWebhook } from "@/lib/payments/handlers";

export async function POST(req: Request) {
  const r = await handleStripeWebhook(await req.text(), req.headers.get("stripe-signature"));
  return new Response(r.body, { status: r.status });
}

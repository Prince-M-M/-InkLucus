import { handlePaynowResult } from "@/lib/payments/handlers";

export async function POST(req: Request) {
  const r = await handlePaynowResult(await req.text());
  return new Response(r.body, { status: r.status });
}

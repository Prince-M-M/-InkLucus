import { NextResponse } from "next/server";
import { expireGiftCards } from "@/lib/wallet";
import { purgeBlockedAccounts } from "@/lib/moderation";

/**
 * Daily maintenance. Call with `Authorization: Bearer $CRON_SECRET`
 * (e.g. from Vercel Cron, GitHub Actions or a server crontab).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [expiredGiftCards, deletedAccounts] = [await expireGiftCards(), await purgeBlockedAccounts()];
  return NextResponse.json({ expiredGiftCards, deletedAccounts });
}

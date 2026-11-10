import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { expireGiftCards } from "@/lib/wallet";
import { purgeBlockedAccounts } from "@/lib/moderation";
import { pruneRateLimits } from "@/lib/rate-limit";
import { generateStatements, lastCompletedPeriod } from "@/lib/royalties";
import { periodFor } from "@/lib/homepage";

function authorized(header: string | null) {
  const secret = config().CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily maintenance. Call with `Authorization: Bearer $CRON_SECRET`:
 * expires gift cards, deletes blocked accounts past their grace period, prunes rate-limit rows,
 * and refreshes royalty statements for the last finished and the current two-week period.
 */
export async function POST(req: Request) {
  if (!authorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const expiredGiftCards = await expireGiftCards();
  const deletedAccounts = await purgeBlockedAccounts();
  const prunedRateLimits = await pruneRateLimits();
  const statements = (await generateStatements(lastCompletedPeriod())) + (await generateStatements(periodFor(new Date())));
  return NextResponse.json({ expiredGiftCards, deletedAccounts, prunedRateLimits, statements });
}

import Link from "next/link";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { ActionForm } from "@/components/ActionForm";
import { Card, Notice } from "@/components/ui";
import { redeemGiftCardAction } from "@/app/actions";

export const metadata = { title: "Gift card", robots: { index: false } };

/** Shareable gift link: /gift/XXXX-XXXX-XXXX-XXXX */
export default async function GiftPage({ params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code).toUpperCase();
  const user = await currentUser();
  const card = await db.giftCard.findUnique({ where: { code }, select: { amountCents: true, status: true, expiresAt: true, buyer: { select: { displayName: true } } } });
  const valid = card && card.status === "ACTIVE" && card.expiresAt > new Date();
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">🎁 You&apos;ve been sent a gift</h1>
      {!card ? <Notice tone="warn">This gift card doesn&apos;t exist. Check the link.</Notice>
        : !valid ? <Notice tone="warn">This gift card has already been used or has expired.</Notice>
        : (
          <Card>
            <p className="text-lg"><b>{formatCents(card.amountCents)}</b> from {card.buyer.displayName}</p>
            <p className="mb-4 text-sm text-stone-500">Valid until {card.expiresAt.toDateString()}. It goes into your wallet for buying books.</p>
            {!user ? <p className="text-sm"><Link href={`/register`} className="underline">Create an account</Link> or <Link href={`/login?next=/gift/${code}`} className="underline">log in</Link> to redeem it.</p>
              : user.role !== "READER" && user.role !== "AUTHOR" ? <Notice>Only reader and author accounts can use gift cards.</Notice>
              : (
                <ActionForm action={redeemGiftCardAction} submitLabel="Add to my wallet">
                  <input type="hidden" name="code" value={code} />
                </ActionForm>
              )}
          </Card>
        )}
    </div>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { refreshPaynowPayment } from "@/lib/payments/handlers";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PaymentReturn({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const { payment: id } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!id) notFound();
  await refreshPaynowPayment(id);
  const payment = await db.payment.findUnique({ where: { id } });
  if (!payment || payment.userId !== user.id) notFound();
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Wallet top-up</h1>
      {payment.status === "PAID" && <Notice tone="success">{formatCents(payment.amountCents)} has been added to your wallet.</Notice>}
      {payment.status === "FAILED" && <Notice tone="warn">The payment didn&apos;t go through. Nothing was charged to your wallet.</Notice>}
      {payment.status === "PENDING" && (
        <Notice>We&apos;re waiting for the payment provider to confirm. This page updates when you refresh. Mobile money can take a minute.</Notice>
      )}
      <Link href="/dashboard" className="underline">Back to your dashboard</Link>
    </div>
  );
}

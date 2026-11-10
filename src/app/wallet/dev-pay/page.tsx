import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { formatCents } from "@/lib/money";
import { Card, btnCls, btnOutlineCls } from "@/components/ui";
import { devPayAction } from "../actions";

export default async function DevPay({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const c = config();
  if (c.PAYMENTS_DEV_MODE !== "true" || c.NODE_ENV === "production") notFound();
  const user = await currentUser();
  if (!user) redirect("/login");
  const { payment: id } = await searchParams;
  const payment = id ? await db.payment.findUnique({ where: { id } }) : null;
  if (!payment || payment.userId !== user.id) notFound();
  return (
    <div className="mx-auto max-w-md">
      <Card title="Test payment (development only)">
        <p className="mb-4 text-sm">Simulates the payment provider for {formatCents(payment.amountCents)}. No real money moves.</p>
        <form action={devPayAction} className="flex gap-3">
          <input type="hidden" name="paymentId" value={payment.id} />
          <button name="outcome" value="pay" className={btnCls}>Pay</button>
          <button name="outcome" value="fail" className={btnOutlineCls}>Fail</button>
        </form>
      </Card>
    </div>
  );
}

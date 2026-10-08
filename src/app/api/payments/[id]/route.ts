import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { pollPayment } from "@/server/payments/service";

export const dynamic = "force-dynamic";

/** Owner-only payment status for the pay page's live polling. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await params;
  const payment = await pollPayment(id, user.id);
  if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    {
      status: payment.status,
      orderStatus: payment.order.status,
      receipt: payment.receiptNumber,
      failureReason: payment.status === "FAILED" || payment.status === "CANCELLED" || payment.status === "EXPIRED" ? payment.failureReason : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

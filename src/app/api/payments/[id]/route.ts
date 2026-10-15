import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { pollPayment } from "@/server/payments/service";
import { verifyGuestOrderKey } from "@/server/account-setup";

export const dynamic = "force-dynamic";

/** Owner-only payment status for the pay page's live polling (guests prove ownership with their signed order key). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = new URL(request.url).searchParams.get("k");
  let ownerId: string | null = null;
  if (key) {
    const row = await prisma.payment.findUnique({ where: { id }, select: { userId: true, orderId: true } });
    if (row && verifyGuestOrderKey(row.orderId, key)) ownerId = row.userId;
  } else {
    ownerId = (await currentUser())?.id ?? null;
  }
  if (!ownerId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const payment = await pollPayment(id, ownerId);
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

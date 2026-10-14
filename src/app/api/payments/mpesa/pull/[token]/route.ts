import { NextResponse } from "next/server";
import { safeEqual, webhookToken } from "@/server/crypto";
import { rateLimit } from "@/server/rate-limit";
import { syncPulledTransactionsIfEnabled } from "@/server/payments/mpesa-pull";

export const dynamic = "force-dynamic";

/**
 * Callback URL registered with the Daraja Pull Transactions API. The payload is
 * never trusted: a notification only triggers a pull, and every transaction is
 * then read back from Safaricom with our own credentials.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!safeEqual(token, webhookToken("mpesa-pull"))) return NextResponse.json({ ResultCode: 1, ResultDesc: "Rejected" }, { status: 404 });
  await request.text().catch(() => "");
  if (await rateLimit("mpesa-pull:callback", 1, 60)) {
    void syncPulledTransactionsIfEnabled().catch((e) => console.error("[mpesa pull] callback sync", e));
  }
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}

import { NextResponse } from "next/server";
import { safeEqual, webhookToken } from "@/server/crypto";
import { handleProviderCallback } from "@/server/payments/service";

export const dynamic = "force-dynamic";

/**
 * Daraja STK Push callback. The secret path token proves the URL came from us;
 * the payload is then matched to a known CheckoutRequestID, amount-checked and
 * (by default) confirmed with an STK status query before anything is fulfilled.
 * Duplicate deliveries are recorded once and acknowledged without side effects.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!safeEqual(token, webhookToken("mpesa"))) return NextResponse.json({ ResultCode: 1, ResultDesc: "Rejected" }, { status: 404 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 64_000) return NextResponse.json({ ResultCode: 1, ResultDesc: "Payload too large" }, { status: 413 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid JSON" }, { status: 400 });
  }
  const ip = (request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "unknown").trim();
  try {
    const result = await handleProviderCallback("mpesa", body, ip);
    return NextResponse.json({ ResultCode: 0, ResultDesc: result.outcome });
  } catch (error) {
    console.error("[mpesa callback]", error);
    // Non-2xx makes Safaricom retry; the callback row lets the retry resume safely.
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Temporary error" }, { status: 500 });
  }
}

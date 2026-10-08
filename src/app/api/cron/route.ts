import { NextResponse } from "next/server";
import { safeEqual } from "@/server/crypto";
import { runMaintenance } from "@/server/maintenance";

export const dynamic = "force-dynamic";

/**
 * Scheduled housekeeping (payment reconciliation, expiries, reminders).
 * Call every 5 minutes with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16 || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runMaintenance()) });
  } catch (error) {
    console.error("[cron]", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

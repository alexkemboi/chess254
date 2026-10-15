import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { shopOrderPath } from "@/server/shop/links";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { Img as Image } from "@/components/ui/img";
import { formatDateTime, formatMoney } from "@/lib/format";

export const metadata = { title: "My orders" };

export default async function MyOrders() {
  const user = await requireUser("/dashboard/orders");
  const [orders, { timezone }] = await Promise.all([
    prisma.shopOrder.findMany({ where: { userId: user.id }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    getSettings("general"),
  ]);
  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">My orders</h1>
      <p className="mt-1 text-sm text-muted">Merchandise you&apos;ve ordered from the shop.</p>
      <div className="mt-6 grid gap-3">
        {orders.length === 0 ? (
          <EmptyState icon={<ShoppingBag />} title="No orders yet" description="Chess sets, boards and club gear are waiting in the shop." action={<Button asChild><Link href="/shop">Visit the shop</Link></Button>} />
        ) : (
          orders.map((o) => (
            <Link key={o.id} href={shopOrderPath(o.number)} className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 transition hover:border-border-strong">
              <div className="flex -space-x-3">
                {o.items.slice(0, 3).map((i) => (
                  <span key={i.id} className="relative size-12 overflow-hidden rounded-xl border-2 border-surface bg-white">{i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="48px" className="object-cover" />}</span>
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Order {o.number}</div>
                <div className="truncate text-sm text-muted">{o.items.map((i) => `${i.quantity}× ${i.productName}`).join(", ")}</div>
                <div className="text-xs text-muted">{formatDateTime(o.createdAt, timezone)}</div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className="font-mono text-sm font-semibold">{formatMoney(o.total, o.currency)}</span>
                <StatusBadge status={o.status} />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

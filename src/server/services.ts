import "server-only";
import { prisma, type Tx } from "@/server/db";
import { UserError } from "@/server/errors";
import { randomReference } from "@/server/crypto";
import { createOrder } from "@/server/orders";
import { getSettings } from "@/server/settings";
import { notify } from "@/server/notifications";

/** Purchasable one-off services such as clubhouse day passes. */
export async function startServiceCheckout(userId: string, serviceId: string) {
  const service = await prisma.service.findFirst({ where: { id: serviceId, status: "ACTIVE" } });
  if (!service) throw new UserError("This service is not available.");
  if (!service.price.greaterThan(0)) throw new UserError("This service cannot be purchased online.");
  const payments = await getSettings("payments");
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.servicePurchase.create({ data: { code: randomReference("PS"), userId, serviceId } });
    return createOrder(tx, {
      userId,
      currency: service.currency,
      expiresAt: new Date(Date.now() + payments.orderExpiryMinutes * 60_000),
      lines: [{ type: "SERVICE", description: service.name, unitPrice: service.price, serviceId: service.id, servicePurchaseId: purchase.id }],
    });
  });
}

export async function fulfilService(tx: Tx, purchaseId: string) {
  const purchase = await tx.servicePurchase.findUnique({ where: { id: purchaseId }, include: { service: true } });
  if (!purchase || purchase.status === "ACTIVE" || purchase.status === "REDEEMED") return null;
  const now = new Date();
  await tx.servicePurchase.update({
    where: { id: purchase.id },
    data: { status: "ACTIVE", validFrom: now, validUntil: new Date(now.getTime() + purchase.service.validityHours * 3600_000) },
  });
  return notify(
    { userId: purchase.userId, type: "PAYMENT_CONFIRMED", title: `${purchase.service.name} ready`, body: `Show code ${purchase.code} at the front desk.`, link: "/dashboard/passes" },
    tx,
  );
}

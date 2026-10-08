"use server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertUser } from "@/server/auth";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import { startMembershipCheckout } from "@/server/memberships";
import { startServiceCheckout } from "@/server/services";
import { expireOrder, startPayment } from "@/server/payments/service";
import { releaseOrderHolds } from "@/server/orders";

const id = z.string().min(1).max(40);

export async function checkoutPlanAction(planId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const order = await startMembershipCheckout(user.id, id.parse(planId));
    return { ok: true, message: "Order created", redirect: `/pay/${order.id}` };
  });
}

export async function checkoutServiceAction(serviceId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const order = await startServiceCheckout(user.id, id.parse(serviceId));
    return { ok: true, message: "Order created", redirect: `/pay/${order.id}` };
  });
}

export async function payOrderAction(orderId: string, formData: FormData): Promise<ActionResult<{ paymentId: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const { phone } = parseForm(z.object({ phone: z.string().trim().min(9, "Enter your M-Pesa number").max(20) }), formData);
    const payment = await startPayment(user.id, id.parse(orderId), phone);
    await prisma.user.updateMany({ where: { id: user.id, phone: null }, data: { phone } });
    return { ok: true, message: "Check your phone and enter your M-Pesa PIN.", data: { paymentId: payment.id } };
  });
}

export async function cancelOrderAction(orderId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const order = await prisma.order.findFirst({ where: { id: id.parse(orderId), userId: user.id }, include: { payments: true } });
    if (!order) throw new UserError("Order not found.");
    if (order.status !== "PENDING") throw new UserError("Only unpaid orders can be cancelled.");
    if (order.payments.some((p) => p.status === "PROCESSING")) throw new UserError("A payment is in progress. Please wait for it to finish.");
    if (order.expiresAt && order.expiresAt < new Date()) {
      await expireOrder(order.id);
      return { ok: true, message: "Order closed.", redirect: "/dashboard/payments" };
    }
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({ where: { id: order.id, status: "PENDING" }, data: { status: "CANCELLED" } });
      if (count) await releaseOrderHolds(tx, order.id, "CANCELLED");
    });
    return { ok: true, message: "Order cancelled.", redirect: "/dashboard/payments" };
  });
}

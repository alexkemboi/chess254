"use server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { clientIp } from "@/server/audit";
import { rateLimit } from "@/server/rate-limit";
import { runAction, UserError, type ActionResult } from "@/server/errors";
import { guestCheckoutPath, guestOrderKey } from "@/server/account-setup";
import { startPayment } from "@/server/payments/service";
import { formatMoney } from "@/lib/format";
import { registrationPath, startRegistrationPayment, submitFormRegistration, verifyRegistrationKey } from "@/server/event-registrations";
import { parseFormFields, type RawAnswers } from "@/lib/event-form";

const id = z.string().min(1).max(40);
const reference = z.string().trim().toUpperCase().regex(/^[A-Z]{2}-[A-Z0-9]{4,10}$/);

/** Public registration form for FORM-mode events. Works with or without an account. */
export async function submitEventFormAction(eventId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    if (!(await rateLimit(`event-form:${await clientIp()}`, 20, 3600))) throw new UserError("Too many registrations from this network. Please try again later.");
    const event = await prisma.event.findUnique({ where: { id: id.parse(eventId) }, select: { formFields: true } });
    if (!event) throw new UserError("Event not found.");
    const answers: RawAnswers = {};
    for (const field of parseFormFields(event.formFields)) {
      const values = formData.getAll(field.key).map(String);
      answers[field.key] = field.type === "checkboxes" ? values : values[0];
    }
    const selections: Record<string, string> = {};
    for (const [name, value] of formData.entries()) {
      if (name.startsWith("session:") && typeof value === "string" && value) selections[name.slice(8)] = value.slice(0, 40);
    }
    const viewer = await currentUser();
    const { registration } = await submitFormRegistration(eventId, { answers, selections }, viewer?.id ?? null);
    return { ok: true, message: `Registered — reference ${registration.reference}`, redirect: `${registrationPath(registration.reference)}&new=1` };
  });
}

/** Starts an M-Pesa checkout for some or all unpaid sessions of a registration. */
export async function payRegistrationAction(ref: string, key: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const code = reference.parse(ref);
    if (!verifyRegistrationKey(code, key)) throw new UserError("This booking link is not valid.");
    if (!(await rateLimit(`event-pay:${code}`, 15, 3600))) throw new UserError("Please wait a little before trying again.");
    const itemIds = formData.getAll("item").map(String).filter(Boolean).slice(0, 50);
    if (!itemIds.length) throw new UserError("Tick at least one item to pay for.");
    const order = await startRegistrationPayment(code, itemIds);
    return { ok: true, message: "Order created", redirect: guestCheckoutPath(order.id) };
  });
}

/** Booking page: create (or reuse) the order for the chosen weeks and send the STK prompt in one step. */
export async function mpesaRegistrationAction(ref: string, key: string, itemIds: string[], phone: string): Promise<ActionResult<{ orderId: string; orderKey: string; paymentId: string; amountLabel: string }>> {
  return runAction(async () => {
    const code = reference.parse(ref);
    if (!verifyRegistrationKey(code, key)) throw new UserError("This booking link is not valid.");
    if (!(await rateLimit(`event-pay:${code}`, 15, 3600))) throw new UserError("Please wait a little before trying again.");
    const ids = z.array(id).min(1, "Tick at least one week to pay for.").max(50).parse(itemIds);
    const number = z.string().trim().min(9, "Enter the M-Pesa number to send the prompt to").max(20).parse(phone);
    const order = await startRegistrationPayment(code, ids);
    const payment = await startPayment(order.userId, order.id, number);
    return { ok: true, message: "Check your phone and enter your M-Pesa PIN.", data: { orderId: order.id, orderKey: guestOrderKey(order.id), paymentId: payment.id, amountLabel: formatMoney(Math.ceil(order.total.toNumber()), order.currency) } };
  });
}

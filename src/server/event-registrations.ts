import "server-only";
import { Prisma, type RegistrationStatus } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import { UserError } from "@/server/errors";
import { randomReference, safeEqual, signedKey } from "@/server/crypto";
import { createOrder } from "@/server/orders";
import { getAllSettings, siteUrl } from "@/server/settings";
import { alertAdmins, notify, sendEmail } from "@/server/notifications";
import { findOrCreateContactUser } from "@/server/account-setup";
import { registrationClosedReason } from "@/server/events";
import { parseFormFields, validateAnswers, type RawAnswers } from "@/lib/event-form";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Form registrations: any published event in FORM mode gets a public form built
 * from its own fields, sessions and packages. Each booked session is a
 * registration item; payments (M-Pesa or staff-verified) mark items paid and
 * the registration's fee status follows: UNPAID → PARTIAL → PAID.
 */

const HOLDING: RegistrationStatus[] = ["PENDING", "CONFIRMED", "ATTENDED"];
const DUE_SOON_DAYS = 3;

export const formEventInclude = {
  location: true,
  sessions: { orderBy: [{ position: "asc" }, { startsAt: "asc" }] },
  packages: { orderBy: [{ position: "asc" }, { price: "asc" }] },
} satisfies Prisma.EventInclude;
export type FormEvent = Prisma.EventGetPayload<{ include: typeof formEventInclude }>;

// ─── Access links ─────────────────────────────────────────────────────────

export function registrationKey(reference: string) {
  return signedKey("event-registration", reference);
}

export function verifyRegistrationKey(reference: string, key: string | null | undefined) {
  return Boolean(key) && safeEqual(key!, registrationKey(reference));
}

export function registrationPath(reference: string) {
  return `/registrations/${reference}?k=${registrationKey(reference)}`;
}

// ─── Deadlines ────────────────────────────────────────────────────────────

export type DeadlineState = "none" | "ok" | "soon" | "passed";

export function deadlineState(deadline: Date | null, now = new Date()): DeadlineState {
  if (!deadline) return "none";
  if (deadline < now) return "passed";
  if (deadline.getTime() - now.getTime() < DUE_SOON_DAYS * 86400_000) return "soon";
  return "ok";
}

// ─── Capacity ─────────────────────────────────────────────────────────────

const holdingRegistration = (now = new Date()): Prisma.EventRegistrationWhereInput => ({
  status: { in: HOLDING },
  OR: [{ status: { not: "PENDING" } }, { holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
});

/** Places taken per session for a form event. */
export async function sessionsTaken(eventId: string, db: Tx | typeof prisma = prisma) {
  const rows = await db.eventRegistrationItem.groupBy({
    by: ["sessionId"],
    where: { session: { eventId }, registration: holdingRegistration() },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.sessionId, r._count._all]));
}

/** "From KSh 4,500 / week" for events priced by package. */
export function packagePriceLabel(event: { currency: string; sessionLabel: string; packages: { price: Prisma.Decimal }[] }) {
  const prices = event.packages.map((p) => p.price).filter((p) => p.greaterThan(0));
  if (!prices.length) return event.packages.length ? "Free" : null;
  const min = prices.reduce((a, b) => (b.lessThan(a) ? b : a));
  const all = prices.every((p) => p.equals(min));
  return `${all ? "" : "From "}${formatMoney(min, event.currency)} / ${event.sessionLabel.toLowerCase()}`;
}

// ─── Submitting a registration ────────────────────────────────────────────

type Submission = { answers: RawAnswers; selections: Record<string, string> };

/** Finds the account a form registration belongs to without ever signing anyone in. */
const contactUser = (viewerId: string | null, contact: { name: string; email: string; phone: string }) => findOrCreateContactUser(viewerId, contact, "contact_email");

export async function submitFormRegistration(eventId: string, input: Submission, viewerId: string | null) {
  const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null, archivedAt: null }, include: formEventInclude });
  if (!event || event.registrationMode !== "FORM") throw new UserError("Event not found.");
  const closed = registrationClosedReason(event);
  if (closed) throw new UserError(closed);

  const fields = parseFormFields(event.formFields);
  const { errors, answers, roles } = validateAnswers(fields, input.answers);
  const now = new Date();

  // Session / package choices.
  const chosen: { session: FormEvent["sessions"][number]; pkg: FormEvent["packages"][number] }[] = [];
  if (event.sessions.length) {
    for (const session of event.sessions) {
      const packageId = input.selections[session.id];
      if (!packageId) continue;
      const pkg = event.packages.find((p) => p.id === packageId);
      if (!pkg) throw new UserError("One of the selected packages is no longer available. Please reload the page.");
      if (session.endsAt < now) throw new UserError(`${session.label} has already finished.`);
      chosen.push({ session, pkg });
    }
    const min = Math.max(1, event.minSessions);
    if (chosen.length < min) errors.sessions = `Select at least ${min} ${event.sessionLabel.toLowerCase()}${min > 1 ? "s" : ""}`;
  }
  if (Object.keys(errors).length) throw new UserError("Please check the highlighted fields.", errors);

  const contact = {
    name: roles.contactName ?? roles.participantName ?? "",
    email: (roles.contactEmail ?? "").toLowerCase(),
    phone: roles.contactPhone ?? "",
  };
  if (!contact.name || !contact.email) throw new UserError("This form is missing its contact fields. Please contact the club.");
  const participantName = roles.participantName ?? contact.name;
  const userId = await contactUser(viewerId, contact);
  const total = chosen.reduce((sum, c) => sum.plus(c.pkg.price), new Prisma.Decimal(0));
  const free = !total.greaterThan(0);

  const registration = await prisma.$transaction(async (tx) => {
    // Row lock serialises registrations so capacities can never be exceeded.
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${event.id} FOR UPDATE`;
    const duplicate = await tx.eventRegistration.findFirst({
      where: { eventId: event.id, contactEmail: contact.email, participantName: { equals: participantName, mode: "insensitive" }, ...holdingRegistration(now) },
    });
    if (duplicate) throw new UserError(`${participantName} is already registered for this event (reference ${duplicate.reference}). Check your email for the booking link.`);
    if (event.capacity !== null) {
      const taken = await tx.eventRegistration.count({ where: { eventId: event.id, ...holdingRegistration(now) } });
      if (taken >= event.capacity) throw new UserError("This event is full.");
    }
    if (chosen.some((c) => c.session.capacity !== null)) {
      const taken = await sessionsTaken(event.id, tx);
      for (const c of chosen) {
        if (c.session.capacity !== null && (taken.get(c.session.id) ?? 0) >= c.session.capacity) throw new UserError(`${c.session.label} is full. Please choose another ${event.sessionLabel.toLowerCase()}.`, { sessions: `${c.session.label} is full` });
      }
    }
    const tz = (await getAllSettings()).general.timezone;
    return tx.eventRegistration.create({
      data: {
        reference: randomReference("EV"),
        eventId: event.id,
        userId,
        status: free ? "CONFIRMED" : "PENDING",
        feeStatus: free ? "PAID" : "UNPAID",
        price: total,
        currency: event.currency,
        participantName,
        contactName: contact.name,
        contactEmail: contact.email,
        contactPhone: contact.phone || null,
        answers: answers as unknown as Prisma.InputJsonValue,
        paymentMethod: roles.paymentMethod ?? null,
        declaredReference: roles.declaredPaid && /^y/i.test(roles.declaredPaid) ? (roles.paymentReference ?? null) : null,
        items: {
          create: chosen.map((c) => ({
            sessionId: c.session.id,
            packageId: c.pkg.id,
            price: c.pkg.price,
            description: `${c.session.label} (${sessionDates(c.session, tz)}) — ${c.pkg.name}`,
          })),
        },
      },
      include: { items: true },
    });
  });

  await sendRegistrationEmail(registration.id).catch((e) => console.error("[events] confirmation email", e));
  await alertAdmins(
    `New registration: ${event.title}`,
    `${participantName} (${contact.name}, ${contact.phone || contact.email}) registered — ${registration.reference}, fee ${formatMoney(total, event.currency)}.`,
    `/admin/registrations/${registration.id}`,
  ).catch((e) => console.error("[events] admin alert", e));
  return { registration, event };
}

export function sessionDates(session: { startsAt: Date; endsAt: Date }, tz: string) {
  const start = formatDate(session.startsAt, tz, { day: "numeric", month: "short" });
  const end = formatDate(session.endsAt, tz, { day: "numeric", month: "short" });
  return start === end ? start : `${start} – ${end}`;
}

/** Booking summary + payment instructions + private link, sent to the contact email. */
export async function sendRegistrationEmail(registrationId: string) {
  const reg = await prisma.eventRegistration.findUnique({ where: { id: registrationId }, include: { event: true, items: { include: { session: true }, orderBy: { session: { position: "asc" } } } } });
  if (!reg || !reg.contactEmail) return false;
  const tz = (await getAllSettings()).general.timezone;
  const lines = reg.items.map((i) => {
    const due = i.session.paymentDeadline ? ` — pay by ${formatDate(i.session.paymentDeadline, tz, { day: "numeric", month: "short" })}` : "";
    return `• ${i.description}: ${formatMoney(i.price, reg.currency)}${i.paidAt ? " (paid)" : due}`;
  });
  const body = [
    `Hi ${reg.contactName?.split(" ")[0] ?? "there"}, thank you for registering ${reg.participantName ?? ""} for ${reg.event.title}.`,
    `Registration ID: ${reg.reference}`,
    lines.length ? `Booking summary:\n${lines.join("\n")}\nTotal: ${formatMoney(reg.price, reg.currency)}` : "",
    reg.event.confirmationMessage ?? "",
    reg.price.greaterThan(reg.amountPaid) && reg.event.paymentInstructions ? `How to pay:\n${reg.event.paymentInstructions}` : "",
    "Your registration is confirmed once payment has been verified. Use the link below to view your booking or pay with M-Pesa.",
  ].filter(Boolean).join("\n\n");
  return sendEmail(reg.contactEmail, `${reg.event.title} — registration ${reg.reference}`, body, `${await siteUrl()}${registrationPath(reg.reference)}`, "View booking & pay");
}

// ─── Payments ─────────────────────────────────────────────────────────────

/** Creates an M-Pesa order for the chosen unpaid items (all unpaid items when none are chosen). */
export async function startRegistrationPayment(reference: string, itemIds: string[]) {
  const settings = await getAllSettings();
  return prisma.$transaction(async (tx) => {
    const reg = await tx.eventRegistration.findUnique({ where: { reference }, include: { event: true, items: { include: { session: true } } } });
    if (!reg) throw new UserError("Registration not found.");
    if (!["PENDING", "CONFIRMED"].includes(reg.status)) throw new UserError(`This registration is ${reg.status.toLowerCase()}.`);
    if (!reg.event.onlinePayment) throw new UserError("Online payment is not available for this event. Please follow the payment instructions.");
    const unpaid = reg.items.filter((i) => !i.paidAt && i.price.greaterThan(0));
    const selected = itemIds.length ? unpaid.filter((i) => itemIds.includes(i.id)) : unpaid;
    if (!selected.length) throw new UserError(unpaid.length ? "Choose what you'd like to pay for." : "Nothing is left to pay on this registration.");
    selected.sort((a, b) => a.session.position - b.session.position || a.session.startsAt.getTime() - b.session.startsAt.getTime());

    // Reuse an open order for exactly the same items instead of stacking duplicates.
    const open = await tx.order.findMany({ where: { status: "PENDING", expiresAt: { gt: new Date() }, items: { some: { eventRegistrationItemId: { in: selected.map((i) => i.id) } } } }, include: { items: true } });
    const same = open.find((o) => o.items.length === selected.length && o.items.every((oi) => selected.some((s) => s.id === oi.eventRegistrationItemId)));
    if (same) return same;
    for (const o of open) await tx.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });

    return createOrder(tx, {
      userId: reg.userId,
      currency: reg.currency,
      expiresAt: new Date(Date.now() + Math.max(30, settings.booking.holdMinutes) * 60_000),
      lines: selected.map((i) => ({ type: "EVENT", description: `${reg.event.title}: ${i.description}${reg.participantName ? ` · ${reg.participantName}` : ""}`, unitPrice: i.price, eventId: reg.eventId, eventRegistrationItemId: i.id })),
    });
  });
}

/** Recomputes amount paid, fee status and confirmation from the items. */
async function refreshFeeStatus(tx: Tx, registrationId: string) {
  const reg = await tx.eventRegistration.findUniqueOrThrow({ where: { id: registrationId }, include: { items: true } });
  const paid = reg.items.filter((i) => i.paidAt).reduce((s, i) => s.plus(i.price), new Prisma.Decimal(0));
  const feeStatus = paid.greaterThanOrEqualTo(reg.price) ? "PAID" : paid.greaterThan(0) ? "PARTIAL" : "UNPAID";
  return tx.eventRegistration.update({
    where: { id: registrationId },
    data: { amountPaid: paid, feeStatus, ...(reg.status === "PENDING" && paid.greaterThan(0) ? { status: "CONFIRMED", holdExpiresAt: null } : {}) },
    include: { event: true },
  });
}

/**
 * Marks items paid and writes a ledger record per registration. Used by M-Pesa
 * fulfilment and by staff verifying bank / cash payments. Items that were
 * already paid are reported back so the caller can flag a refund.
 */
export async function recordItemPayments(tx: Tx, itemIds: string[], payment: { method: string; reference?: string | null; note?: string | null; paymentId?: string | null; recordedById?: string | null }) {
  const items = await tx.eventRegistrationItem.findMany({ where: { id: { in: itemIds } }, include: { registration: true } });
  const now = new Date();
  const byReg = new Map<string, typeof items>();
  const alreadyPaid: typeof items = [];
  for (const item of items) {
    if (item.paidAt) {
      alreadyPaid.push(item);
      continue;
    }
    byReg.set(item.registrationId, [...(byReg.get(item.registrationId) ?? []), item]);
  }
  const updated = [];
  for (const [registrationId, group] of byReg) {
    await tx.eventRegistrationItem.updateMany({ where: { id: { in: group.map((i) => i.id) }, paidAt: null }, data: { paidAt: now } });
    const amount = group.reduce((s, i) => s.plus(i.price), new Prisma.Decimal(0));
    await tx.eventPaymentRecord.create({ data: { registrationId, amount, method: payment.method, reference: payment.reference ?? null, note: payment.note ?? null, paymentId: payment.paymentId ?? null, recordedById: payment.recordedById ?? null } });
    const reg = await refreshFeeStatus(tx, registrationId);
    updated.push({ registration: reg, amount, items: group });
  }
  return { updated, alreadyPaid };
}

/** Fulfilment hook for paid orders containing registration items. Returns notification ids. */
export async function fulfilRegistrationItems(tx: Tx, input: { userId: string; itemIds: string[]; paymentId: string; refunds: string[]; orderNumber: string }) {
  const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { receiptNumber: true } });
  const { updated, alreadyPaid } = await recordItemPayments(tx, input.itemIds, { method: "M-Pesa", reference: payment?.receiptNumber, paymentId: input.paymentId });
  for (const item of alreadyPaid) input.refunds.push(`Order ${input.orderNumber}: ${item.description} (${item.registration.reference}) was already paid.`);
  const ids: string[] = [];
  for (const u of updated) {
    const left = u.registration.price.minus(u.registration.amountPaid);
    const body = `${formatMoney(u.amount, u.registration.currency)} received for ${u.registration.participantName ?? "your registration"} (${u.registration.reference}).${left.greaterThan(0) ? ` Balance: ${formatMoney(left, u.registration.currency)}.` : " Fully paid — see you there!"}`;
    ids.push((await notify({ userId: input.userId, type: "EVENT_REGISTERED", title: `${u.registration.event.title}: payment received`, body, link: registrationPath(u.registration.reference) }, tx)).id);
  }
  return ids;
}

export function feeStatusLabel(status: string) {
  return status === "PARTIAL" ? "Partially paid" : status === "PAID" ? "Paid" : "Pending payment";
}

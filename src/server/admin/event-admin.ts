import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import { UserError } from "@/server/errors";
import { parseFormFields, type EventFormField } from "@/lib/event-form";

export type SessionRow = { id?: string; label: string; startsAt: Date; endsAt: Date; paymentDeadline: Date | null; capacity: number | null };
export type PackageRow = { id?: string; name: string; price: number; description: string | null };

/** Problems that stop a FORM event from taking registrations (checked on save and on publish). */
export function formEventProblems(input: { registrationMode: string; formFields: EventFormField[]; sessions: { label: string }[]; packages: unknown[] }) {
  if (input.registrationMode !== "FORM") return [];
  const problems: string[] = [];
  const roles = new Set(input.formFields.map((f) => f.role));
  if (!roles.has("contactName")) problems.push("the form needs a field with the role “Contact name”");
  if (!roles.has("contactEmail")) problems.push("the form needs a field with the role “Contact email”");
  if (input.sessions.length && !input.packages.length) problems.push("add at least one package for the sessions");
  return problems;
}

/** Updates sessions / packages in place so existing registrations keep pointing at them. */
export async function syncSessionsAndPackages(tx: Tx, eventId: string, sessions: SessionRow[], packages: PackageRow[]) {
  const [oldSessions, oldPackages] = await Promise.all([
    tx.eventSession.findMany({ where: { eventId }, include: { _count: { select: { items: true } } } }),
    tx.eventPackage.findMany({ where: { eventId }, include: { _count: { select: { items: true } } } }),
  ]);
  const keepS = new Set(sessions.map((s) => s.id).filter(Boolean));
  for (const s of oldSessions) {
    if (keepS.has(s.id)) continue;
    if (s._count.items) throw new UserError(`“${s.label}” already has registrations and can't be removed. Set its capacity instead.`);
    await tx.eventSession.delete({ where: { id: s.id } });
  }
  for (const [position, s] of sessions.entries()) {
    const data = { label: s.label, startsAt: s.startsAt, endsAt: s.endsAt, paymentDeadline: s.paymentDeadline, capacity: s.capacity, position };
    if (s.id && oldSessions.some((o) => o.id === s.id)) await tx.eventSession.update({ where: { id: s.id }, data });
    else await tx.eventSession.create({ data: { ...data, eventId } });
  }
  const keepP = new Set(packages.map((p) => p.id).filter(Boolean));
  for (const p of oldPackages) {
    if (keepP.has(p.id)) continue;
    if (p._count.items) throw new UserError(`The “${p.name}” package already has registrations and can't be removed.`);
    await tx.eventPackage.delete({ where: { id: p.id } });
  }
  for (const [position, p] of packages.entries()) {
    const data = { name: p.name, price: p.price, description: p.description, position };
    if (p.id && oldPackages.some((o) => o.id === p.id)) await tx.eventPackage.update({ where: { id: p.id }, data });
    else await tx.eventPackage.create({ data: { ...data, eventId } });
  }
}

async function uniqueSlug(base: string) {
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? `${base}-copy` : `${base}-copy-${i}`;
    if (!(await prisma.event.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Copies an event with its form, sessions and packages as a new draft (no registrations). */
export async function duplicateEvent(id: string) {
  const e = await prisma.event.findFirst({ where: { id, deletedAt: null }, include: { sessions: true, packages: true } });
  if (!e) throw new UserError("Event not found.");
  const slug = await uniqueSlug(e.slug.replace(/-copy(-\d+)?$/, ""));
  const { id: _id, createdAt: _c, updatedAt: _u, sessions, packages, ...rest } = e;
  void _id; void _c; void _u;
  return prisma.event.create({
    data: {
      ...rest,
      title: `${e.title} (copy)`,
      slug,
      status: "DRAFT",
      featured: false,
      archivedAt: null,
      formFields: parseFormFields(e.formFields) as unknown as Prisma.InputJsonValue,
      sessions: { create: sessions.map(({ label, startsAt, endsAt, paymentDeadline, capacity, position }) => ({ label, startsAt, endsAt, paymentDeadline, capacity, position })) },
      packages: { create: packages.map(({ name, price, description, position }) => ({ name, price, description, position })) },
    },
  });
}

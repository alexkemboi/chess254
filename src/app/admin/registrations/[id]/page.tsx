import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Lock } from "lucide-react";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/rbac";
import { getSettings } from "@/server/settings";
import { feeStatusLabel, registrationPath, sessionDates } from "@/server/event-registrations";
import { PageHeader } from "@/components/ui/misc";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/forms/action-form";
import { ActionButton, FormDialog } from "@/components/admin/admin-ui";
import { adminCancelRegistrationAction, checkInRegistrationAction } from "@/actions/admin";
import { recordRegistrationPaymentAction, resendRegistrationEmailAction } from "@/actions/admin-events";
import { answerText, type StoredAnswer } from "@/lib/event-form";
import { formatDateTime, formatMoney } from "@/lib/format";

export const metadata = { title: "Registration" };

export default async function RegistrationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("events.manage", `/admin/registrations/${id}`);
  const reg = await prisma.eventRegistration.findUnique({
    where: { id },
    include: {
      event: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
      items: { include: { session: true, package: true, orderItems: { include: { order: { select: { id: true, number: true, status: true } } } } } },
      paymentRecords: { orderBy: { createdAt: "asc" } },
      orderItem: { include: { order: { select: { id: true, number: true, status: true } } } },
    },
  });
  if (!reg) notFound();
  const sensitive = await can(user.role, "events.sensitive");
  const { timezone: tz } = await getSettings("general");
  const items = [...reg.items].sort((a, b) => a.session.position - b.session.position);
  const unpaid = items.filter((i) => !i.paidAt && i.price.greaterThan(0));
  const answers = (reg.answers ?? []) as StoredAnswer[];
  const sections = [...new Set(answers.map((a) => a.section || "Details"))];
  const recorders = await prisma.user.findMany({ where: { id: { in: reg.paymentRecords.map((p) => p.recordedById).filter((v): v is string => Boolean(v)) } }, select: { id: true, name: true } });
  const active = reg.status === "PENDING" || reg.status === "CONFIRMED";

  return (
    <div className="max-w-5xl">
      <Link href={`/admin/registrations?event=${reg.eventId}`} className="text-sm text-muted hover:text-foreground">← {reg.event.title}</Link>
      <div className="mt-4">
        <PageHeader
          title={reg.participantName ?? reg.user.name}
          description={`${reg.reference} · registered ${formatDateTime(reg.createdAt, tz)}`}
          actions={
            <>
              {reg.contactEmail && <ActionButton action={resendRegistrationEmailAction.bind(null, reg.id)}>Resend booking email</ActionButton>}
              {reg.event.registrationMode === "FORM" && <Button asChild variant="secondary" size="sm"><Link href={registrationPath(reg.reference)} target="_blank"><ExternalLink />Parent view</Link></Button>}
              {reg.status === "CONFIRMED" && <ActionButton action={checkInRegistrationAction.bind(null, reg.id)}>Check in</ActionButton>}
              {active && <ActionButton action={adminCancelRegistrationAction.bind(null, reg.id)} variant="danger" confirm="Cancel this registration? The registrant is notified.">Cancel</ActionButton>}
            </>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={reg.status} />
            {reg.price.greaterThan(0) && <Badge variant={reg.feeStatus === "PAID" ? "success" : reg.feeStatus === "PARTIAL" ? "default" : "warning"}>{feeStatusLabel(reg.feeStatus)}</Badge>}
            {reg.checkedInAt && <span className="text-xs text-muted">Checked in {formatDateTime(reg.checkedInAt, tz)}</span>}
          </div>
          {items.length > 0 ? (
            <ul className="mt-4 divide-y divide-border">
              {items.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">{i.session.label} · {i.package.name}</div>
                    <div className="text-xs text-muted">{sessionDates(i.session, tz)}{i.session.paymentDeadline ? ` · pay by ${formatDateTime(i.session.paymentDeadline, tz)}` : ""}</div>
                    {i.orderItems.length > 0 && <div className="mt-1 text-xs text-muted">Orders: {i.orderItems.map((o) => <span key={o.order.id} className="mr-2 font-mono">{o.order.number} ({o.order.status.toLowerCase()})</span>)}</div>}
                  </div>
                  <div className="text-right">
                    <div className="font-mono">{formatMoney(i.price, reg.currency)}</div>
                    <div className={i.paidAt ? "text-xs font-semibold text-success" : "text-xs text-warning"}>{i.paidAt ? `Paid ${formatDateTime(i.paidAt, tz)}` : "Unpaid"}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : reg.orderItem ? (
            <p className="mt-4 text-sm text-muted">Order <span className="font-mono">{reg.orderItem.order.number}</span> · {reg.orderItem.order.status.toLowerCase()}</p>
          ) : null}
          <dl className="mt-3 grid gap-1.5 border-t border-border pt-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Total</dt><dd className="font-mono">{formatMoney(reg.price, reg.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Verified paid</dt><dd className="font-mono">{formatMoney(reg.amountPaid, reg.currency)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Balance</dt><dd className="font-mono">{formatMoney(reg.price.minus(reg.amountPaid).greaterThan(0) ? reg.price.minus(reg.amountPaid) : 0, reg.currency)}</dd></div>
          </dl>
          {(reg.paymentMethod || reg.declaredReference) && (
            <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
              {reg.paymentMethod && <div>Preferred method: <span className="font-medium">{reg.paymentMethod}</span></div>}
              {reg.declaredReference && <div>Reference given by registrant (unverified): <span className="font-mono">{reg.declaredReference}</span></div>}
            </div>
          )}
          {active && unpaid.length > 0 && (
            <div className="mt-4">
              <FormDialog trigger="Record verified payment" title="Record a verified payment" description="Only record payments you have confirmed on the M-Pesa statement or bank account." action={recordRegistrationPaymentAction.bind(null, reg.id)} submitLabel="Mark as paid" variant="default">
                <Field name="item" label="Sessions covered">
                  <div className="grid gap-2">
                    {unpaid.map((i) => (
                      <label key={i.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
                        <input type="checkbox" name="item" value={i.id} defaultChecked className="size-4 accent-[var(--brand)]" />
                        <span className="flex-1">{i.session.label} · {i.package.name}</span>
                        <span className="font-mono">{formatMoney(i.price, reg.currency)}</span>
                      </label>
                    ))}
                  </div>
                </Field>
                <Field name="method" label="Method">
                  <Select name="method" defaultValue="M-Pesa Paybill">
                    <option>M-Pesa Paybill</option>
                    <option>Bank transfer</option>
                    <option>Cash</option>
                    <option>Other</option>
                  </Select>
                </Field>
                <Field name="reference" label="Transaction reference"><Input name="reference" defaultValue={reg.declaredReference ?? ""} required /></Field>
                <Field name="note" label="Note (optional)"><Input name="note" /></Field>
              </FormDialog>
            </div>
          )}
          {reg.paymentRecords.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold">Payment ledger</h3>
              <ul className="mt-2 grid gap-1.5 text-sm">
                {reg.paymentRecords.map((p) => (
                  <li key={p.id} className="rounded-lg bg-surface-2/60 px-3 py-2">
                    <span className="font-mono">{formatMoney(p.amount, reg.currency)}</span> · {p.method}{p.reference ? ` · ${p.reference}` : ""}
                    <div className="text-xs text-muted">{formatDateTime(p.createdAt, tz)}{p.recordedById ? ` · verified by ${recorders.find((r) => r.id === p.recordedById)?.name ?? "staff"}` : " · M-Pesa confirmation"}{p.note ? ` · ${p.note}` : ""}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="font-display text-lg font-bold">Contact</h2>
          <dl className="mt-3 grid gap-1 text-sm">
            <div>{reg.contactName ?? reg.user.name}</div>
            <div className="text-muted">{reg.contactPhone ?? reg.user.phone ?? "—"}</div>
            <div className="break-all text-muted">{reg.contactEmail ?? reg.user.email}</div>
            <Link href={`/admin/users/${reg.user.id}`} className="mt-1 text-xs text-brand-ink hover:underline">Account: {reg.user.email}</Link>
          </dl>
          {!sensitive && answers.some((a) => a.sensitive) && <p className="mt-3 flex items-center gap-2 text-xs text-muted"><Lock className="size-3.5" />Health & safety answers need the “View registrants’ health and safety answers” permission.</p>}
          {answers.length > 0 && sections.map((section) => (
            <div key={section} className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{section}</h3>
              <dl className="mt-2 grid gap-2.5 text-sm">
                {answers.filter((a) => (a.section || "Details") === section).map((a) => (
                  <div key={a.key}>
                    <dt className="text-xs text-muted">{a.label}</dt>
                    <dd className="whitespace-pre-line">{a.sensitive && !sensitive ? <span className="flex items-center gap-1.5 text-muted"><Lock className="size-3.5" />Restricted</span> : answerText(a.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CalendarDays, CheckCircle2, Clock, MapPin, ShieldCheck, Users } from "lucide-react";
import { prisma } from "@/server/db";
import { getAllSettings, siteUrl } from "@/server/settings";
import { activeProvider } from "@/server/payments/registry";
import { deadlineState, feeStatusLabel, registrationPath, sessionDates, verifyRegistrationKey } from "@/server/event-registrations";
import { Container } from "@/components/site/cards";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PrintButton } from "@/components/site/print-button";
import { RegistrationPayForm } from "@/components/site/registration-pay-form";
import { ShareEvent } from "@/components/site/share-event";
import { answerText, type StoredAnswer } from "@/lib/event-form";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Your booking", robots: { index: false } };
export const dynamic = "force-dynamic";

/** A registrant's own booking: success screen, payment status and M-Pesa payment. Access is the signed link. */
export default async function RegistrationPage({ params, searchParams }: { params: Promise<{ reference: string }>; searchParams: Promise<{ k?: string; new?: string }> }) {
  const { reference } = await params;
  const { k, new: fresh } = await searchParams;
  const code = reference.toUpperCase();
  if (!k || !verifyRegistrationKey(code, k)) notFound();
  const reg = await prisma.eventRegistration.findUnique({
    where: { reference: code },
    include: { event: { include: { location: true } }, items: { include: { session: true, package: true } }, paymentRecords: { orderBy: { createdAt: "asc" } }, user: { select: { email: true } } },
  });
  if (!reg) notFound();
  const settings = await getAllSettings();
  const tz = settings.general.timezone;
  const now = new Date();
  const items = [...reg.items].sort((a, b) => a.session.position - b.session.position || a.session.startsAt.getTime() - b.session.startsAt.getTime());
  const unpaid = items.filter((i) => !i.paidAt && i.price.greaterThan(0));
  const balance = reg.price.minus(reg.amountPaid);
  const active = reg.status === "PENDING" || reg.status === "CONFIRMED";
  const provider = reg.event.onlinePayment ? await activeProvider() : null;
  const canPayOnline = active && unpaid.length > 0 && provider ? (await provider.impl.readiness()).ready : false;
  const answers = ((reg.answers ?? []) as StoredAnswer[]).filter((a) => !a.sensitive);
  const venue = [reg.event.venueNote, reg.event.location?.name].filter(Boolean).join(" · ");
  const base = await siteUrl();
  const eventUrl = `${base}/events/${reg.event.slug}`;
  const feeVariant = reg.feeStatus === "PAID" ? "success" : reg.feeStatus === "PARTIAL" ? "default" : "warning";
  const nextDue = unpaid.find((i) => i.session.paymentDeadline);

  return (
    <Container className="max-w-2xl py-6 sm:py-12">
      {/* Success / status header */}
      <section className={cn("rounded-3xl border p-5 text-center sm:p-8", fresh ? "border-success/30 bg-success/10" : "border-border bg-surface")}>
        {fresh && <CheckCircle2 className="mx-auto size-14 text-success" />}
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{fresh ? "You're registered!" : reg.participantName ?? reg.contactName}</h1>
        <p className="mt-1 text-muted">{fresh ? `${reg.participantName ?? "Your child"} · ${reg.event.title}` : reg.event.title}</p>
        <div className="mx-auto mt-5 max-w-sm rounded-2xl border border-border bg-background/80 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">Registration number</div>
          <div className="mt-1 select-all font-mono text-3xl font-bold tracking-wider">{reg.reference}</div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <StatusBadge status={reg.status} />
            {reg.price.greaterThan(0) && <Badge variant={feeVariant}>{feeStatusLabel(reg.feeStatus)}</Badge>}
          </div>
        </div>
        {reg.price.greaterThan(0) && (
          <dl className="mx-auto mt-4 grid max-w-sm grid-cols-3 gap-2 text-sm">
            <div><dt className="text-muted">Total</dt><dd className="font-semibold tabular-nums">{formatMoney(reg.price, reg.currency)}</dd></div>
            <div><dt className="text-muted">Paid</dt><dd className="font-semibold tabular-nums">{formatMoney(reg.amountPaid, reg.currency)}</dd></div>
            <div><dt className="text-muted">Balance</dt><dd className="font-semibold tabular-nums">{formatMoney(balance.greaterThan(0) ? balance : 0, reg.currency)}</dd></div>
          </dl>
        )}
        {fresh && reg.contactEmail && <p className="mt-4 text-sm text-muted">We&apos;ve emailed this page to <span className="break-all font-medium text-foreground">{reg.contactEmail}</span> — use it any time to check status or pay.</p>}
      </section>

      {/* Payment */}
      {active && unpaid.length > 0 && (
        <section className="mt-5 rounded-3xl border border-border-strong bg-surface p-5 sm:p-7">
          <h2 className="font-display text-2xl font-extrabold tracking-tight">Pay for your booking</h2>
          <p className="mt-1 text-sm text-muted">
            Your place is confirmed once payment is verified.{nextDue?.session.paymentDeadline ? ` Next payment due ${formatDate(nextDue.session.paymentDeadline, tz, { weekday: "short", day: "numeric", month: "short" })}.` : ""}
          </p>
          {canPayOnline ? (
            <div className="mt-5">
              <RegistrationPayForm
                reference={reg.reference}
                accessKey={k}
                currency={reg.currency}
                defaultPhone={reg.contactPhone ?? ""}
                email={reg.contactEmail ?? reg.user.email}
                bookingHref={`${registrationPath(reg.reference)}&paid=1`}
                items={unpaid.map((i) => ({
                  id: i.id,
                  label: `${i.session.label} · ${i.package.name}`,
                  dates: sessionDates(i.session, tz),
                  price: i.price.toNumber(),
                  deadline: i.session.paymentDeadline ? formatDate(i.session.paymentDeadline, tz, { day: "numeric", month: "short" }) : null,
                  overdue: deadlineState(i.session.paymentDeadline, now) === "passed",
                }))}
              />
            </div>
          ) : reg.event.onlinePayment ? (
            <p className="mt-4 rounded-2xl bg-surface-2 p-4 text-sm text-muted">Online M-Pesa payment isn&apos;t available right now — please use the details below.</p>
          ) : null}
          {reg.event.paymentInstructions && (
            <div className="mt-5 rounded-2xl border border-border p-4 text-sm">
              <div className="font-semibold">{canPayOnline ? "Prefer bank transfer or Paybill?" : "How to pay"}</div>
              <div className="prose-chess mt-2 max-w-none text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{reg.event.paymentInstructions}</ReactMarkdown></div>
              <p className="mt-2 text-xs text-muted">Quote <span className="font-mono font-semibold text-foreground">{reg.reference}</span> as the payment reference.</p>
            </div>
          )}
          {reg.declaredReference && <p className="mt-4 rounded-2xl bg-surface-2 p-4 text-sm text-muted">You told us you paid with reference <span className="font-mono text-foreground">{reg.declaredReference}</span>. We&apos;ll verify it and update this page.</p>}
        </section>
      )}
      {active && unpaid.length === 0 && reg.price.greaterThan(0) && (
        <p className="mt-5 flex items-center justify-center gap-2 rounded-3xl bg-success/10 p-4 font-semibold text-success"><CheckCircle2 className="size-5" />Fully paid — see you at {reg.event.title}!</p>
      )}
      {!active && <p className="mt-5 rounded-3xl bg-surface-2 p-4 text-center text-muted">This registration is {reg.status.toLowerCase()}. Contact the club if you have questions.</p>}

      {/* Booking summary */}
      <section className="mt-5 overflow-hidden rounded-3xl border border-border bg-surface">
        <div className="px-5 pt-5 sm:px-7">
          <h2 className="font-display text-xl font-bold">Booking summary</h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span className="flex items-center gap-1.5"><CalendarDays className="size-4 text-brand-ink" />{sessionDates(reg.event, tz)} {formatDate(reg.event.endsAt, tz, { year: "numeric" })}</span>
            {venue && <span className="flex items-center gap-1.5"><MapPin className="size-4 text-brand-ink" />{venue}</span>}
          </div>
        </div>
        <ul className="mt-3 divide-y divide-border">
          {items.map((i) => {
            const state = i.paidAt ? "paid" : deadlineState(i.session.paymentDeadline, now);
            return (
              <li key={i.id} className="flex items-start justify-between gap-4 px-5 py-3.5 sm:px-7">
                <div className="min-w-0">
                  <div className="font-semibold">{i.session.label} · {i.package.name}</div>
                  <div className="text-sm text-muted">{sessionDates(i.session, tz)}</div>
                  <div className={cn("mt-0.5 flex items-center gap-1 text-xs font-semibold", state === "paid" ? "text-success" : state === "passed" ? "text-danger" : state === "soon" ? "text-warning" : "text-muted")}>
                    {state === "paid" ? <><CheckCircle2 className="size-3.5" />Paid</> : <><Clock className="size-3.5" />{i.session.paymentDeadline ? `${state === "passed" ? "Overdue · was due" : "Pay by"} ${formatDate(i.session.paymentDeadline, tz, { day: "numeric", month: "short" })}` : "Unpaid"}</>}
                  </div>
                </div>
                <div className="shrink-0 font-semibold tabular-nums">{formatMoney(i.price, reg.currency)}</div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-baseline justify-between border-t border-border bg-surface-2/60 px-5 py-4 sm:px-7"><span className="font-semibold">Total camp fees</span><span className="font-display text-2xl font-black tabular-nums">{formatMoney(reg.price, reg.currency)}</span></div>
        {reg.paymentRecords.length > 0 && (
          <div className="border-t border-border px-5 py-4 sm:px-7">
            <h3 className="text-sm font-semibold">Payments received</h3>
            <ul className="mt-2 grid gap-1 text-sm text-muted">
              {reg.paymentRecords.map((p) => <li key={p.id}>{formatDateTime(p.createdAt, tz)} · {p.method}{p.reference ? ` ${p.reference}` : ""} · <span className="font-semibold tabular-nums text-foreground">{formatMoney(p.amount, reg.currency)}</span></li>)}
            </ul>
          </div>
        )}
        {answers.length > 0 && (
          <details className="border-t border-border px-5 py-4 text-sm sm:px-7">
            <summary className="min-h-11 cursor-pointer content-center font-semibold">Registration details</summary>
            <dl className="mt-2 grid gap-2.5">
              {answers.map((a) => <div key={a.key}><dt className="text-xs text-muted">{a.label}</dt><dd>{answerText(a.value)}</dd></div>)}
            </dl>
          </details>
        )}
      </section>

      {/* Invite */}
      <section className="mt-5 rounded-3xl border border-border bg-surface p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand-ink"><Users className="size-5" /></span>
          <div>
            <h2 className="font-display text-xl font-bold">Invite another family</h2>
            <p className="mt-0.5 text-sm text-muted">Chess is more fun with friends — share the {reg.event.title} with other parents.</p>
          </div>
        </div>
        <ShareEvent className="mt-4" url={eventUrl} title={reg.event.title} text={`I've registered for ${reg.event.title}${venue ? ` at ${venue}` : ""} — join us!`} />
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-brand-ink" />Payments are verified with M-Pesa or by the club before they show here.</span>
        <div className="flex gap-2"><Link href={`/events/${reg.event.slug}`} className="min-h-11 content-center hover:text-foreground">Event details</Link><PrintButton /></div>
      </div>
    </Container>
  );
}

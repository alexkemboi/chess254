"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, Lock, Pencil, Smartphone } from "lucide-react";
import { submitEventFormAction } from "@/actions/event-forms";
import { formSteps, isFieldVisible, kenyanPhone, validateAnswers, type EventFormField, type FormStep, type RawAnswers } from "@/lib/event-form";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type FormSession = { id: string; label: string; dates: string; deadline: string | null; deadlineState: "none" | "ok" | "soon" | "passed"; full: boolean; finished: boolean };
export type FormPackage = { id: string; name: string; price: number; description: string | null };

type Props = {
  eventId: string;
  fields: EventFormField[];
  sessions: FormSession[];
  packages: FormPackage[];
  currency: string;
  sessionLabel: string;
  minSessions: number;
  submitLabel: string;
  paymentInstructions: string | null;
  onlinePayment: boolean;
};

type Draft = { answers: RawAnswers; picks: Record<string, string>; step: number };

/**
 * Step-by-step registration built from the event's own field list. Steps come
 * from each field's "Step" setting; the last step always shows the booking
 * review. Answers live in state (and a per-tab draft) so moving between steps
 * never loses anything, and every check here is repeated on the server.
 */
export function EventRegistrationForm(props: Props) {
  // Rendered on the client only, so a saved draft can seed the initial state.
  const mounted = React.useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!mounted) return <div className="mx-auto h-[60vh] w-full max-w-2xl animate-pulse rounded-3xl bg-surface" aria-busy="true" />;
  return <Wizard {...props} />;
}

const noopSubscribe = () => () => {};

function readDraft(key: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function Wizard(props: Props) {
  const { eventId, sessions, packages, currency, sessionLabel, minSessions, submitLabel, paymentInstructions, onlinePayment } = props;
  const router = useRouter();
  const unit = sessionLabel.toLowerCase();
  const min = Math.max(1, minSessions);

  const steps = React.useMemo<FormStep[]>(() => {
    const fields = sessions.length && !props.fields.some((f) => f.type === "sessions")
      ? [{ key: "__sessions", label: `Choose your ${unit}s`, type: "sessions", required: true, options: [], section: "", step: `${sessionLabel}s`, help: "", showIf: "", sensitive: false, role: "" } as EventFormField, ...props.fields]
      : props.fields;
    const grouped = formSteps(fields);
    return grouped.length ? grouped : [{ title: "Details", fields: [] }];
  }, [props.fields, sessions.length, sessionLabel, unit]);

  const draftKey = `event-form:${eventId}`;
  const sensitiveKeys = React.useMemo(() => new Set(props.fields.filter((f) => f.sensitive).map((f) => f.key)), [props.fields]);
  const [draft] = React.useState(() => readDraft(draftKey));
  const [answers, setAnswers] = React.useState<RawAnswers>(() => draft?.answers ?? {});
  const [picks, setPicks] = React.useState<Record<string, string>>(() => draft?.picks ?? {});
  const [step, setStep] = React.useState(() => Math.min(draft?.step ?? 0, steps.length - 1));
  const [touched, setTouched] = React.useState<Set<string>>(new Set());
  const [attempted, setAttempted] = React.useState<Set<number>>(new Set());
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const submitted = React.useRef(false);
  const top = React.useRef<HTMLDivElement>(null);

  // Save a draft for this tab (health answers are never stored).
  React.useEffect(() => {
    if (submitted.current) return;
    try {
      const safe = Object.fromEntries(Object.entries(answers).filter(([k]) => !sensitiveKeys.has(k)));
      sessionStorage.setItem(draftKey, JSON.stringify({ answers: safe, picks, step } satisfies Draft));
    } catch {
      /* storage unavailable */
    }
  }, [answers, picks, step, draftKey, sensitiveKeys]);

  const chosen = sessions.flatMap((s) => {
    const pkg = packages.find((p) => p.id === picks[s.id]);
    return pkg && !s.finished && !s.full ? [{ session: s, pkg }] : [];
  });
  const total = chosen.reduce((sum, c) => sum + c.pkg.price, 0);

  const errorsFor = React.useCallback(
    (i: number) => {
      const fields = steps[i]?.fields ?? [];
      const { errors } = validateAnswers(fields.filter((f) => f.type !== "sessions"), answers);
      if (fields.some((f) => f.type === "sessions") && chosen.length < min) errors.sessions = `Choose at least ${min} ${unit}${min > 1 ? "s" : ""} to continue`;
      return errors;
    },
    [steps, answers, chosen.length, min, unit],
  );
  const currentErrors = errorsFor(step);
  const valid = Object.keys(currentErrors).length === 0;
  const isLast = step === steps.length - 1;

  const set = (key: string, value: RawAnswers[string]) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setServerErrors((e) => (e[key] ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e));
  };
  const touch = (key: string) => setTouched((t) => (t.has(key) ? t : new Set(t).add(key)));
  const shownError = (key: string) => serverErrors[key] ?? (touched.has(key) || attempted.has(step) ? currentErrors[key] : undefined);

  function go(next: number) {
    setStep(next);
    requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function revealErrors() {
    setAttempted((a) => new Set(a).add(step));
    const first = Object.keys(currentErrors)[0];
    requestAnimationFrame(() => document.getElementById(`field-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function submit() {
    if (submitted.current || submitting) return;
    // Every step must be valid before sending.
    for (let i = 0; i < steps.length; i++) {
      if (Object.keys(errorsFor(i)).length) {
        setAttempted((a) => new Set(a).add(i));
        go(i);
        toast.error("Please complete the highlighted answers.");
        return;
      }
    }
    setSubmitting(true);
    const fd = new FormData();
    for (const [key, value] of Object.entries(answers)) {
      const field = props.fields.find((f) => f.key === key);
      if (!field || !isFieldVisible(field, answers)) continue;
      if (Array.isArray(value)) value.forEach((v) => fd.append(key, v));
      else if (value !== undefined && value !== "") fd.append(key, String(value));
    }
    for (const c of chosen) fd.append(`session:${c.session.id}`, c.pkg.id);
    let res;
    try {
      res = await submitEventFormAction(eventId, fd);
    } catch {
      setSubmitting(false);
      toast.error("Network error — check your connection and try again. Nothing was submitted.");
      return;
    }
    if (res.ok) {
      submitted.current = true;
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      router.push(res.redirect ?? "/events");
      return;
    }
    setSubmitting(false);
    const errs = res.fieldErrors ?? {};
    setServerErrors(errs);
    toast.error(res.error);
    const firstKey = Object.keys(errs)[0];
    const at = firstKey ? steps.findIndex((s) => s.fields.some((f) => f.key === firstKey || (firstKey === "sessions" && f.type === "sessions"))) : -1;
    if (at >= 0 && at !== step) go(at);
  }

  const current = steps[step];
  const subGroups = groupBySection(current.fields);

  return (
    <div ref={top} className="mx-auto w-full max-w-2xl scroll-mt-24">
      {/* Progress */}
      <nav aria-label="Registration progress" className="mb-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-brand-ink">Step {step + 1} of {steps.length}</p>
          {sessions.length > 0 && <p className="text-sm text-muted sm:hidden">{chosen.length} {unit}{chosen.length === 1 ? "" : "s"}</p>}
        </div>
        <h2 className="mt-1 font-display text-[1.7rem] font-extrabold leading-tight tracking-tight sm:text-3xl">{current.title}</h2>
        <ol className="mt-4 flex gap-1.5">
          {steps.map((s, i) => (
            <li key={s.title + i} className="flex-1">
              <button
                type="button"
                onClick={() => i < step && go(i)}
                disabled={i >= step}
                aria-label={`Step ${i + 1}: ${s.title}${i < step ? " (done)" : i === step ? " (current)" : ""}`}
                aria-current={i === step ? "step" : undefined}
                className={cn("block h-2 w-full rounded-full transition-colors", i < step ? "bg-brand hover:bg-brand/80" : i === step ? "bg-brand/60" : "bg-foreground/10")}
              />
              <span className={cn("mt-1.5 hidden truncate text-xs sm:block", i === step ? "font-semibold text-foreground" : "text-muted")}>{s.title}</span>
            </li>
          ))}
        </ol>
      </nav>

      <div className="grid gap-5">
        {isLast && (
          <ReviewSummary
            steps={steps}
            answers={answers}
            chosen={chosen}
            total={total}
            currency={currency}
            unit={unit}
            onEdit={go}
            hasSessions={sessions.length > 0}
          />
        )}

        {subGroups.map((group, gi) => (
          <section key={gi} className="grid gap-5 rounded-3xl border border-border bg-surface p-4 sm:p-6">
            {group.title && (current.fields.length > group.fields.length || isLast) && <h3 className="font-display text-lg font-bold">{group.title}</h3>}
            {group.fields.map((field) =>
              field.type === "sessions" ? (
                <SessionPicker key={field.key} field={field} sessions={sessions} packages={packages} picks={picks} setPicks={setPicks} currency={currency} unit={unit} error={shownError("sessions")} />
              ) : isFieldVisible(field, answers) ? (
                <FormField key={field.key} field={field} value={answers[field.key]} onChange={(v) => set(field.key, v)} onBlur={() => touch(field.key)} error={shownError(field.key)} />
              ) : null,
            )}
          </section>
        ))}

        {isLast && (onlinePayment || paymentInstructions) && (
          <section className="rounded-3xl border border-brand/30 bg-brand-soft/60 p-4 sm:p-6">
            <h3 className="font-display text-lg font-bold">How payment works</h3>
            <ul className="mt-3 grid gap-3 text-sm leading-relaxed">
              {onlinePayment && (
                <li className="flex gap-3"><Smartphone className="mt-0.5 size-5 shrink-0 text-brand-ink" /><span><b>M-Pesa:</b> right after you register you can send an M-Pesa prompt to your phone and pay for all weeks or just the next one.</span></li>
              )}
              {paymentInstructions && <li className="flex gap-3"><Lock className="mt-0.5 size-5 shrink-0 text-brand-ink" /><span className="whitespace-pre-line">{paymentInstructions}</span></li>}
            </ul>
          </section>
        )}
      </div>

      {/* Sticky action bar: total + navigation, always within thumb reach. */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-4">
        {sessions.length > 0 && (
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted">{chosen.length ? `${chosen.length} ${unit}${chosen.length === 1 ? "" : "s"} · camp fees` : `No ${unit}s chosen yet`}</span>
            <span className="font-display text-2xl font-black tabular-nums" aria-live="polite">{formatMoney(total, currency)}</span>
          </div>
        )}
        <div className="flex gap-2">
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1)} disabled={submitting} className="inline-flex h-14 items-center justify-center gap-1.5 rounded-2xl border border-border-strong bg-surface px-5 text-base font-semibold transition hover:border-brand disabled:opacity-50">
              <ArrowLeft className="size-5" /><span className="hidden min-[380px]:inline">Back</span>
            </button>
          )}
          <button
            type="button"
            aria-disabled={!valid || submitting}
            onClick={() => (!valid ? revealErrors() : isLast ? submit() : go(step + 1))}
            className={cn(
              "inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl px-5 text-base font-bold transition",
              valid && !submitting ? "bg-brand text-brand-foreground hover:brightness-110" : "cursor-not-allowed bg-foreground/10 text-muted",
            )}
          >
            {submitting ? <><Loader2 className="size-5 animate-spin" />Submitting…</> : isLast ? <><Check className="size-5" />{submitLabel}</> : <>Continue<ArrowRight className="size-5" /></>}
          </button>
        </div>
        {!valid && attempted.has(step) && <p className="mt-2 text-center text-xs text-danger">{Object.keys(currentErrors).length === 1 ? "One answer still needed above." : `${Object.keys(currentErrors).length} answers still needed above.`}</p>}
      </div>
    </div>
  );
}

function groupBySection(fields: EventFormField[]) {
  const groups: { title: string; fields: EventFormField[] }[] = [];
  for (const f of fields) {
    const last = groups[groups.length - 1];
    if (last && (last.title === f.section || !f.section)) last.fields.push(f);
    else groups.push({ title: f.section, fields: [f] });
  }
  return groups;
}

function ReviewSummary({ steps, answers, chosen, total, currency, unit, onEdit, hasSessions }: { steps: FormStep[]; answers: RawAnswers; chosen: { session: FormSession; pkg: FormPackage }[]; total: number; currency: string; unit: string; onEdit: (i: number) => void; hasSessions: boolean }) {
  const stepOf = (pred: (f: EventFormField) => boolean) => steps.findIndex((s) => s.fields.some(pred));
  const sessionsStep = stepOf((f) => f.type === "sessions");
  const people = steps.slice(0, -1).flatMap((s, i) => s.fields.filter((f) => f.role === "participantName" || f.role === "contactName" || f.role === "contactPhone" || f.role === "contactEmail").map((f) => ({ f, i })));
  const overdue = chosen.filter((c) => c.session.deadlineState === "passed");
  return (
    <>
      {hasSessions && (
        <section className="overflow-hidden rounded-3xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
            <h3 className="font-display text-lg font-bold">Your booking</h3>
            {sessionsStep >= 0 && <EditButton onClick={() => onEdit(sessionsStep)} label={`Edit ${unit}s`} />}
          </div>
          <ul className="mt-3 divide-y divide-border">
            {chosen.map((c) => (
              <li key={c.session.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <div className="font-semibold">{c.session.label} · {c.pkg.name}</div>
                  <div className="text-sm text-muted">{c.session.dates}</div>
                  {c.session.deadline && <div className={cn("mt-0.5 text-xs font-semibold", c.session.deadlineState === "passed" ? "text-danger" : c.session.deadlineState === "soon" ? "text-warning" : "text-muted")}>{c.session.deadlineState === "passed" ? "Payment overdue — was due" : "Pay by"} {c.session.deadline}</div>}
                </div>
                <div className="shrink-0 font-semibold tabular-nums">{formatMoney(c.pkg.price, currency)}</div>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between gap-3 border-t border-border bg-surface-2/60 px-4 py-4 sm:px-6">
            <span className="font-semibold">Total camp fees</span>
            <span className="font-display text-2xl font-black tabular-nums">{formatMoney(total, currency)}</span>
          </div>
          {overdue.length > 0 && (
            <p className="flex gap-2 border-t border-border bg-warning/10 px-4 py-3 text-sm text-warning sm:px-6"><AlertTriangle className="mt-0.5 size-4 shrink-0" />The payment deadline for {overdue.map((o) => o.session.label).join(", ")} has passed — please pay as soon as you register.</p>
          )}
          <p className="border-t border-border px-4 py-3 text-xs text-muted sm:px-6">Fees cover the camp only. Lunch and optional recreational activities are paid separately.</p>
        </section>
      )}
      {people.length > 0 && (
        <section className="rounded-3xl border border-border bg-surface p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg font-bold">Details</h3>
            <EditButton onClick={() => onEdit(people[0].i)} label="Edit" />
          </div>
          <dl className="mt-3 grid gap-2 text-sm">
            {people.map(({ f }) => (
              <div key={f.key} className="flex justify-between gap-4">
                <dt className="text-muted">{f.label}</dt>
                <dd className="min-w-0 break-words text-right font-medium">{String(answers[f.key] ?? "—")}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}

function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-brand-ink hover:bg-brand-soft">
      <Pencil className="size-4" />{label}
    </button>
  );
}

function SessionPicker({ field, sessions, packages, picks, setPicks, currency, unit, error }: { field: EventFormField; sessions: FormSession[]; packages: FormPackage[]; picks: Record<string, string>; setPicks: React.Dispatch<React.SetStateAction<Record<string, string>>>; currency: string; unit: string; error?: string }) {
  const open = sessions.filter((s) => !s.finished && !s.full);
  const setAll = (packageId: string) => setPicks(Object.fromEntries(open.map((s) => [s.id, packageId])));
  return (
    <div id="field-sessions" className="grid gap-4">
      <div>
        <p className="text-base font-semibold">{field.label}</p>
        {field.help && <p className="mt-1 text-sm text-muted">{field.help}</p>}
      </div>
      {packages.length > 0 && open.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Same for every {unit}:</span>
          {packages.map((p) => (
            <button key={p.id} type="button" onClick={() => setAll(p.id)} className="min-h-10 rounded-full border border-border bg-surface px-3.5 text-sm font-medium hover:border-brand">{p.name}</button>
          ))}
          <button type="button" onClick={() => setPicks({})} className="min-h-10 rounded-full px-3 text-sm text-muted hover:text-foreground">Clear</button>
        </div>
      )}
      <div className="grid gap-3">
        {sessions.map((s) => {
          const disabled = s.finished || s.full;
          const value = disabled ? "" : picks[s.id] ?? "";
          const selected = packages.find((p) => p.id === value);
          return (
            <div key={s.id} className={cn("rounded-2xl border-2 p-3.5 transition-colors sm:p-4", selected ? "border-brand bg-brand-soft/40" : "border-border bg-surface-2/40", disabled && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-lg font-bold leading-tight">{s.label}</div>
                  <div className="text-sm text-muted">{s.dates}</div>
                </div>
                {s.deadline && (
                  <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", s.deadlineState === "passed" ? "bg-danger/10 text-danger" : s.deadlineState === "soon" ? "bg-warning/12 text-warning" : "bg-foreground/5 text-muted")}>
                    {s.deadlineState === "passed" ? "Overdue" : "Pay by"} {s.deadline}
                  </span>
                )}
              </div>
              {disabled ? (
                <p className="mt-3 text-sm text-muted">{s.finished ? `This ${unit} has finished.` : "Fully booked."}</p>
              ) : (
                <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={`${s.label} attendance`}>
                  {[{ id: "", name: "Not attending", price: 0 }, ...packages].map((p) => {
                    const active = value === p.id;
                    return (
                      <button
                        key={p.id || "none"}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setPicks((x) => ({ ...x, [s.id]: p.id }))}
                        className={cn("flex min-h-16 flex-col items-center justify-center rounded-xl border px-1.5 py-2 text-center transition-colors", active ? (p.id ? "border-brand bg-brand text-brand-foreground" : "border-foreground/30 bg-foreground/10") : "border-border bg-surface hover:border-brand/60")}
                      >
                        <span className="text-sm font-semibold leading-tight">{p.id ? p.name : "Not attending"}</span>
                        {p.id && <span className={cn("mt-0.5 text-xs tabular-nums", active ? "text-brand-foreground/90" : "text-muted")}>{formatMoney(p.price, currency)}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {selected && s.deadlineState === "passed" && <p className="mt-2 flex gap-1.5 text-xs font-semibold text-danger"><AlertTriangle className="size-3.5 shrink-0" />Payment deadline has passed — pay straight after registering.</p>}
            </div>
          );
        })}
      </div>
      {error && <p className="text-sm font-medium text-danger" role="alert">{error}</p>}
    </div>
  );
}

const inputClass = "h-14 w-full rounded-2xl border border-border bg-surface px-4 text-base outline-none transition placeholder:text-muted-2 focus:border-brand focus:ring-4 focus:ring-brand/15 aria-[invalid=true]:border-danger";

function FormField({ field, value, onChange, onBlur, error }: { field: EventFormField; value: RawAnswers[string]; onChange: (v: RawAnswers[string]) => void; onBlur: () => void; error?: string }) {
  const text = typeof value === "string" ? value : "";
  const id = `field-${field.key}`;
  const hint = field.help ? <p className="text-sm text-muted">{field.help}</p> : null;
  const err = error ? <p className="text-sm font-medium text-danger" role="alert">{error}</p> : null;
  const label = (
    <span className="text-base font-semibold leading-snug">
      {field.label}
      {!field.required && <span className="ml-2 align-middle text-xs font-medium text-muted">(optional)</span>}
    </span>
  );

  if (field.type === "checkbox") {
    const checked = value === true || value === "on";
    return (
      <div id={id} className="grid gap-2">
        <label className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 text-sm leading-relaxed transition-colors", checked ? "border-brand bg-brand-soft/50" : error ? "border-danger/60" : "border-border bg-surface-2/40")}>
          <input type="checkbox" checked={checked} onChange={(e) => { onChange(e.target.checked ? "on" : ""); onBlur(); }} className="mt-0.5 size-6 shrink-0 accent-[var(--brand)]" />
          <span>{field.label}</span>
        </label>
        {err}
      </div>
    );
  }

  if (field.type === "checkboxes") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset id={id} className="grid gap-3">
        <legend className="mb-1">{label}</legend>
        {hint}
        <div className="grid gap-2 sm:grid-cols-2">
          {field.options.map((opt) => {
            const on = selected.includes(opt);
            return (
              <label key={opt} className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors", on ? "border-brand bg-brand-soft/50" : "border-border bg-surface")}>
                <input type="checkbox" checked={on} onChange={(e) => { onChange(e.target.checked ? [...selected, opt] : selected.filter((v) => v !== opt)); onBlur(); }} className="size-5 shrink-0 accent-[var(--brand)]" />
                {opt}
              </label>
            );
          })}
        </div>
        {err}
      </fieldset>
    );
  }

  if (field.type === "select" && field.options.length <= 6) {
    const long = field.options.some((o) => o.length > 18);
    return (
      <fieldset id={id} className="grid gap-3">
        <legend className="mb-1">{label}</legend>
        {hint}
        <div className={cn("grid gap-2", long ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2")} role="radiogroup" aria-label={field.label}>
          {field.options.map((opt) => {
            const active = text === opt;
            return (
              <button key={opt} type="button" role="radio" aria-checked={active} onClick={() => { onChange(opt); onBlur(); }} className={cn("flex min-h-14 items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-sm font-semibold transition-colors", active ? "border-brand bg-brand-soft/60" : error ? "border-danger/50 bg-surface" : "border-border bg-surface hover:border-brand/50")}>
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", active ? "border-brand bg-brand" : "border-foreground/25")}>{active && <Check className="size-3 text-brand-foreground" strokeWidth={4} />}</span>
                {opt}
              </button>
            );
          })}
        </div>
        {err}
      </fieldset>
    );
  }

  return (
    <div className="grid gap-2">
      <label htmlFor={id}>{label}</label>
      {hint}
      {field.type === "select" ? (
        <select id={id} value={text} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} aria-invalid={Boolean(error)} className={inputClass}>
          <option value="">Choose…</option>
          {field.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : field.type === "textarea" ? (
        <textarea id={id} value={text} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} aria-invalid={Boolean(error)} rows={4} maxLength={4000} className={cn(inputClass, "h-auto min-h-32 py-3")} />
      ) : (
        <input
          id={id}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (field.type === "phone") {
              const formatted = kenyanPhone(text);
              if (formatted && formatted !== text) onChange(formatted);
            }
            onBlur();
          }}
          aria-invalid={Boolean(error)}
          maxLength={field.type === "phone" ? 20 : 400}
          type={field.type === "phone" ? "tel" : field.type === "email" ? "email" : field.type === "date" ? "date" : "text"}
          inputMode={field.type === "phone" ? "tel" : field.type === "number" ? "numeric" : field.type === "email" ? "email" : undefined}
          pattern={field.type === "number" ? "[0-9]*" : undefined}
          autoComplete={field.role === "contactEmail" ? "email" : field.role === "contactPhone" ? "tel" : field.role === "contactName" ? "name" : "off"}
          autoCapitalize={field.type === "email" ? "none" : field.role === "participantName" || field.role === "contactName" || /name/i.test(field.key) ? "words" : undefined}
          placeholder={field.type === "phone" ? "0712 345 678" : field.type === "email" ? "name@example.com" : undefined}
          className={cn(inputClass, field.type === "number" && "max-w-40")}
        />
      )}
      {err}
    </div>
  );
}

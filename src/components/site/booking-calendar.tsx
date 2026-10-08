"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck, ChevronLeft, ChevronRight, Clock, Loader2, Lock, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createBookingAction, daySlotsAction, monthAvailabilityAction, quoteAction, type DaySlot } from "@/actions/booking";
import { dateKeyInZone } from "@/lib/time";
import { formatDate, formatTime } from "@/lib/format";
import { cn, initials } from "@/lib/utils";

export type SessionTypeOption = { id: string; name: string; description: string; durationMinutes: number; priceLabel: string; capacity: number; membershipRequired: boolean; coachIds: string[]; cancellationPolicy: string | null };
export type CoachOption = { id: string; name: string };

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthKeyOf(dateKey: string) {
  return dateKey.slice(0, 7);
}
function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function BookingCalendar({ sessionTypes, coaches, timezone, signedIn, initialType, initialCoach }: { sessionTypes: SessionTypeOption[]; coaches: CoachOption[]; timezone: string; signedIn: boolean; initialType?: string; initialCoach?: string }) {
  const router = useRouter();
  const today = dateKeyInZone(new Date(), timezone);
  const [typeId, setTypeId] = React.useState(sessionTypes.find((s) => s.id === initialType)?.id ?? sessionTypes[0]?.id ?? "");
  const [coachId, setCoachId] = React.useState(initialCoach ?? "");
  const [month, setMonth] = React.useState(monthKeyOf(today));
  const [date, setDate] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const type = sessionTypes.find((s) => s.id === typeId);
  const typeCoaches = coaches.filter((c) => type?.coachIds.includes(c.id));

  // Each async result is stored with the request key it answers, so stale or
  // in-flight data is derived away instead of being reset inside effects.
  const monthKey = `${typeId}|${coachId}|${month}|${refresh}`;
  const [monthData, setMonthData] = React.useState<{ key: string; days: Map<string, number> }>({ key: "", days: new Map() });
  const loadingMonth = monthData.key !== monthKey;
  const days = loadingMonth ? new Map<string, number>() : monthData.days;

  const slotsKey = date ? `${typeId}|${coachId}|${date}|${refresh}` : "";
  const [slotsData, setSlotsData] = React.useState<{ key: string; slots: DaySlot[] }>({ key: "", slots: [] });
  const loadingSlots = Boolean(date) && slotsData.key !== slotsKey;
  const slots = !loadingSlots && slotsData.key === slotsKey ? slotsData.slots : [];

  const [picked, setPicked] = React.useState<{ key: string; slot: DaySlot } | null>(null);
  const slot = picked && picked.key === slotsKey ? picked.slot : null;
  const quoteKey = slot ? `${typeId}|${slot.coachId}|${slot.startsAt}` : "";
  const [quoteData, setQuoteData] = React.useState<{ key: string; label: string; included: boolean } | null>(null);
  const quote = quoteData && quoteData.key === quoteKey ? quoteData : null;

  React.useEffect(() => {
    if (!typeId) return;
    let live = true;
    monthAvailabilityAction(typeId, month, coachId || undefined).then((res) => {
      if (!live) return;
      if (!res.ok) toast.error(res.error);
      setMonthData({ key: monthKey, days: new Map(res.ok ? (res.data ?? []).map((d) => [d.date, d.slots]) : []) });
    });
    return () => {
      live = false;
    };
  }, [typeId, coachId, month, monthKey]);

  React.useEffect(() => {
    if (!date || !typeId) return;
    let live = true;
    daySlotsAction(typeId, date, coachId || undefined).then((res) => {
      if (!live) return;
      if (!res.ok) toast.error(res.error);
      setSlotsData({ key: slotsKey, slots: res.ok ? res.data ?? [] : [] });
    });
    return () => {
      live = false;
    };
  }, [date, typeId, coachId, slotsKey]);

  React.useEffect(() => {
    if (!slot) return;
    let live = true;
    quoteAction(typeId, slot.startsAt).then((res) => {
      if (!live) return;
      if (res.ok && res.data) setQuoteData({ key: quoteKey, label: res.data.label, included: res.data.included });
      else if (!res.ok) setQuoteData({ key: quoteKey, label: res.error, included: false });
    });
    return () => {
      live = false;
    };
  }, [slot, typeId, quoteKey]);

  const setSlot = (s: DaySlot) => setPicked({ key: slotsKey, slot: s });

  async function book() {
    if (!slot || !type) return;
    setSubmitting(true);
    const res = await createBookingAction({ sessionTypeId: type.id, coachId: slot.coachId, startsAt: slot.startsAt, notes: notes || undefined });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.error);
      setRefresh((r) => r + 1); // reload availability after a conflict
      return;
    }
    toast.success(res.message ?? "Booked");
    if (res.redirect) router.push(res.redirect);
  }

  if (!type) return null;

  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array.from({ length: offset + count }, (_, i) => (i < offset ? null : `${month}-${String(i - offset + 1).padStart(2, "0")}`));
  const byCoach = slots.reduce<Map<string, DaySlot[]>>((acc, s) => acc.set(s.coachId, [...(acc.get(s.coachId) ?? []), s]), new Map());

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid gap-6">
        {/* Step 1 — session */}
        <section>
          <StepLabel n={1} label="Choose a session" />
          <div className="grid gap-3 sm:grid-cols-2">
            {sessionTypes.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setTypeId(s.id); setDate(null); setCoachId(""); }}
                className={cn("rounded-2xl border p-5 text-left transition", s.id === typeId ? "border-brand bg-brand-soft" : "border-border bg-surface hover:border-border-strong")}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{s.name}</span>
                  <span className="font-mono text-sm text-brand">{s.priceLabel}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-sm text-muted">{s.description}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                  <span className="flex items-center gap-1"><Clock className="size-3.5" />{s.durationMinutes} min</span>
                  {s.capacity > 1 && <span className="flex items-center gap-1"><Users className="size-3.5" />Up to {s.capacity}</span>}
                  {s.membershipRequired && <span className="flex items-center gap-1"><Lock className="size-3.5" />Members</span>}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Step 2 — date */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StepLabel n={2} label="Pick a date" />
            {typeCoaches.length > 1 && (
              <select value={coachId} onChange={(e) => { setCoachId(e.target.value); setDate(null); }} className="mb-4 h-9 rounded-full border border-border bg-surface px-4 text-sm" aria-label="Filter by coach">
                <option value="">Any coach</option>
                {typeCoaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          <div className="rounded-3xl border border-border bg-surface p-4 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <Button size="icon-sm" variant="ghost" onClick={() => setMonth(shiftMonth(month, -1))} disabled={month <= monthKeyOf(today)} aria-label="Previous month"><ChevronLeft /></Button>
              <div className="flex items-center gap-2 font-semibold">
                {formatDate(new Date(Date.UTC(y, m - 1, 15)), "UTC", { month: "long", year: "numeric" })}
                {loadingMonth && <Loader2 className="size-4 animate-spin text-brand" />}
              </div>
              <Button size="icon-sm" variant="ghost" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight /></Button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wider text-muted">
              {WEEK.map((d) => <div key={d} className="py-2">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((key, i) => {
                if (!key) return <div key={`x${i}`} />;
                const available = days.get(key);
                const past = key < today;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!available || past}
                    onClick={() => setDate(key)}
                    className={cn(
                      "relative aspect-square rounded-xl text-sm font-medium transition",
                      key === date ? "bg-brand text-black" : available ? "bg-surface-2 hover:bg-surface-3 hover:ring-1 hover:ring-brand" : "text-muted-2",
                      key === today && key !== date && "ring-1 ring-border-strong",
                    )}
                    aria-label={`${key}${available ? `, ${available} slots` : ", unavailable"}`}
                  >
                    {Number(key.slice(8))}
                    {available && key !== date && <span className="absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-brand" />}
                  </button>
                );
              })}
            </div>
            {!loadingMonth && days.size === 0 && (
              <p className="mt-4 rounded-xl bg-surface-2 p-4 text-center text-sm text-muted">No open slots this month{typeCoaches.length === 0 ? " — no coaches are offering this session yet" : ". Try the next month"}.</p>
            )}
          </div>
        </section>

        {/* Step 3 — time */}
        {date && (
          <section className="animate-fade-up">
            <StepLabel n={3} label={`Times on ${formatDate(new Date(`${date}T12:00:00Z`), "UTC", { weekday: "long", day: "numeric", month: "long" })}`} />
            {loadingSlots ? (
              <div className="grid gap-2 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-11 rounded-xl" />)}</div>
            ) : slots.length === 0 ? (
              <p className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted">Those times were just taken. Pick another day.</p>
            ) : (
              <div className="grid gap-4">
                {[...byCoach.entries()].map(([cid, list]) => (
                  <div key={cid} className="rounded-2xl border border-border bg-surface p-4">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">{initials(list[0].coachName)}</span>
                      <span className="font-semibold">{list[0].coachName}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {list.map((s) => (
                        <button
                          key={s.startsAt}
                          type="button"
                          onClick={() => setSlot(s)}
                          className={cn("rounded-xl border px-2 py-2.5 text-sm font-semibold transition", slot?.startsAt === s.startsAt && slot.coachId === s.coachId ? "border-brand bg-brand text-black" : "border-border hover:border-brand")}
                        >
                          {formatTime(s.startsAt, timezone)}
                          {s.capacity > 1 && <span className="block text-[10px] font-normal opacity-70">{s.remaining} left</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Summary */}
      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-3xl border border-border bg-surface p-6">
          <div className="eyebrow">Your booking</div>
          <h3 className="mt-2 font-display text-2xl font-extrabold tracking-tight">{type.name}</h3>
          <dl className="mt-5 grid gap-3 text-sm">
            <Row label="Duration" value={`${type.durationMinutes} minutes`} />
            <Row label="Date" value={date ? formatDate(new Date(`${date}T12:00:00Z`), "UTC", { weekday: "short", day: "numeric", month: "short" }) : "—"} />
            <Row label="Time" value={slot ? formatTime(slot.startsAt, timezone) : "—"} />
            <Row label="Coach" value={slot?.coachName ?? "—"} />
            <Row label="Price" value={slot ? quote?.label ?? "…" : type.priceLabel} highlight />
          </dl>
          {quote?.included && <Badge className="mt-3"><Sparkles className="size-3" />Uses your weekly session</Badge>}
          {slot && signedIn && (
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything your coach should know? (optional)" className="mt-5 min-h-20" maxLength={1000} />
          )}
          {signedIn ? (
            <Button size="lg" className="mt-5 w-full" disabled={!slot || submitting} onClick={book}>
              {submitting ? <Loader2 className="animate-spin" /> : <CalendarCheck />}
              {slot ? "Confirm booking" : "Select a time"}
            </Button>
          ) : (
            <Button asChild size="lg" className="mt-5 w-full"><Link href={`/login?next=${encodeURIComponent(`/book?type=${type.id}`)}`}>Sign in to book</Link></Button>
          )}
          {type.cancellationPolicy && <p className="mt-4 text-xs leading-relaxed text-muted">{type.cancellationPolicy}</p>}
        </div>
      </aside>
    </div>
  );
}

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="grid size-7 place-items-center rounded-full bg-brand text-xs font-black text-black">{n}</span>
      <h2 className="font-display text-xl font-bold tracking-tight">{label}</h2>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("text-right font-medium", highlight && "font-mono text-brand")}>{value}</dd>
    </div>
  );
}

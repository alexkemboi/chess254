import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import type { getSiteChrome } from "@/server/content";
import { WEEKDAYS, formatClock } from "@/lib/format";
import { SocialIcon } from "./social-icon";

type Chrome = Awaited<ReturnType<typeof getSiteChrome>>;

const COLUMNS = [
  { title: "Club", links: [["/memberships", "Memberships"], ["/coaches", "Coaches"], ["/book", "Book a session"], ["/events", "Events"], ["/about", "About"]] },
  { title: "Improve", links: [["/learn", "Academy"], ["/puzzles", "Puzzles"], ["/community", "Community"], ["/gallery", "Gallery"]] },
  { title: "Help", links: [["/faq", "FAQ"], ["/contact", "Contact"], ["/login", "Sign in"], ["/register", "Create account"]] },
];

/** Groups consecutive weekdays with the same hours: "Mon – Sun · 9:00 AM – 10:00 PM". */
function hourGroups(hours: NonNullable<Chrome["location"]>["openingHours"]) {
  const groups: { from: number; to: number; text: string }[] = [];
  for (const h of hours) {
    const text = h.closed ? "Closed" : `${formatClock(h.opensAt)} – ${formatClock(h.closesAt)}`;
    const last = groups.at(-1);
    if (last && last.text === text && last.to === h.weekday - 1) last.to = h.weekday;
    else groups.push({ from: h.weekday, to: h.weekday, text });
  }
  if (groups.length === 1 && groups[0].from === 0 && groups[0].to === 6) return [{ days: "Every day", text: groups[0].text }];
  return groups.map((g) => ({ days: g.from === g.to ? WEEKDAYS[g.from].slice(0, 3) : `${WEEKDAYS[g.from].slice(0, 3)} – ${WEEKDAYS[g.to].slice(0, 3)}`, text: g.text }));
}

export function Footer({ chrome, logo }: { chrome: Chrome; logo: React.ReactNode }) {
  const { settings, location, socials } = chrome;
  const year = new Date().getFullYear();
  return (
    <footer className="relative mt-24 overflow-hidden border-t border-border bg-surface/40">
      <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand/10 blur-3xl" />
      <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.4fr_2fr]">
        <div>
          {logo}
          {settings.general.tagline && <p className="mt-5 max-w-xs text-sm text-muted">{location ? `${location.address}, ${location.city} · ` : ""}{settings.general.tagline}</p>}
          <div className="mt-6 grid gap-2.5 text-sm text-muted">
            {location && (
              <a href={location.mapUrl || `https://maps.google.com/?q=${encodeURIComponent(`${location.address}, ${location.city}`)}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-foreground">
                <MapPin className="size-4 text-brand-ink" /> {location.address}, {location.city}
              </a>
            )}
            {settings.contact.phone && <a href={`tel:${settings.contact.phone}`} className="flex items-center gap-2 hover:text-foreground"><Phone className="size-4 text-brand-ink" />{settings.contact.phone}</a>}
            {settings.contact.email && <a href={`mailto:${settings.contact.email}`} className="flex items-center gap-2 hover:text-foreground"><Mail className="size-4 text-brand-ink" />{settings.contact.email}</a>}
          </div>
          {socials.length > 0 && (
            <div className="mt-6 flex gap-2">
              {socials.map((s) => (
                <a key={s.id} href={s.url} target="_blank" rel="noreferrer" aria-label={s.label || s.platform} className="grid size-10 place-items-center rounded-full border border-border text-muted transition hover:border-brand hover:text-brand-ink">
                  <SocialIcon platform={s.platform} className="size-4" />
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="eyebrow mb-4 text-muted">{col.title}</div>
              <ul className="grid gap-2.5 text-sm">
                {col.links.map(([href, label]) => (
                  <li key={href}><Link href={href} className="text-foreground/80 hover:text-brand-ink">{label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
          {location && location.openingHours.length > 0 && (
            <div>
              <div className="eyebrow mb-4 text-muted">Hours</div>
              <ul className="grid gap-2 text-sm">
                {hourGroups(location.openingHours).map((g) => (
                  <li key={g.days}><div className="text-foreground/80">{g.days}</div><div className="text-xs text-muted">{g.text}</div></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div className="relative border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted-2 sm:flex-row sm:justify-between sm:px-6">
          <span>© {year} {settings.general.siteName}</span>
          <span>{settings.general.tagline}</span>
        </div>
      </div>
    </footer>
  );
}

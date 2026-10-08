import type { Metadata } from "next";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { getSiteChrome, openStatus, seoFor } from "@/server/content";
import { Container, PageHero } from "@/components/site/cards";
import { ContactForm } from "@/components/site/contact-form";
import { SocialIcon } from "@/components/site/social-icon";
import { WEEKDAYS, formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const seo = await seoFor("/contact");
  return { title: seo?.title ?? "Contact", description: seo?.description ?? "Get in touch with the clubhouse.", alternates: { canonical: "/contact" } };
}

export default async function ContactPage() {
  const { settings, location, socials } = await getSiteChrome();
  const status = openStatus(location);
  const today = new Date().getDay();
  const mapQuery = location ? encodeURIComponent(`${location.address}, ${location.city}`) : null;
  return (
    <>
      <PageHero eyebrow="Contact" title="Come say" highlight="hello." body={settings.contact.contactIntro || null} />
      <Container className="grid gap-8 py-14 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid h-fit gap-4">
          {location && (
            <div className="rounded-3xl border border-border bg-surface p-6">
              <MapPin className="size-5 text-brand" />
              <h2 className="mt-3 font-display text-2xl font-bold tracking-tight">{location.name}</h2>
              <p className="mt-1 text-muted">{location.address}, {location.city}</p>
              {status && <p className="mt-3 flex items-center gap-2 text-sm"><span className={cn("size-2 rounded-full", status.open ? "bg-success" : "bg-muted-2")} />{status.label}{status.detail && <span className="text-muted">· {status.detail}</span>}</p>}
              {mapQuery && (
                <div className="mt-5 overflow-hidden rounded-2xl border border-border">
                  <iframe title="Map" src={location.mapUrl?.includes("/embed") ? location.mapUrl : `https://maps.google.com/maps?q=${mapQuery}&output=embed`} className="h-56 w-full grayscale invert-[.9] hue-rotate-180" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                </div>
              )}
            </div>
          )}
          {location && location.openingHours.length > 0 && (
            <div className="rounded-3xl border border-border bg-surface p-6">
              <Clock className="size-5 text-brand" />
              <h2 className="mt-3 font-semibold">Opening hours</h2>
              <ul className="mt-3 grid gap-1.5 text-sm">
                {location.openingHours.map((h) => (
                  <li key={h.id} className={cn("flex justify-between", h.weekday === today ? "font-semibold text-foreground" : "text-muted")}>
                    <span>{WEEKDAYS[h.weekday]}</span>
                    <span>{h.closed ? "Closed" : `${formatClock(h.opensAt)} – ${formatClock(h.closesAt)}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(settings.contact.phone || settings.contact.email || settings.contact.whatsapp || socials.length > 0) && (
            <div className="grid gap-2 rounded-3xl border border-border bg-surface p-6 text-sm">
              {settings.contact.phone && <a href={`tel:${settings.contact.phone}`} className="flex items-center gap-3 hover:text-brand"><Phone className="size-4 text-brand" />{settings.contact.phone}</a>}
              {settings.contact.whatsapp && <a href={`https://wa.me/${settings.contact.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:text-brand"><MessageCircle className="size-4 text-brand" />WhatsApp</a>}
              {settings.contact.email && <a href={`mailto:${settings.contact.email}`} className="flex items-center gap-3 hover:text-brand"><Mail className="size-4 text-brand" />{settings.contact.email}</a>}
              {socials.map((s) => <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:text-brand"><SocialIcon platform={s.platform} className="size-4 text-brand" />{s.label || s.platform}</a>)}
            </div>
          )}
        </div>
        <div className="h-fit rounded-3xl border border-border bg-surface p-6 sm:p-8">
          <h2 className="mb-6 font-display text-3xl font-extrabold tracking-tight">Send a message</h2>
          <ContactForm />
        </div>
      </Container>
    </>
  );
}

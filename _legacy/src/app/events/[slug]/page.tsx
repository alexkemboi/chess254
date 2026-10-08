import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await prisma.event.findFirst({ where: { slug, status: "PUBLISHED" } }).catch(() => null);
  if (!event) notFound();
  return <main className="subpage"><header className="subnav"><Link href="/" className="brand"><span className="brand-mark">♞</span>CHESS<span className="cyan">254</span></Link><Link href="/events" className="arrow-link">← All events</Link></header><section className="subhero"><div className="section-kicker">{event.startsAt.toLocaleDateString("en-KE", { dateStyle: "full" })}</div><h1>{event.title}</h1><p>{event.location}</p></section><section className="subcontent single-content"><div className="form-panel"><h2>Event details</h2><p className="long-copy">{event.description}</p><p className="form-note">{event.startsAt.toLocaleTimeString("en-KE", { timeStyle: "short" })} – {event.endsAt.toLocaleTimeString("en-KE", { timeStyle: "short" })}{event.capacity ? ` · ${event.capacity} places` : ""}</p><Link href="/join" className="button">Ask about registration <span>↗</span></Link></div></section></main>;
}

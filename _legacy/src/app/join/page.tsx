import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { InquiryForm } from "@/app/components/InquiryForm";
import { settingText } from "@/lib/content";

export const dynamic = "force-dynamic";
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const [{ plan: slug }, plans, settings] = await Promise.all([
    searchParams,
    prisma.membershipPlan.findMany({ where: { status: "ACTIVE" }, orderBy: { priority: "asc" } }).catch(() => []),
    prisma.siteSetting.findMany({ where: { key: { in: ["club.name", "club.contactEmail"] } } }).catch(() => []),
  ]);
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value])) as Record<string, unknown>;
  const selected = plans.find((p) => p.slug === slug);
  const contactEmail = settingText(map, "club.contactEmail", "");
  return <main className="subpage"><header className="subnav"><Link href="/" className="brand"><span className="brand-mark">♞</span>CHESS<span className="cyan">254</span></Link><Link href="/" className="arrow-link">← Back to the clubhouse</Link></header><section className="subhero"><div className="section-kicker">A SEAT AT THE TABLE</div><h1>Join the<br/><span>clubhouse.</span></h1><p>Share a little about yourself and we’ll get back to you with the next steps. This sends an enquiry to the club; it does not create a paid membership.</p></section><div className="subcontent">{plans.length > 0 && <aside className="join-plans"><h2>Memberships</h2>{plans.map((p) => <Link key={p.id} href={`/join?plan=${p.slug}`} className={selected?.id === p.id ? "selected-plan" : ""}><span>{p.name}</span><span>{p.currency} {Number(p.price).toLocaleString("en-KE")}</span></Link>)}</aside>}<section className="form-panel"><h2>{selected ? `Ask us about ${selected.name}` : "Tell us what brings you here"}</h2><InquiryForm selectedPlan={selected?.name}/>{contactEmail && <p className="form-note">Or email us at <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>}</section></div></main>;
}

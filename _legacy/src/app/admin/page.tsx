import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "@/app/admin/actions";

export const dynamic = "force-dynamic";
export default async function AdminDashboard() {
  const admin = await requireAdmin();
  let metrics;
  try {
    const [members, activeMemberships, pendingPayments, successfulPayments, bookings, events] = await Promise.all([
      prisma.user.count({ where: { role: "MEMBER", suspendedAt: null } }),
      prisma.membership.count({ where: { status: "ACTIVE", expiresAt: { gt: new Date() } } }),
      prisma.payment.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      prisma.payment.aggregate({ where: { status: "SUCCESS" }, _sum: { amount: true } }),
      prisma.booking.count({ where: { startsAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)), lt: new Date(new Date().setHours(24, 0, 0, 0)) }, status: { in: ["PENDING", "CONFIRMED"] } } }),
      prisma.event.count({ where: { status: "PUBLISHED", startsAt: { gte: new Date() } } }),
    ]);
    metrics = { members, activeMemberships, pendingPayments, revenue: Number(successfulPayments._sum.amount ?? 0), bookings, events };
  } catch { metrics = null; }
  if (!metrics) return <main className="subpage"><header className="subnav"><Link href="/" className="brand"><span className="brand-mark">♞</span>CHESS<span className="cyan">254</span></Link><form action={logoutAction}><button className="logout-button">Sign out ↗</button></form></header><section className="subhero"><div className="section-kicker">CLUBHOUSE / OVERVIEW</div><h1>Dashboard<br/><span>unavailable.</span></h1><p>We can’t load the club records right now. Check the database connection and migration, then try again.</p><Link href="/admin" className="button">Retry <span>↗</span></Link></section></main>;
  return <main className="admin-page"><aside className="admin-sidebar"><Link href="/" className="brand"><span className="brand-mark">♞</span>CHESS<span className="cyan">254</span></Link><div className="admin-label">CONTROL ROOM</div><Link className="admin-active" href="/admin">Overview</Link><Link href="/admin/memberships">Membership plans</Link><Link href="/events">Events</Link><Link href="/learn">Learning</Link><Link href="/gallery">Gallery</Link><div className="admin-spacer"/><span className="admin-who">{admin.name}<small>{admin.role.replace("_", " ")}</small></span><form action={logoutAction}><button className="logout-button">Sign out ↗</button></form></aside><section className="admin-main"><div className="section-kicker">CLUBHOUSE / OVERVIEW</div><h1>Good to see you,<br/><span>{admin.name.split(" ")[0]}.</span></h1><p className="admin-intro">A live snapshot from the club database.</p><div className="admin-stats">{[["Members", metrics.members], ["Active memberships", metrics.activeMemberships], ["Pending payments", metrics.pendingPayments], ["Successful payment total", `KES ${metrics.revenue.toLocaleString("en-KE")}`], ["Today’s bookings", metrics.bookings], ["Upcoming events", metrics.events]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div><div className="admin-section-head"><h2>Administration</h2><Link href="/admin/memberships" className="arrow-link">Manage membership plans ↗</Link></div><div className="admin-note">This dashboard reports records currently in PostgreSQL. Content and services not yet published stay out of the public site.</div></section></main>;
}

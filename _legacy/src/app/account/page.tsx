import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { logoutAccountAction } from "@/app/account/actions";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  const user = await requireUser("/account");
  const [memberships, bookings, registrations, completedLessons, notifications] = await Promise.all([
    prisma.membership.findMany({ where: { userId: user.id, status: "ACTIVE" }, include: { plan: true }, orderBy: { expiresAt: "asc" }, take: 3 }).catch(() => []),
    prisma.booking.findMany({ where: { memberId: user.id, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: new Date() } }, include: { sessionType: true, coach: { include: { user: true } } }, orderBy: { startsAt: "asc" }, take: 5 }).catch(() => []),
    prisma.eventRegistration.findMany({ where: { userId: user.id, status: { in: ["PENDING", "CONFIRMED"] }, event: { startsAt: { gte: new Date() } } }, include: { event: true }, orderBy: { event: { startsAt: "asc" } }, take: 5 }).catch(() => []),
    prisma.learningProgress.count({ where: { userId: user.id, completedAt: { not: null } } }).catch(() => 0),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }).catch(() => 0),
  ]);
  return <main className="account-dashboard"><header className="subnav"><Link href="/" className="brand"><span className="brand-mark">♞</span>CHESS<span className="cyan">254</span></Link><form action={logoutAccountAction}><button className="logout-button">Sign out ↗</button></form></header><section className="account-heading"><div className="section-kicker">MEMBER AREA</div><h1>Good to see you,<br/><span>{user.name.split(" ")[0]}.</span></h1><p>Your Chess254 clubhouse account.</p></section><section className="account-content"><div className="account-grid">
    <article className="account-card"><div className="account-card-head"><h2>Membership</h2><Link href="/join">Explore plans ↗</Link></div>{memberships.length ? memberships.map((membership) => <div className="account-line" key={membership.id}><strong>{membership.plan.name}</strong><span>Until {membership.expiresAt?.toLocaleDateString("en-KE", { dateStyle: "medium" }) ?? "—"}</span></div>) : <p className="account-empty">No active membership yet.</p>}</article>
    <article className="account-card"><div className="account-card-head"><h2>Upcoming coaching</h2><Link href="/events">Club calendar ↗</Link></div>{bookings.length ? bookings.map((booking) => <div className="account-line" key={booking.id}><strong>{booking.sessionType.name}</strong><span>{booking.startsAt.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })} · {booking.coach.user.name}</span></div>) : <p className="account-empty">No upcoming coaching sessions.</p>}</article>
    <article className="account-card"><div className="account-card-head"><h2>Registered events</h2><Link href="/events">Browse events ↗</Link></div>{registrations.length ? registrations.map((registration) => <div className="account-line" key={registration.id}><strong>{registration.event.title}</strong><span>{registration.event.startsAt.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</span></div>) : <p className="account-empty">You haven’t registered for an upcoming event.</p>}</article>
    <article className="account-card account-stats"><div><span>Lessons completed</span><strong>{completedLessons}</strong></div><div><span>Unread notifications</span><strong>{notifications}</strong></div><Link href="/learn">Browse learning materials ↗</Link></article>
    </div></section></main>;
}

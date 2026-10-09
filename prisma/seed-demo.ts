/**
 * Demo content for previewing the site: sample coaches (with weekly hours so
 * booking works), upcoming events, community posts and testimonials.
 *
 * Every row created here has an id starting with `demo_` and every demo
 * account uses the `@demo.chess254.invalid` email domain, so it can all be
 * removed before launch:
 *
 *   npm run db:seed:demo        # add or refresh the demo content
 *   npm run db:demo:remove      # delete it again
 *
 * When DEMO_PASSWORD is set in .env, every demo account (admin, moderator,
 * coaches, members) signs in with it; otherwise they cannot sign in.
 *
 * The people, quotes and events are fictional. Do not leave them on a live site.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient, type EventType, type PostKind } from "@prisma/client";

const prisma = new PrismaClient();
const DOMAIN = "demo.chess254.invalid";
const DAY = 86_400_000;

/** A UTC instant `days` from today at the given Nairobi (UTC+3) wall-clock time. */
function nairobi(days: number, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(Date.now() + days * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - 3, m));
}

const COACHES = [
  {
    key: "brian", name: "Brian Otieno", imageUrl: "/images/coaches/brian.webp", title: "Head coach", rating: 2050, position: 1,
    headline: "Turns your own games into a clear plan to 1800.",
    bio: "Brian has coached club players in Nairobi for over a decade. His lessons start from your recent games: we find the patterns that cost you points and build a weekly plan around them.\n\nHe runs the Player Development programme and the Thursday rapid nights.",
    specialties: ["Game review", "Middlegame planning", "Tournament preparation"],
    sessions: ["personal-lesson-review"],
    hours: [[1, "16:00", "21:00"], [2, "16:00", "21:00"], [3, "16:00", "21:00"], [4, "16:00", "21:00"], [5, "16:00", "21:00"]],
  },
  {
    key: "faith", name: "Faith Wanjiru", imageUrl: "/images/coaches/faith.webp", title: "Resident coach", rating: 1920, position: 2,
    headline: "Openings that fit your style, and endgames you can win.",
    bio: "Faith is a former national junior player who loves building practical opening repertoires. Expect clear ideas rather than long memorised lines, plus plenty of endgame technique.",
    specialties: ["Opening repertoire", "Endgames", "Junior players"],
    sessions: ["personal-lesson-review", "beginner-guided-session"],
    hours: [[2, "10:00", "18:00"], [4, "10:00", "18:00"], [6, "10:00", "18:00"], [0, "10:00", "16:00"]],
  },
  {
    key: "kevin", name: "Kevin Mwangi", imageUrl: "/images/coaches/kevin.webp", title: "Beginner coach", rating: 1750, position: 3,
    headline: "Your first moves, explained patiently.",
    bio: "Kevin works with players who are new to the game or coming back to it. He teaches at the board, one idea at a time, until you can play a full game with confidence.",
    specialties: ["Beginners", "Tactics", "Adult learners"],
    sessions: ["beginner-guided-session"],
    hours: [[6, "09:00", "13:00"], [0, "09:00", "13:00"], [3, "17:00", "20:00"]],
  },
  {
    key: "amina", name: "Amina Hassan", imageUrl: "/images/coaches/amina.webp", title: "Sparring coach", rating: 1980, position: 4,
    headline: "Serious games, then honest feedback.",
    bio: "Amina runs the evening sparring tables. Play a serious game against her, then go through it move by move to see where it turned.",
    specialties: ["Sparring", "Calculation", "Time management"],
    sessions: ["personal-lesson-review"],
    hours: [[1, "18:00", "22:00"], [3, "18:00", "22:00"], [5, "18:00", "22:00"], [6, "14:00", "20:00"]],
  },
] as const;

const STAFF = [
  { key: "admin", name: "Demo Admin", role: "ADMIN" },
  { key: "moderator", name: "Demo Moderator", role: "MODERATOR" },
] as const;

const MEMBERS = [
  { key: "njeri", name: "Njeri Kamau" },
  { key: "david", name: "David Ochieng" },
  { key: "sam", name: "Samuel Kiprop" },
];

const EVENTS: {
  key: string; title: string; type: EventType; days: number; start: string; end: string; excerpt: string; description: string;
  cover: string; capacity: number | null; price: number; memberPrice: number | null; timeControl?: string; format?: string; prizeInfo?: string; featured?: boolean;
}[] = [
  {
    key: "rapid", title: "Thursday Rapid Night", type: "RAPID_TOURNAMENT", days: 6, start: "18:00", end: "21:30",
    excerpt: "Five rounds of 10+5 rapid after work. All levels welcome.",
    description: "Our weekly rapid tournament. Pairings are by rating so everyone gets competitive games.\n\nArrive by 17:45 to check in. Boards, clocks and tea are provided.",
    cover: "/gallery/player-focus.jpg", capacity: 32, price: 500, memberPrice: 300, timeControl: "10+5", format: "5-round Swiss", featured: true,
  },
  {
    key: "blitz", title: "Saturday Blitz Arena", type: "BLITZ_TOURNAMENT", days: 9, start: "15:00", end: "18:00",
    excerpt: "Three hours of non-stop 3+2 blitz. Most points wins.",
    description: "An arena-style blitz event: finish a game, get paired again straight away. Streak bonuses for consecutive wins.",
    cover: "/gallery/checkmate.jpg", capacity: 40, price: 400, memberPrice: 200, timeControl: "3+2", format: "Arena", prizeInfo: "Trophies for the top three and the best junior.",
  },
  {
    key: "kids", title: "Kids' Chess Morning", type: "KIDS_SESSION", days: 10, start: "09:30", end: "12:00",
    excerpt: "Fun games and puzzles for ages 6–14, led by our coaches.",
    description: "A relaxed morning for young players: a short lesson, puzzle challenges and friendly games. Parents are welcome to stay and play.",
    cover: "/gallery/giant-rook.jpg", capacity: 20, price: 800, memberPrice: 500,
  },
  {
    key: "camp", title: "Endgame Training Camp", type: "TRAINING_CAMP", days: 20, start: "10:00", end: "16:00",
    excerpt: "A full day on the endgames every club player needs to know.",
    description: "Rook endgames, king and pawn technique and practical defence, taught in small groups with lots of practice positions. Lunch included.",
    cover: "/gallery/end-game-package.jpg", capacity: 16, price: 3500, memberPrice: 2500, format: "Small-group workshop",
  },
  {
    key: "hangout", title: "Chess & Chill Hangout", type: "HANGOUT", days: 13, start: "16:00", end: "20:00",
    excerpt: "Casual games, music and good company. No clocks required.",
    description: "Bring a friend, play casual games, try the giant board and meet the community.",
    cover: "/gallery/hangouts-smile.jpg", capacity: null, price: 0, memberPrice: null,
  },
];

const POSTS: { key: string; author: string; kind: PostKind; title: string; body: string; pinned?: boolean; daysAgo: number; comments: [string, string][]; likes: string[] }[] = [
  {
    key: "welcome", author: "coach:brian", kind: "DISCUSSION", pinned: true, daysAgo: 12,
    title: "Welcome to the Chess254 community 👋",
    body: "This is the place to share your games, ask questions and find sparring partners. Introduce yourself below: what's your rating, and what are you working on this month?",
    comments: [["njeri", "Hi all! About 1200 and working on not hanging pieces in time trouble 😅"], ["sam", "Returning player here, aiming for my first rated tournament this year."]],
    likes: ["njeri", "david", "sam"],
  },
  {
    key: "london", author: "david", kind: "QUESTION", daysAgo: 5,
    title: "How do I play against the London System?",
    body: "I keep getting a passive position as Black against the London. Any simple setups you'd recommend for a 1400 player?",
    comments: [["coach:faith", "Try an early ...c5 and ...Qb6 to hit b2. It forces White to make a decision early. Bring a game on Tuesday and we'll go through it."], ["njeri", "Same problem here, following this!"]],
    likes: ["njeri"],
  },
  {
    key: "first-win", author: "njeri", kind: "ACHIEVEMENT", daysAgo: 2,
    title: "First tournament win at Rapid Night!",
    body: "4.5/5 last Thursday. The weekly game reviews are really paying off. Thanks to everyone who gave me tough games.",
    comments: [["coach:brian", "Well deserved. That endgame in round 4 was very clean."]],
    likes: ["david", "sam"],
  },
  {
    key: "sparring", author: "sam", kind: "DISCUSSION", daysAgo: 1,
    title: "Looking for a regular sparring partner (around 1500)",
    body: "I'm at the clubhouse most weekday evenings after 6. Looking for someone to play longer games with (30+0) and review together afterwards.",
    comments: [],
    likes: [],
  },
];

const TESTIMONIALS = [
  { name: "Njeri K.", roleLabel: "Player Development member", quote: "Having my own games reviewed every week changed everything. I finally know what to work on." },
  { name: "David O.", roleLabel: "Clubhouse Sparring member", quote: "There's always someone to play. I've had more serious games in a month here than in a year online." },
  { name: "Grace M.", roleLabel: "Parent", quote: "My son looks forward to Saturday mornings all week. The coaches are patient and the atmosphere is welcoming." },
];

async function demoPassword() {
  return bcrypt.hash(process.env.DEMO_PASSWORD || randomBytes(32).toString("hex"), 10);
}

async function seed() {
  const passwordHash = await demoPassword();
  const location = await prisma.location.findFirst({ orderBy: { createdAt: "asc" } });
  const sessionTypes = await prisma.sessionType.findMany({ select: { id: true, slug: true } });
  const sessionId = (slug: string) => sessionTypes.find((s) => s.slug === slug)?.id;

  // ── Coaches ────────────────────────────────────────────────────────────
  const coachIds: Record<string, { userId: string; coachId: string }> = {};
  for (const c of COACHES) {
    const userId = `demo_user_coach_${c.key}`;
    const coachId = `demo_coach_${c.key}`;
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, email: `${c.key}.coach@${DOMAIN}`, name: c.name, role: "COACH", passwordHash, emailVerifiedAt: new Date() },
      update: { name: c.name, role: "COACH", passwordHash, suspendedAt: null },
    });
    const sessions = c.sessions.map(sessionId).filter((id): id is string => Boolean(id)).map((id) => ({ id }));
    const data = {
      slug: c.name.toLowerCase().replace(/\s+/g, "-"), title: c.title, headline: c.headline, bio: c.bio,
      specialties: [...c.specialties], imageUrl: c.imageUrl, rating: c.rating, position: c.position, isActive: true, acceptsBookings: true,
    };
    await prisma.coachProfile.upsert({
      where: { id: coachId },
      create: { id: coachId, userId, ...data, sessionTypes: { connect: sessions } },
      update: { ...data, sessionTypes: { set: sessions } },
    });
    await prisma.coachAvailability.deleteMany({ where: { coachId } });
    await prisma.coachAvailability.createMany({
      data: c.hours.map(([weekday, startTime, endTime], i) => ({ id: `demo_avail_${c.key}_${i}`, coachId, weekday, startTime, endTime })),
    });
    coachIds[c.key] = { userId, coachId };
  }

  // ── Members (community authors) ────────────────────────────────────────
  const userIds: Record<string, string> = {};
  for (const m of MEMBERS) {
    const id = `demo_user_${m.key}`;
    await prisma.user.upsert({
      where: { id },
      create: { id, email: `${m.key}@${DOMAIN}`, name: m.name, role: "MEMBER", passwordHash, emailVerifiedAt: new Date() },
      update: { name: m.name, passwordHash, suspendedAt: null },
    });
    userIds[m.key] = id;
  }
  for (const s of STAFF) {
    const id = `demo_user_${s.key}`;
    await prisma.user.upsert({
      where: { id },
      create: { id, email: `${s.key}@${DOMAIN}`, name: s.name, role: s.role, passwordHash, emailVerifiedAt: new Date() },
      update: { name: s.name, role: s.role, passwordHash, suspendedAt: null },
    });
  }

  // Njeri has an active Player Development membership and Brian as her coach,
  // so the member and coach dashboards have something to show.
  const plan = await prisma.membershipPlan.findFirst({ where: { featured: true, status: "ACTIVE" } });
  if (plan) {
    const data = { userId: userIds.njeri, planId: plan.id, status: "ACTIVE" as const, startsAt: new Date(Date.now() - 5 * DAY), expiresAt: new Date(Date.now() + 25 * DAY) };
    await prisma.membership.upsert({ where: { id: "demo_membership_njeri" }, create: { id: "demo_membership_njeri", ...data }, update: data });
  }
  await prisma.coachMember.upsert({
    where: { coachId_memberId: { coachId: coachIds.brian.coachId, memberId: userIds.njeri } },
    create: { coachId: coachIds.brian.coachId, memberId: userIds.njeri },
    update: {},
  });
  for (const [key, ids] of Object.entries(coachIds)) userIds[`coach:${key}`] = ids.userId;

  // ── Events ─────────────────────────────────────────────────────────────
  for (const e of EVENTS) {
    const id = `demo_event_${e.key}`;
    const startsAt = nairobi(e.days, e.start);
    const data = {
      title: e.title, slug: `${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`, type: e.type,
      excerpt: e.excerpt, description: e.description, coverImage: e.cover, startsAt, endsAt: nairobi(e.days, e.end),
      locationId: location?.id ?? null, capacity: e.capacity, price: e.price, memberPrice: e.memberPrice,
      registrationDeadline: new Date(startsAt.getTime() - 2 * 3_600_000), registrationOpen: true,
      timeControl: e.timeControl ?? null, format: e.format ?? null, prizeInfo: e.prizeInfo ?? null, featured: e.featured ?? false,
      status: "PUBLISHED" as const, deletedAt: null,
    };
    await prisma.event.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  // ── Community ──────────────────────────────────────────────────────────
  for (const p of POSTS) {
    const id = `demo_post_${p.key}`;
    const createdAt = new Date(Date.now() - p.daysAgo * DAY);
    const data = {
      authorId: userIds[p.author], kind: p.kind, title: p.title, body: p.body, pinned: p.pinned ?? false, status: "VISIBLE" as const,
      likeCount: p.likes.length, commentCount: p.comments.length, createdAt,
    };
    await prisma.communityPost.upsert({ where: { id }, create: { id, ...data }, update: data });
    await prisma.communityComment.deleteMany({ where: { postId: id, id: { startsWith: "demo_" } } });
    await prisma.communityComment.createMany({
      data: p.comments.map(([author, body], i) => ({ id: `demo_comment_${p.key}_${i}`, postId: id, authorId: userIds[author], body, createdAt: new Date(createdAt.getTime() + (i + 1) * 3_600_000) })),
    });
    await prisma.communityLike.deleteMany({ where: { postId: id, userId: { in: Object.values(userIds) } } });
    await prisma.communityLike.createMany({ data: p.likes.map((u) => ({ postId: id, userId: userIds[u] })) });
    // Keep the counters consistent with any likes/comments real users added.
    const [likes, comments] = await Promise.all([
      prisma.communityLike.count({ where: { postId: id } }),
      prisma.communityComment.count({ where: { postId: id, status: "VISIBLE" } }),
    ]);
    await prisma.communityPost.update({ where: { id }, data: { likeCount: likes, commentCount: comments } });
  }

  // ── Testimonials ───────────────────────────────────────────────────────
  for (const [i, t] of TESTIMONIALS.entries()) {
    const id = `demo_testimonial_${i}`;
    const data = { ...t, position: i + 1, visible: true };
    await prisma.testimonial.upsert({ where: { id }, create: { id, ...data }, update: data });
  }

  console.log(`Demo content added: ${COACHES.length} coaches, ${EVENTS.length} events, ${POSTS.length} community posts, ${TESTIMONIALS.length} testimonials.`);
  console.log(process.env.DEMO_PASSWORD ? `Demo accounts sign in with DEMO_PASSWORD from .env (emails end in @${DOMAIN}).` : "DEMO_PASSWORD is not set, so demo accounts cannot sign in.");
  console.log("Remove it before launch with: npm run db:demo:remove");
}

async function remove() {
  const demo = { startsWith: "demo_" };
  const demoUsers = { email: { endsWith: `@${DOMAIN}` } };

  // Coaches or events that real customers have already booked or paid for are
  // hidden rather than deleted, so those orders and bookings stay intact.
  const bookedCoaches = await prisma.coachProfile.findMany({ where: { id: demo, bookings: { some: {} } }, select: { id: true, userId: true } });
  const usedEvents = await prisma.event.findMany({ where: { id: demo, OR: [{ registrations: { some: {} } }, { orderItems: { some: {} } }] }, select: { id: true } });
  if (bookedCoaches.length) {
    await prisma.coachProfile.updateMany({ where: { id: { in: bookedCoaches.map((c) => c.id) } }, data: { isActive: false, acceptsBookings: false } });
  }
  if (usedEvents.length) {
    await prisma.event.updateMany({ where: { id: { in: usedEvents.map((e) => e.id) } }, data: { status: "CANCELLED", deletedAt: new Date() } });
  }
  const keepUserIds = bookedCoaches.map((c) => c.userId);

  await prisma.testimonial.deleteMany({ where: { id: demo } });
  await prisma.event.deleteMany({ where: { id: demo, NOT: { id: { in: usedEvents.map((e) => e.id) } } } });
  await prisma.communityComment.deleteMany({ where: { OR: [{ id: demo }, { author: demoUsers }] } });
  await prisma.communityPost.deleteMany({ where: { OR: [{ id: demo }, { author: demoUsers }] } });
  await prisma.membership.deleteMany({ where: { OR: [{ id: demo }, { user: demoUsers }], payments: { none: {} } } });
  await prisma.coachProfile.deleteMany({ where: { id: demo, NOT: { id: { in: bookedCoaches.map((c) => c.id) } } } });
  const { count } = await prisma.user.deleteMany({ where: { ...demoUsers, NOT: { id: { in: keepUserIds } } } });

  console.log(`Demo content removed (${count} demo accounts).`);
  if (bookedCoaches.length || usedEvents.length) {
    console.log(`Kept but hidden because real bookings or orders reference them: ${bookedCoaches.length} coach(es), ${usedEvents.length} event(s).`);
  }
}

(process.argv.includes("--remove") ? remove() : seed())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

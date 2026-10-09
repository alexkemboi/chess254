/**
 * Seeds Chess254's initial configuration and content into PostgreSQL.
 * Everything here is data the club can edit or delete from the admin portal;
 * the application contains no logic keyed to these names, prices or slugs.
 * Re-running is safe: records are upserted by their natural keys and existing
 * admin edits are left untouched (`update: {}`).
 */
import bcrypt from "bcryptjs";
import { Chess } from "chess.js";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PERMISSION_CATALOGUE } from "../src/lib/permissions";

const prisma = new PrismaClient();

async function setting(key: string, value: Prisma.InputJsonValue) {
  await prisma.siteSetting.upsert({ where: { key }, create: { key, value }, update: {} });
}

function assertPuzzle(fen: string, solution: string[]) {
  const chess = new Chess(fen);
  for (const uci of solution) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

async function main() {
  // ── Permissions ─────────────────────────────────────────────────────────
  for (const [key, def] of Object.entries(PERMISSION_CATALOGUE)) {
    const permission = await prisma.permission.upsert({
      where: { key },
      create: { key, description: def.description, group: def.group },
      update: { description: def.description, group: def.group },
    });
    const existing = await prisma.rolePermission.count({ where: { permissionId: permission.id } });
    if (existing === 0) {
      for (const role of def.defaults) {
        await prisma.rolePermission.create({ data: { role, permissionId: permission.id } });
      }
    }
  }

  // ── Settings ────────────────────────────────────────────────────────────
  await setting("general", { siteName: "Chess254", tagline: "Play. Improve. Belong.", siteUrl: process.env.NEXT_PUBLIC_APP_URL ?? "", timezone: "Africa/Nairobi", currency: "KES" });
  await setting("brand", { logoText: "Chess", logoAccent: "254", primaryColor: "#019C98", heroImage: "/gallery/githinji.jpg", ogImage: "/gallery/launch-crowd.jpg" });
  await setting("contact", { email: "", phone: "", whatsapp: "", contactIntro: "Questions about memberships, coaching or events? Send the team a message and we'll get back to you." });
  await setting("booking", {
    slotIntervalMinutes: 30,
    minNoticeHours: 2,
    maxAdvanceDays: 30,
    cancellationHours: 12,
    holdMinutes: 15,
    maxActiveBookingsPerMember: 10,
    cancellationPolicy: "Confirmed sessions can be cancelled up to 12 hours before they start. Later cancellations and no-shows count as a used session.",
  });
  await setting("membership", { renewalReminderDays: 5, allowEarlyRenewal: true, joinIntro: "Choose your membership and register your interest. We'll help place you with the right playing group and coaching level." });
  await setting("payments", { taxRatePercent: 0, taxInclusive: true, taxLabel: "VAT", orderExpiryMinutes: 30, invoicePrefix: "C254", invoiceFooter: "Thank you for playing at Chess254." });
  await setting("notifications", { emailEnabled: true, smsEnabled: false, bookingReminderHours: 24, adminAlertEmail: "" });
  await setting("email", { fromName: "Chess254", fromEmail: process.env.EMAIL_FROM ?? "", replyTo: "" });
  await setting("seo", {
    defaultTitle: "Chess254 Clubhouse — Westlands, Nairobi",
    titleTemplate: "%s · Chess254",
    defaultDescription: "A home for chess players in Nairobi. Daily play, resident coaches, events and a community that loves the game.",
    keywords: "chess Nairobi, chess club Kenya, chess coaching Westlands, Chess254",
    twitterHandle: "",
  });
  await setting("events", { cancellationHours: 24, showPastEvents: true });
  await setting("community", { enabled: true, requireMembershipToPost: false, guidelines: "Be kind, keep it about chess, and respect every player at every level." });

  // ── Location & hours ────────────────────────────────────────────────────
  const location = await prisma.location.upsert({
    where: { slug: "westlands" },
    create: {
      name: "Chess254 Westlands",
      slug: "westlands",
      address: "The Mall, Westlands",
      city: "Nairobi",
      description: "A daily chess clubhouse for play, coaching, events and community.",
      timezone: "Africa/Nairobi",
      openingDate: new Date("2026-09-14T00:00:00+03:00"),
      isPrimary: true,
    },
    update: {},
  });
  for (let weekday = 0; weekday < 7; weekday++) {
    await prisma.openingHour.upsert({
      where: { locationId_weekday: { locationId: location.id, weekday } },
      create: { locationId: location.id, weekday, opensAt: "09:00", closesAt: "22:00" },
      update: {},
    });
  }

  // ── Session types & services ────────────────────────────────────────────
  const lesson = await prisma.sessionType.upsert({
    where: { slug: "personal-lesson-review" },
    create: {
      name: "Personal lesson & game review",
      slug: "personal-lesson-review",
      description: "A one-to-one lesson built around your recent games and assigned work, plus clubhouse play for the visit.",
      durationMinutes: 60,
      price: 1500,
      capacity: 1,
      status: "ACTIVE",
      position: 1,
    },
    update: {},
  });
  const beginner = await prisma.sessionType.upsert({
    where: { slug: "beginner-guided-session" },
    create: {
      name: "Beginner guided session",
      slug: "beginner-guided-session",
      description: "Guided instruction at the board for players who are still learning to play independently.",
      durationMinutes: 60,
      price: 0,
      capacity: 4,
      membershipRequired: true,
      status: "ACTIVE",
      position: 2,
    },
    update: {},
  });
  await prisma.service.upsert({
    where: { slug: "clubhouse-day-pass" },
    create: { name: "Clubhouse day pass", slug: "clubhouse-day-pass", description: "Per-visit clubhouse access after 4 PM.", price: 300, validityHours: 12, status: "ACTIVE", position: 1 },
    update: {},
  });

  // ── Membership plans ────────────────────────────────────────────────────
  const plans = [
    {
      slug: "clubhouse-sparring",
      name: "Clubhouse Sparring",
      audience: "For experienced players",
      description: "For players who want a dependable chess home and serious games every day.",
      price: 3000,
      accessStartTime: "16:00",
      learningAccess: false,
      priority: 10,
      featured: false,
      features: [
        "Access every day from 4:00 PM until late",
        "A playing partner available every day",
        "Regular games and sparring",
        "Chess254 club activities and community",
        "Discounted entry to selected tournaments and events",
      ],
    },
    {
      slug: "player-development",
      name: "Player Development",
      audience: "For players who want to improve",
      description: "For absolute beginners through developing players who want a clear path towards 1800.",
      price: 7500,
      accessStartTime: null,
      learningAccess: true,
      priority: 20,
      featured: true,
      features: [
        "Full clubhouse access and daily games",
        "Play and spar with resident coaches",
        "One personalised lesson / review every week",
        "Your games and assigned work are reviewed before your lesson",
        "A tailored improvement plan based on your actual play",
        "Beginners receive guided instruction whenever they visit until they can play independently",
        "Ideal from absolute beginner to approximately 1800",
        "Discounted entry to selected tournaments and events",
      ],
    },
  ];
  const planIds: Record<string, string> = {};
  for (const { features, ...data } of plans) {
    const plan = await prisma.membershipPlan.upsert({
      where: { slug: data.slug },
      create: { ...data, currency: "KES", billingPeriod: "MONTHLY", status: "ACTIVE", features: { create: features.map((label, position) => ({ label, position })) } },
      update: {},
    });
    planIds[data.slug] = plan.id;
  }
  await prisma.planEntitlement.upsert({
    where: { planId_sessionTypeId: { planId: planIds["player-development"], sessionTypeId: lesson.id } },
    create: { planId: planIds["player-development"], sessionTypeId: lesson.id, quantity: 1, period: "WEEK" },
    update: {},
  });
  const beginnerPlans = await prisma.sessionType.findUnique({ where: { id: beginner.id }, include: { allowedPlans: true } });
  if (beginnerPlans && beginnerPlans.allowedPlans.length === 0) {
    await prisma.sessionType.update({ where: { id: beginner.id }, data: { allowedPlans: { connect: { id: planIds["player-development"] } } } });
  }

  // ── CMS blocks ──────────────────────────────────────────────────────────
  const blocks: Prisma.ContentBlockCreateInput[] = [
    {
      key: "home.hero", page: "home", position: 1,
      eyebrow: "Chess254 Clubhouse · Westlands",
      title: "Play more.", highlight: "Improve faster.",
      body: "A home for chess players in Nairobi. Come in, find a game, meet other players, work with resident coaches and build your chess — from your very first moves all the way to 1800 and beyond.",
      imageUrl: "/gallery/githinji.jpg",
      ctaLabel: "See memberships", ctaHref: "/memberships", secondaryLabel: "Register / book", secondaryHref: "/book",
    },
    {
      key: "home.location", page: "home", position: 2,
      eyebrow: "Our first location", title: "Westlands, Nairobi",
      body: "A daily chess clubhouse for play, coaching, events and community.",
      items: [
        { title: "Daily", body: "Clubhouse access" },
        { title: "4 PM → Late", body: "Guaranteed sparring" },
        { title: "Resident coaches", body: "Guided improvement" },
        { title: "All levels", body: "Beginner to expert" },
      ],
    },
    { key: "home.ticker", page: "home", position: 3, items: [{ title: "Play" }, { title: "Learn" }, { title: "Connect" }, { title: "Grow" }] },
    {
      key: "home.memberships", page: "home", position: 4,
      eyebrow: "Choose how you want to use Chess254", title: "Two simple memberships.",
      body: "Choose daily play, or combine daily play with a structured improvement programme.",
    },
    {
      key: "home.method", page: "home", position: 5,
      eyebrow: "A chess gym, not a once-a-week class", title: "Play. Review. Improve.",
      items: [
        { title: "Play regularly", body: "Come to the clubhouse and get real games instead of waiting for your next class or tournament." },
        { title: "We learn from your games", body: "Your games and weekly work show our coaches what you actually need to work on." },
        { title: "Your coaching becomes personal", body: "Your weekly session targets your real strengths, mistakes and next steps." },
      ],
    },
    {
      key: "home.cta", page: "home", position: 9,
      eyebrow: "Join Chess254 Westlands", title: "Ready to play?",
      body: "Choose your membership and register your interest. We'll help place you with the right playing group and coaching level.",
      ctaLabel: "Register for Westlands", ctaHref: "/register",
    },
    {
      key: "about.intro", page: "about", position: 1,
      eyebrow: "About Chess254", title: "A chess home", highlight: "in Nairobi.",
      body: "If you've been looking for a chess home to learn, play, improve, and meet people who actually love the game — welcome to Chess254. Whether you're completely new to chess, getting back into the game, or already obsessed with your next move, there's a spot for you at the Chess254 Clubhouse.",
      imageUrl: "/gallery/this-is-the-place.jpg",
    },
    {
      key: "about.hangouts", page: "about", position: 2,
      eyebrow: "Chess hangouts", title: "Come for the game.", highlight: "Stay for the people.",
      body: "The banter, the side quests and the \"one last game\" that somehow becomes five. Whether you're a chess baby, a casual player or the person who takes your queen personally, there's a board waiting for you. And beginners? Relax — we've got a trainer on the ground.",
      imageUrl: "/gallery/hangouts-smile.jpg",
      items: [{ title: "Expect new faces." }, { title: "Expect new rivals." }, { title: "Expect new moves." }, { title: "Expect to find your people." }],
    },
  ];
  for (const block of blocks) await prisma.contentBlock.upsert({ where: { key: block.key }, create: block, update: {} });

  if ((await prisma.announcement.count()) === 0) {
    await prisma.announcement.create({ data: { title: "Chess254 Westlands opens Monday, 14 September 2026.", published: true } });
  }
  if ((await prisma.socialLink.count()) === 0) {
    await prisma.socialLink.create({ data: { platform: "instagram", label: "@_chess254", url: "https://www.instagram.com/_chess254/" } });
  }

  if ((await prisma.fAQ.count()) === 0) {
    const faqs = [
      ["How do I join?", "Create an account, choose a membership and pay with M-Pesa. Your membership activates as soon as the payment is confirmed.", "Membership"],
      ["How much does it cost?", "Current membership prices are always listed on the memberships page. You can also pay per visit with a day pass or book a single lesson.", "Membership"],
      ["Can I come in without a membership?", "Yes. Buy a clubhouse day pass for a single visit after 4 PM, or book a one-off lesson and play visit.", "Visiting"],
      ["I'm a complete beginner. Is that okay?", "Absolutely. Player Development members receive guided instruction whenever they visit until they can play independently, and there's a trainer on the ground at hangouts.", "Coaching"],
      ["Do you have sessions for kids?", "Yes — kids sessions run on Saturdays from 9 AM to 4 PM.", "Coaching"],
      ["Where is the clubhouse?", "Chess254 Clubhouse is at The Mall, Westlands, Nairobi.", "Visiting"],
    ];
    await prisma.fAQ.createMany({ data: faqs.map(([question, answer, category], position) => ({ question, answer, category, position })) });
  }

  // ── Gallery ─────────────────────────────────────────────────────────────
  const categories = ["Clubhouse", "Players", "Coaching", "Community", "Events", "Tournaments", "Kids"];
  const catIds: Record<string, string> = {};
  for (const [position, name] of categories.entries()) {
    const c = await prisma.galleryCategory.upsert({ where: { slug: name.toLowerCase() }, create: { name, slug: name.toLowerCase(), position }, update: {} });
    catIds[name] = c.id;
  }
  const images: [string, string, string, number, number, boolean, string?][] = [
    ["githinji.jpg", "Deep in thought", "Players", 1352, 1365, true],
    ["this-is-the-place.jpg", "This is the place", "Clubhouse", 334, 520, true],
    ["hangouts-smile.jpg", "Chess hangouts", "Community", 740, 765, true],
    ["launch-crowd.jpg", "Launch night", "Events", 978, 983, true],
    ["chess254-cake.jpg", "The Chess254 cake", "Events", 737, 986, false],
    ["end-game-package.jpg", "End game package", "Clubhouse", 300, 536, false],
    ["demo-board.jpg", "The demo board", "Coaching", 546, 590, false],
    ["player-focus.jpg", "Game face", "Players", 280, 342, false],
    ["checkmate.jpg", "Checkmate", "Players", 280, 342, false],
    ["clubhouse-welcome.jpg", "Welcome in", "Community", 280, 340, false],
    ["opening-speech.jpg", "Opening night", "Events", 280, 340, false],
    ["chess-therapy.jpg", "Chess therapy", "Community", 282, 240, false],
    ["giant-rook.jpg", "The giant rook", "Clubhouse", 280, 340, false],
    ["launch-announcement.jpg", "Tomorrow is the day", "Events", 280, 217, false],
    ["grand-opening-poster.jpg", "Grand Opening & Team Kenya send-off", "Events", 280, 254, false],
  ];
  if ((await prisma.galleryImage.count()) === 0) {
    await prisma.galleryImage.createMany({
      data: images.map(([file, title, category, width, height, featured], position) => ({
        imageUrl: `/gallery/${file}`, title, alt: title, categoryId: catIds[category], width, height, featured, position,
      })),
    });
  }

  // ── Events (from published Chess254 announcements) ───────────────────────
  await prisma.event.upsert({
    where: { slug: "grand-opening-team-kenya-send-off" },
    create: {
      title: "Grand Opening & Team Kenya Send Off",
      slug: "grand-opening-team-kenya-send-off",
      type: "COMMUNITY",
      excerpt: "A new home for chess in Nairobi.",
      description: "Chess254 opened its doors with a celebration of the game and a send-off for Team Kenya. Whether you came to play, learn, compete or simply see what Chess254 is about — this was the day we connected.",
      coverImage: "/gallery/grand-opening-poster.jpg",
      startsAt: new Date("2026-09-13T12:00:00+03:00"),
      endsAt: new Date("2026-09-13T22:00:00+03:00"),
      locationId: location.id,
      price: 0,
      registrationOpen: false,
      status: "COMPLETED",
    },
    update: {},
  });

  // ── Learning ────────────────────────────────────────────────────────────
  const learningCats = [
    ["Beginner Chess", "Your first moves: rules, piece movement and basic checkmates."],
    ["Openings", "Principles and plans for the first phase of the game."],
    ["Tactics", "Forks, pins, skewers and the patterns that win material."],
    ["Strategy", "Pawn structures, piece activity and long-term planning."],
    ["Endgames", "Essential endings every improving player must know."],
    ["Game Analysis", "Learn from your own games and from the classics."],
    ["Chess Psychology", "Focus, time management and competitive mindset."],
  ];
  const lc: Record<string, string> = {};
  for (const [position, [name, description]] of learningCats.entries()) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const c = await prisma.learningCategory.upsert({ where: { slug }, create: { name, slug, description, position }, update: {} });
    lc[name] = c.id;
  }
  const materials: Prisma.LearningMaterialUncheckedCreateInput[] = [
    {
      categoryId: lc["Openings"], slug: "three-opening-principles", title: "Three opening principles", coverImage: "/images/learn/three-opening-principles.webp", type: "ARTICLE", level: "Beginner", durationMinutes: 6, access: "PUBLIC", published: true,
      summary: "Control the centre, develop your pieces and get your king safe — the habits that make every opening playable.",
      body: "## 1. Fight for the centre\nPawns and pieces on **e4, d4, e5 and d5** control the most squares and restrict your opponent. Start with a central pawn move.\n\n## 2. Develop with purpose\nBring knights and bishops out before moving the same piece twice. A useful rule: *knights before bishops*, and don't bring the queen out early where she can be chased.\n\n## 3. Castle early\nCastling tucks your king away and connects your rooks. Most strong players castle within the first ten moves.\n\n### Try it\nIn your next game, count how many pieces you've developed by move 8. Aim for at least four.",
    },
    {
      categoryId: lc["Tactics"], slug: "the-knight-fork", title: "The knight fork", coverImage: "/images/learn/the-knight-fork.webp", type: "ARTICLE", level: "Beginner", durationMinutes: 5, access: "PUBLIC", published: true,
      summary: "How one knight can attack two pieces at once — and how to spot the squares where it happens.",
      body: "A **fork** is a single move that attacks two or more pieces. Knights are the best forkers because their jumps can't be blocked.\n\n### Spotting forks\n1. Look for enemy pieces that sit a knight's move apart from the same square.\n2. Check if that square is safe for your knight.\n3. The most powerful forks include a **check**, because your opponent must deal with the king first.\n\nSolve the fork puzzle in the puzzle room to practise the pattern.",
    },
    {
      categoryId: lc["Endgames"], slug: "king-and-pawn-the-opposition", title: "King and pawn: the opposition", coverImage: "/images/learn/king-and-pawn-the-opposition.webp", type: "ARTICLE", level: "Intermediate", durationMinutes: 8, access: "MEMBERS", published: true,
      summary: "Why the side that does NOT have to move often wins king and pawn endings.",
      body: "Two kings facing each other with one square between them are *in opposition*. The player who is **not** to move holds the opposition — the other king must give way.\n\n### Why it matters\nWith king and pawn against king, the attacker wins when their king can get in front of the pawn and take the opposition. The defender draws by keeping the opposition in front of the pawn.\n\n### Rule of thumb\nPut your king **in front of** your pawn, not behind it. Then use the opposition to escort the pawn home.",
    },
    {
      categoryId: lc["Game Analysis"], slug: "how-to-review-your-own-games", title: "How to review your own games", coverImage: "/images/learn/how-to-review-your-own-games.webp", type: "ARTICLE", level: "All levels", durationMinutes: 7, access: "PUBLIC", published: true,
      summary: "A simple routine for learning from every game you play — the same routine our coaches use before your lesson.",
      body: "1. **Write down your thoughts first.** Before using an engine, note where you felt unsure and what you were planning.\n2. **Find the turning points.** Where did the evaluation swing? Was it tactics, time, or a plan that didn't work?\n3. **Name the lesson.** Turn each mistake into one sentence you can remember: *\"Check every capture before moving.\"*\n4. **Bring it to your coach.** Your games and notes are what make your weekly session personal.",
    },
    {
      categoryId: lc["Game Analysis"], slug: "the-opera-game-1858", title: "The Opera Game (Morphy, 1858)", coverImage: "/images/learn/the-opera-game-1858.webp", type: "PGN", level: "All levels", durationMinutes: 10, access: "PUBLIC", published: true, downloadable: true,
      summary: "Paul Morphy's famous miniature — rapid development, open lines and a beautiful finish.",
      body: "Play through the game and notice how every white move develops a piece or opens a line, while Black falls behind in development.",
      pgn: '[Event "Paris"]\n[Site "Paris FRA"]\n[Date "1858.??.??"]\n[White "Paul Morphy"]\n[Black "Duke Karl / Count Isouard"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0',
    },
    {
      categoryId: lc["Beginner Chess"], slug: "checkmate-with-king-and-queen", title: "Checkmate with king and queen", coverImage: "/images/learn/checkmate-with-king-and-queen.webp", type: "ARTICLE", level: "Beginner", durationMinutes: 6, access: "PUBLIC", published: true,
      summary: "The first checkmate every player should master, in three steps.",
      body: "1. **Box the king in** — use your queen a knight's move away from the enemy king to shrink its space without giving check.\n2. **Bring your king up.** The queen cannot mate alone; walk your king towards the enemy king.\n3. **Deliver mate on the edge** — once the king is on the edge, protected by your king, the queen gives mate.\n\n⚠️ Watch out for stalemate: always make sure the enemy king has a legal move until you give checkmate.",
    },
  ];
  for (const m of materials) await prisma.learningMaterial.upsert({ where: { slug: m.slug }, create: m, update: {} });

  // ── Puzzles (verified with chess.js) ────────────────────────────────────
  const puzzles: { title: string; fen: string; solution: string[]; theme: string; difficulty: "BEGINNER" | "EASY" | "MEDIUM" | "HARD"; rating: number; hint: string }[] = [
    { title: "Back-rank mate", fen: "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", solution: ["d1d8"], theme: "Back rank", difficulty: "BEGINNER", rating: 600, hint: "The black king is trapped behind its own pawns." },
    { title: "Scholar's finish", fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", solution: ["h5f7"], theme: "Mate in 1", difficulty: "BEGINNER", rating: 700, hint: "f7 is only defended by the king." },
    { title: "Rook ladder", fen: "6k1/8/8/8/8/8/R7/1R4K1 w - - 0 1", solution: ["a2a7", "g8h8", "b1b8"], theme: "Mate in 2", difficulty: "EASY", rating: 900, hint: "Cut the king off on the seventh rank first." },
    { title: "Royal fork", fen: "q3k3/8/1P6/1N6/8/8/8/4K3 w - - 0 1", solution: ["b5c7", "e8d7", "c7a8"], theme: "Fork", difficulty: "EASY", rating: 1000, hint: "Find a check that also attacks the queen." },
    { title: "Smothered mate", fen: "3r3k/6pp/7N/8/2Q5/8/6PP/6K1 w - - 0 1", solution: ["c4g8", "d8g8", "h6f7"], theme: "Smothered mate", difficulty: "MEDIUM", rating: 1400, hint: "Sacrifice the queen so the rook blocks its own king." },
    { title: "Morphy's Opera finish", fen: "4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16", solution: ["b3b8", "d7b8", "d1d8"], theme: "Sacrifice", difficulty: "MEDIUM", rating: 1500, hint: "Deflect the knight that guards d8." },
  ];
  if ((await prisma.puzzle.count()) === 0) {
    for (const p of puzzles) {
      assertPuzzle(p.fen, p.solution);
      await prisma.puzzle.create({ data: { ...p, published: true } });
    }
  }

  // ── Payment provider (credentials come from env / encrypted store) ───────
  const credsPresent = Boolean(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET && process.env.MPESA_PASSKEY && process.env.MPESA_SHORTCODE);
  const provider = await prisma.paymentProvider.upsert({
    where: { key: "mpesa" },
    create: { key: "mpesa", name: "M-Pesa", description: "Lipa na M-Pesa STK Push (Safaricom Daraja)", enabled: credsPresent, isDefault: true },
    update: {},
  });
  await prisma.paymentConfiguration.upsert({
    where: { providerId: provider.id },
    create: {
      providerId: provider.id,
      environment: process.env.MPESA_ENVIRONMENT || "sandbox",
      shortcode: process.env.MPESA_SHORTCODE || null,
      transactionType: process.env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline",
      callbackUrl: process.env.MPESA_CALLBACK_URL || null,
      accountReferenceFormat: "{order}",
      transactionDescription: "Chess254",
      currency: "KES",
    },
    update: {},
  });

  // ── Initial administrator (environment-controlled) ──────────────────────
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12) throw new Error("INITIAL_ADMIN_PASSWORD must be at least 12 characters.");
    const user = await prisma.user.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, passwordHash: await bcrypt.hash(adminPassword, 12), name: process.env.INITIAL_ADMIN_NAME || "Club administrator", role: "SUPER_ADMIN", emailVerifiedAt: new Date() },
      update: {},
    });
    await prisma.memberProfile.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    console.log(`Administrator ready: ${adminEmail}`);
  } else {
    console.log("INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD not set — no administrator created.");
  }
}

main()
  .then(() => console.log("Seed complete."))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

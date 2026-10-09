import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Puzzle as PuzzleIcon, Trophy, Users } from "lucide-react";
import { prisma } from "@/server/db";
import { getBlocks, getSiteChrome, openStatus } from "@/server/content";
import { currentUser } from "@/server/auth";
import { puzzleOfTheDay } from "@/server/puzzles";
import { publishedMaterialWhere } from "@/server/learning";
import { seatsTaken } from "@/server/events";
import { siteUrl } from "@/server/settings";
import { Img } from "@/components/ui/img";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { CoachCard, Container, EventCard, HeroBackdrop, PassCard, PlanCard, SectionHeading } from "@/components/site/cards";
import { CheckoutServiceButton } from "@/components/site/checkout-buttons";
import { CountUp, Reveal } from "@/components/site/reveal";
import { PuzzleSolver } from "@/components/chess/puzzle-solver";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const now = new Date();
  const [blocks, chrome, user, plans, events, coaches, gallery, testimonials, categories, passes] = await Promise.all([
    getBlocks("home"),
    getSiteChrome(),
    currentUser(),
    prisma.membershipPlan.findMany({ where: { status: "ACTIVE" }, include: { features: { orderBy: { position: "asc" } } }, orderBy: [{ priority: "asc" }, { price: "asc" }] }),
    prisma.event.findMany({ where: { status: "PUBLISHED", deletedAt: null, endsAt: { gte: now } }, include: { location: true }, orderBy: { startsAt: "asc" }, take: 3 }),
    prisma.coachProfile.findMany({ where: { isActive: true, user: { suspendedAt: null, deletedAt: null } }, include: { user: { select: { name: true } } }, orderBy: { position: "asc" }, take: 4 }),
    prisma.galleryImage.findMany({ where: { visible: true, deletedAt: null }, orderBy: [{ featured: "desc" }, { position: "asc" }], take: 7 }),
    prisma.testimonial.findMany({ where: { visible: true }, orderBy: { position: "asc" }, take: 6 }),
    prisma.learningCategory.findMany({ where: { visible: true }, orderBy: { position: "asc" }, include: { _count: { select: { materials: { where: publishedMaterialWhere() } } } } }),
    prisma.service.findMany({ where: { status: "ACTIVE" }, orderBy: { position: "asc" } }),
  ]);
  const { settings, location } = chrome;
  const tz = settings.general.timezone;
  const puzzle = await puzzleOfTheDay(tz);
  const seats = await Promise.all(events.map(async (e) => (e.capacity === null ? null : Math.max(0, e.capacity - (await seatsTaken(e.id))))));
  const [puzzleCount, lessonCount, coachCount, solvedCount] = await Promise.all([
    prisma.puzzle.count({ where: { published: true } }),
    prisma.learningMaterial.count({ where: publishedMaterialWhere() }),
    prisma.coachProfile.count({ where: { isActive: true } }),
    prisma.puzzleAttempt.count({ where: { solved: true } }),
  ]);
  const stats = [
    { label: "Resident coaches", value: coachCount, icon: Users, glyph: "♚", href: "/coaches", cta: "Meet the coaches", description: "Book one-to-one lessons and game reviews with coaches who know your play." },
    { label: "Academy lessons", value: lessonCount, icon: BookOpen, glyph: "♝", href: "/learn", cta: "Start learning", description: "Openings, tactics and endgames, at your own pace." },
    { label: "Puzzles to solve", value: puzzleCount, icon: PuzzleIcon, glyph: "♞", href: "/puzzles", cta: "Solve a puzzle", description: "Sharpen your tactics, grow your puzzle rating and keep your streak alive." },
    { label: "Puzzles solved by members", value: solvedCount, icon: Trophy, glyph: "♛", href: "/puzzles", cta: "Join in", description: "Every correct solution from the club, counted live." },
  ].filter((s) => s.value > 0);

  const hero = blocks.get("home.hero");
  const loc = blocks.get("home.location");
  const ticker = blocks.get("home.ticker");
  const membershipsBlock = blocks.get("home.memberships");
  const method = blocks.get("home.method");
  const cta = blocks.get("home.cta");
  const status = openStatus(location);
  const heroImage = hero?.imageUrl || settings.brand.heroImage;
  const collage = gallery.filter((g) => g.imageUrl !== heroImage).slice(0, 2);
  const secondaryHref = hero?.secondaryHref === "/book" && !user ? "/register" : hero?.secondaryHref;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsActivityLocation",
    name: location?.name ?? settings.general.siteName,
    description: settings.seo.defaultDescription || hero?.body || undefined,
    url: await siteUrl(),
    image: heroImage || undefined,
    telephone: settings.contact.phone || undefined,
    email: settings.contact.email || undefined,
    address: location ? { "@type": "PostalAddress", streetAddress: location.address, addressLocality: location.city, addressCountry: "KE" } : undefined,
    openingHoursSpecification: location?.openingHours.filter((h) => !h.closed).map((h) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][h.weekday], opens: h.opensAt, closes: h.closesAt })),
    sameAs: chrome.socials.map((s) => s.url),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <HeroBackdrop ringsClassName="sm:-right-24 sm:top-[45%] sm:size-[900px]" />
        <div className="pointer-events-none absolute -left-40 top-20 size-[560px] rounded-full bg-brand/12 blur-[130px]" />
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {["♞", "♜", "♝", "♛"].map((g, i) => (
            <span key={g} className="absolute animate-float font-display text-[120px] text-foreground/[0.045]" style={{ left: `${[8, 46, 78, 62][i]}%`, top: `${[62, 6, 70, 30][i]}%`, animationDelay: `${i * 1.3}s`, ["--r" as string]: `${[-12, 8, -6, 14][i]}deg` }}>{g}</span>
          ))}
        </div>
        <Container className="relative grid items-center gap-14 pb-20 pt-12 lg:grid-cols-[1.15fr_1fr] lg:pb-28 lg:pt-20">
          <div>
            {hero?.eyebrow && <div className="eyebrow mb-6 flex animate-fade-up items-center gap-3"><span className="h-px w-8 bg-brand" />{hero.eyebrow}</div>}
            {hero ? (
              <h1 className="display animate-fade-up text-[clamp(3.6rem,11vw,8.2rem)] [animation-delay:80ms]">
                {hero.title}
                {hero.highlight && <span className="text-gradient block animate-shine">{hero.highlight}</span>}
              </h1>
            ) : (
              <h1 className="display text-6xl">{settings.general.siteName}</h1>
            )}
            {hero?.body && <p className="mt-8 max-w-xl animate-fade-up text-lg leading-relaxed text-muted sm:text-xl [animation-delay:160ms]">{hero.body}</p>}
            <div className="mt-10 flex animate-fade-up flex-wrap items-center gap-3 [animation-delay:240ms]">
              {hero?.ctaLabel && hero.ctaHref && <Button asChild size="lg"><Link href={hero.ctaHref}>{hero.ctaLabel}<ArrowRight /></Link></Button>}
              {hero?.secondaryLabel && secondaryHref && <Button asChild size="lg" variant="secondary"><Link href={secondaryHref}>{hero.secondaryLabel}</Link></Button>}
            </div>
            {status && (
              <div className="mt-10 flex animate-fade-up items-center gap-3 text-sm text-muted [animation-delay:320ms]">
                <span className={cn("size-2.5 rounded-full", status.open ? "animate-pulse-ring bg-success" : "bg-muted-2")} />
                <span className="font-semibold text-foreground">{status.label}</span>
                {status.detail && <span>· {status.detail}</span>}
              </div>
            )}
          </div>

          <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
            {heroImage && (
              <div className="relative aspect-[4/5] animate-fade-up overflow-hidden rounded-[2rem] border border-border-strong [animation-delay:120ms]">
                <Img src={heroImage} alt={hero?.title ?? settings.general.siteName} fill priority sizes="(max-width: 1024px) 100vw, 45vw" className="object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
              </div>
            )}
            {collage.map((img, i) => (
              <div
                key={img.id}
                className={cn("absolute hidden aspect-square w-32 animate-float overflow-hidden rounded-2xl border-4 border-background shadow-2xl sm:block lg:w-40", i === 0 ? "-left-10 top-10" : "-right-6 top-1/3")}
                style={{ animationDelay: `${i * 1.6}s`, ["--r" as string]: i === 0 ? "-6deg" : "5deg" }}
              >
                <Img src={img.imageUrl} alt={img.alt || img.title} fill sizes="160px" className="object-cover" />
              </div>
            ))}
            {loc && (
              <div className="glass relative z-10 -mt-24 mx-3 animate-fade-up rounded-3xl border border-border-strong p-6 shadow-2xl sm:mx-6 [animation-delay:280ms]">
                {loc.eyebrow && <div className="text-xs uppercase tracking-widest text-muted">{loc.eyebrow}</div>}
                {loc.title && <div className="mt-1 font-display text-3xl font-extrabold tracking-tight">{loc.title}</div>}
                {loc.body && <p className="mt-2 text-sm text-muted">{loc.body}</p>}
                {loc.items.length > 0 && (
                  <div className="mt-5 grid grid-cols-2 gap-2.5">
                    {loc.items.map((item) => (
                      <div key={item.title} className="rounded-2xl border border-border bg-background/60 p-3.5 transition hover:border-brand/50">
                        <div className="text-[13px] font-extrabold uppercase tracking-wide text-brand-ink">{item.title}</div>
                        {item.body && <div className="mt-0.5 text-[13px] text-muted">{item.body}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Container>
      </section>

      {/* ── Pillars ──────────────────────────────────────────── */}
      {ticker && ticker.items.length > 0 && (
        <Container>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ticker.items.map((item, i) => (
              <Reveal key={i} as="li" delay={i * 80} className="flex h-full items-center gap-3 rounded-xl border border-border bg-surface/60 px-4 py-3">
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand-ink">♞</span>
                <span className="min-w-0">
                  <span className="block font-display text-sm font-bold uppercase tracking-wide">{item.title}</span>
                  {item.body && <span className="block truncate text-xs text-muted">{item.body}</span>}
                </span>
              </Reveal>
            ))}
          </ul>
        </Container>
      )}

      {/* ── Memberships ──────────────────────────────────────── */}
      <section id="memberships" className="py-24 sm:py-32">
        <Container>
          <Reveal><SectionHeading eyebrow={membershipsBlock?.eyebrow} title={membershipsBlock?.title} highlight={membershipsBlock?.highlight} body={membershipsBlock?.body} action={<Link href="/memberships" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-ink hover:underline">Compare plans <ArrowUpRight className="size-4" /></Link>} /></Reveal>
          {plans.length || passes.length ? (
            // Pay-per-visit passes first, then the plans, in one row on large screens.
            <div className={cn("grid gap-5", plans.length + passes.length > 1 && "md:grid-cols-2", plans.length + passes.length === 3 && "lg:grid-cols-3", plans.length + passes.length >= 4 && "xl:grid-cols-4")}>
              {passes.map((s, i) => (
                <Reveal key={s.id} delay={i * 120} className="h-full">
                  <PassCard
                    pass={s}
                    action={user ? <CheckoutServiceButton serviceId={s.id} label="Buy with M-Pesa" size="lg" /> : <Button asChild variant="secondary" size="lg" className="w-full"><Link href="/login?next=/memberships">Sign in to buy</Link></Button>}
                  />
                </Reveal>
              ))}
              {plans.map((plan, i) => <Reveal key={plan.id} delay={(passes.length + i) * 120} className="h-full"><PlanCard plan={plan} /></Reveal>)}
            </div>
          ) : (
            <EmptyState title="Memberships are being set up" description="New membership plans will appear here as soon as the club publishes them." />
          )}
        </Container>
      </section>

      {/* ── Method ───────────────────────────────────────────── */}
      {method && method.items.length > 0 && (
        <section className="bg-premium overflow-hidden border-y border-border py-24 sm:py-32">
          <span aria-hidden className="pointer-events-none absolute -bottom-16 -right-10 select-none font-display text-[420px] leading-none text-foreground/[0.03]">♞</span>
          <Container className="relative">
            <Reveal><SectionHeading eyebrow={method.eyebrow} title={method.title} highlight={method.highlight} body={method.body} /></Reveal>
            <div className="grid gap-5 md:grid-cols-3">
              {method.items.map((step, i) => (
                <Reveal key={step.title} delay={i * 140}>
                  <div className="group relative h-full overflow-hidden rounded-3xl border border-border bg-surface/75 p-8 shadow-[0_20px_50px_-30px_var(--shadow-color)] backdrop-blur-sm transition duration-500 hover:-translate-y-1 hover:border-brand/50">
                    <div className="font-display text-7xl font-black text-brand-ink/20 transition group-hover:text-brand-ink">{String(i + 1).padStart(2, "0")}</div>
                    <h3 className="mt-6 font-display text-2xl font-extrabold tracking-tight">{step.title}</h3>
                    {step.body && <p className="mt-3 leading-relaxed text-muted">{step.body}</p>}
                  </div>
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* ── Live stats ───────────────────────────────────────── */}
      {stats.length > 0 && (
        <section className="py-16 sm:py-20">
          <Container>
            <ul className={cn("grid gap-4 sm:grid-cols-2", stats.length === 3 && "lg:grid-cols-3", stats.length >= 4 && "lg:grid-cols-4")}>
              {stats.map((s, i) => (
                <Reveal key={s.label} as="li" delay={i * 90} className="h-full">
                  <Link
                    href={s.href}
                    className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-surface p-6 transition-all duration-500 hover:-translate-y-1 hover:border-brand/50 hover:shadow-[0_24px_60px_-28px_var(--shadow-color)] sm:p-7"
                  >
                    <span aria-hidden className="pointer-events-none absolute -right-3 -top-6 font-display text-[132px] leading-none text-foreground/[0.04] transition-all duration-700 group-hover:-rotate-6 group-hover:text-brand/10">{s.glyph}</span>
                    <span aria-hidden className="pointer-events-none absolute -bottom-16 -left-16 size-40 rounded-full bg-brand/0 blur-3xl transition-colors duration-700 group-hover:bg-brand/15" />
                    <span className="relative grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand-ink ring-1 ring-brand/20 transition-all duration-500 group-hover:bg-brand group-hover:text-brand-foreground group-hover:ring-brand">
                      <s.icon className="size-[22px]" />
                    </span>
                    <span className="relative mt-6 font-display text-5xl font-black tracking-tight tabular-nums sm:text-[3.5rem]"><CountUp value={s.value} /></span>
                    <span className="relative mt-1 font-semibold">{s.label}</span>
                    <span className="relative mt-1.5 text-sm leading-relaxed text-muted">{s.description}</span>
                    <span className="relative mt-auto flex items-center gap-1.5 pt-6 text-sm font-semibold text-brand-ink">
                      {s.cta}
                      <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </span>
                  </Link>
                </Reveal>
              ))}
            </ul>
          </Container>
        </section>
      )}

      {/* ── Puzzle of the day + Academy ──────────────────────── */}
      <section className="py-24">
        <Container className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <div className="eyebrow mb-4">Puzzle of the day</div>
            {puzzle ? (
              <div className="max-w-md">
                <PuzzleSolver puzzle={puzzle} signedIn={Boolean(user)} compact />
                <Link href={`/puzzles/${puzzle.id}`} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-ink hover:underline">Open in the puzzle room <ArrowUpRight className="size-4" /></Link>
              </div>
            ) : (
              <EmptyState icon={<PuzzleIcon />} title="No puzzles yet" description="Daily puzzles will appear here once the coaches publish them." />
            )}
          </Reveal>
          <Reveal delay={120}>
            <h2 className="display text-[clamp(2.4rem,5vw,4rem)]">Train between <span className="text-brand-ink">games.</span></h2>
            <p className="mt-5 max-w-lg text-lg text-muted">Lessons, studies and annotated games from the academy — pick a topic and start improving.</p>
            {categories.length ? (
              <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
                {categories.map((c) => (
                  <Link key={c.id} href={`/learn?category=${c.slug}`} className="group flex items-center justify-between rounded-2xl border border-border bg-surface px-5 py-4 transition hover:border-brand/50 hover:bg-surface-2">
                    <span className="font-semibold">{c.name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted">{c._count.materials}<ArrowRight className="size-4 text-brand-ink transition group-hover:translate-x-1" /></span>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState className="mt-8" icon={<BookOpen />} title="The academy is being stocked" />
            )}
          </Reveal>
        </Container>
      </section>

      {/* ── Events ───────────────────────────────────────────── */}
      <section className="py-24">
        <Container>
          <Reveal><SectionHeading eyebrow="What's on" title="Make a date with" highlight="the board." action={<Link href="/events" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-ink hover:underline">All events <ArrowUpRight className="size-4" /></Link>} /></Reveal>
          {events.length ? (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {events.map((e, i) => <Reveal key={e.id} delay={i * 100}><EventCard event={e} timezone={tz} seatsLeft={seats[i]} /></Reveal>)}
            </div>
          ) : (
            <EmptyState icon={<CalendarDays />} title="No upcoming events" description="Tournaments, hangouts and training camps will be announced here." action={<Button asChild variant="secondary"><Link href="/events">See past events</Link></Button>} />
          )}
        </Container>
      </section>

      {/* ── Coaches ──────────────────────────────────────────── */}
      <section className="py-24">
        <Container>
          <Reveal><SectionHeading eyebrow="Resident coaches" title="Learn from players who" highlight="love the game." action={<Link href="/coaches" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-ink hover:underline">Meet the coaches <ArrowUpRight className="size-4" /></Link>} /></Reveal>
          {coaches.length ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {coaches.map((c, i) => <Reveal key={c.id} delay={i * 90}><CoachCard coach={c} /></Reveal>)}
            </div>
          ) : (
            <EmptyState icon={<Users />} title="Coach profiles coming soon" description="Our resident coaches will be introduced here shortly." />
          )}
        </Container>
      </section>

      {/* ── Gallery mosaic ───────────────────────────────────── */}
      {gallery.length > 0 && (
        <section className="py-24">
          <Container>
            <Reveal><SectionHeading eyebrow="The clubhouse in motion" title="Good moves." highlight="Better company." action={<Link href="/gallery" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-ink hover:underline">Open the gallery <ArrowUpRight className="size-4" /></Link>} /></Reveal>
            <div className="grid auto-rows-[160px] grid-cols-2 gap-3 sm:auto-rows-[200px] md:grid-cols-4">
              {gallery.map((g, i) => (
                <Reveal key={g.id} delay={i * 60} className={cn("group relative overflow-hidden rounded-3xl bg-surface-2", i === 0 && "col-span-2 row-span-2", i === 3 && "md:row-span-2")}>
                  <Link href="/gallery" className="absolute inset-0">
                    <Img src={g.imageUrl} alt={g.alt || g.title} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover transition duration-700 group-hover:scale-105" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent opacity-0 transition group-hover:opacity-100" />
                    <span className="on-dark absolute bottom-3 left-4 translate-y-2 text-sm font-semibold opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">{g.title}</span>
                  </Link>
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* ── Testimonials ─────────────────────────────────────── */}
      {testimonials.length > 0 && (
        <section className="py-24">
          <Container>
            <Reveal><SectionHeading eyebrow="From the players" title="Why they" highlight="keep coming back." /></Reveal>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {testimonials.map((t, i) => (
                <Reveal key={t.id} delay={i * 90}>
                  <figure className="flex h-full flex-col rounded-3xl border border-border bg-surface p-7">
                    <div className="font-display text-5xl leading-none text-brand-ink">“</div>
                    <blockquote className="mt-2 flex-1 text-lg leading-relaxed">{t.quote}</blockquote>
                    <figcaption className="mt-6 flex items-center gap-3">
                      {t.imageUrl && <span className="relative size-10 overflow-hidden rounded-full"><Img src={t.imageUrl} alt={t.name} fill sizes="40px" className="object-cover" /></span>}
                      <span><span className="block font-semibold">{t.name}</span>{t.roleLabel && <span className="text-sm text-muted">{t.roleLabel}</span>}</span>
                    </figcaption>
                  </figure>
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* ── Closing CTA ──────────────────────────────────────── */}
      {cta && (
        <section className="px-4 py-12 sm:px-6">
          <Reveal className="relative mx-auto max-w-7xl overflow-hidden rounded-[2.5rem] bg-brand px-6 py-20 text-center text-brand-foreground sm:px-12 sm:py-28">
            <div className="pointer-events-none absolute -bottom-24 -right-10 font-display text-[340px] leading-none text-black/[0.07]" aria-hidden>♞</div>
            <div className="pointer-events-none absolute -left-10 -top-24 font-display text-[260px] leading-none text-black/[0.05]" aria-hidden>♜</div>
            {cta.eyebrow && <div className="relative font-mono text-xs font-bold uppercase tracking-[0.2em]">{cta.eyebrow}</div>}
            {cta.title && <h2 className="display relative mt-5 text-[clamp(3rem,9vw,7rem)]">{cta.title}</h2>}
            {cta.body && <p className="relative mx-auto mt-6 max-w-xl text-lg font-medium text-black/70">{cta.body}</p>}
            {cta.ctaLabel && cta.ctaHref && (
              <Button asChild size="lg" className="relative mt-10 bg-black text-white hover:bg-black/85 hover:shadow-none">
                <Link href={user && cta.ctaHref === "/register" ? "/memberships" : cta.ctaHref}>{cta.ctaLabel}<ArrowRight /></Link>
              </Button>
            )}
          </Reveal>
        </section>
      )}
    </>
  );
}

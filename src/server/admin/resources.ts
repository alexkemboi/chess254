import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { UserError } from "@/server/errors";
import type { Permission } from "@/server/rbac";
import { getAllSettings } from "@/server/settings";
import { validatePuzzleLine } from "@/server/puzzles";
import type { FieldDef, FormValues, Option } from "@/lib/fields";
import { BILLING_PERIOD_LABELS, formatDate, formatMoney, humanize, WEEKDAYS } from "@/lib/format";
import { decimalString, ensureSlug, f, toLocalInput } from "./fields";

export type Cell = string | { text: string; badge?: boolean; mono?: boolean; image?: string; muted?: boolean };
export type ListRow = { id: string; cells: Cell[] };
type Ctx = { tz: string; currency: string };

export type Resource = {
  key: string;
  title: string;
  singular: string;
  group: string;
  permission: Permission;
  description?: string;
  columns: string[];
  fields(ctx: Ctx): Promise<FieldDef[]>;
  list(q: string, page: number): Promise<{ rows: ListRow[]; total: number }>;
  load(id: string, ctx: Ctx): Promise<FormValues | null>;
  defaults?(ctx: Ctx): Promise<FormValues>;
  schema(ctx: Ctx): z.ZodTypeAny;
  save(id: string | null, data: Record<string, unknown>, ctx: Ctx): Promise<string>;
  remove?(id: string): Promise<"deleted" | "archived">;
  move?(id: string, dir: -1 | 1): Promise<void>;
  publicHref?(values: FormValues): string | null;
  removeLabel?: string;
};

export const PAGE_SIZE = 25;
const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });
const skip = (page: number) => ({ skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE });

type PosDelegate = {
  findUnique(a: { where: { id: string } }): Promise<{ id: string; position: number } | null>;
  findFirst(a: object): Promise<{ id: string; position: number } | null>;
  update(a: { where: { id: string }; data: { position: number } }): Promise<unknown>;
};

/** Swaps position with the neighbour so admins can reorder with up / down. */
async function swap(delegate: PosDelegate, id: string, dir: -1 | 1, scope: object = {}) {
  const current = await delegate.findUnique({ where: { id } });
  if (!current) return;
  const neighbour = await delegate.findFirst({
    where: { ...scope, position: dir === -1 ? { lt: current.position } : { gt: current.position } },
    orderBy: { position: dir === -1 ? "desc" : "asc" },
  });
  if (!neighbour) {
    await delegate.update({ where: { id }, data: { position: current.position + dir } });
    return;
  }
  await prisma.$transaction([
    delegate.update({ where: { id: current.id }, data: { position: neighbour.position } }) as Prisma.PrismaPromise<unknown>,
    delegate.update({ where: { id: neighbour.id }, data: { position: current.position === neighbour.position ? current.position + dir : current.position } }) as Prisma.PrismaPromise<unknown>,
  ]);
}

const STATUS_OPTIONS = (values: string[]): Option[] => values.map((v) => ({ value: v, label: humanize(v) }));

async function planOptions() {
  return (await prisma.membershipPlan.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { priority: "asc" }, select: { id: true, name: true } })).map((p) => ({ value: p.id, label: p.name }));
}
async function sessionTypeOptions() {
  return (await prisma.sessionType.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { position: "asc" }, select: { id: true, name: true } })).map((p) => ({ value: p.id, label: p.name }));
}
async function coachOptions() {
  return (await prisma.coachProfile.findMany({ include: { user: { select: { name: true } } }, orderBy: { position: "asc" } })).map((c) => ({ value: c.id, label: c.user.name }));
}
async function locationOptions() {
  return (await prisma.location.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } })).map((l) => ({ value: l.id, label: l.name }));
}

/** Reads natural pixel size for local and uploaded images (used by the gallery's masonry layout). */
async function imageSize(url: string): Promise<{ width: number | null; height: number | null }> {
  try {
    let data: Buffer | null = null;
    const mediaId = url.match(/^\/media\/([a-z0-9]+)$/)?.[1];
    if (mediaId) data = Buffer.from((await prisma.media.findUnique({ where: { id: mediaId } }))?.data ?? []);
    else if (url.startsWith("/") && !url.includes("..")) data = await (await import("node:fs/promises")).readFile(`${process.cwd()}/public${url}`);
    if (!data?.length) return { width: null, height: null };
    const sharp = (await import("sharp")).default;
    const meta = await sharp(data).metadata();
    return { width: meta.width ?? null, height: meta.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

// ─── Membership plans ─────────────────────────────────────────────────────
const plans: Resource = {
  key: "plans",
  title: "Membership plans",
  singular: "plan",
  group: "Memberships",
  permission: "memberships.manage",
  description: "Prices, benefits and access rules. Changes apply everywhere immediately; existing memberships keep the period they paid for.",
  columns: ["Plan", "Price", "Members", "Status"],
  async fields() {
    return [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "slug", label: "URL slug", type: "slug", help: "Leave blank to generate from the name." },
      { name: "audience", label: "Audience label", type: "text", placeholder: "For players who want to improve" },
      { name: "description", label: "Description", type: "textarea", required: true, span: 2 },
      { name: "price", label: "Price", type: "money", required: true },
      { name: "currency", label: "Currency", type: "text", required: true },
      { name: "billingPeriod", label: "Billing period", type: "select", options: Object.entries(BILLING_PERIOD_LABELS).map(([value, l]) => ({ value, label: l.long })) },
      { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]) },
      { name: "features", label: "Benefits", type: "lines", span: 2, help: "One benefit per line, shown in order." },
      { name: "accessStartTime", label: "Clubhouse access from", type: "time", help: "Blank = opening time", section: "Access rules" },
      { name: "accessEndTime", label: "Clubhouse access until", type: "time", help: "Blank = closing time" },
      { name: "canBookCoaching", label: "Can book coaching sessions", type: "switch" },
      { name: "learningAccess", label: "Includes members-only academy", type: "switch" },
      { name: "eventDiscountPercent", label: "Event discount (%)", type: "number", help: "Informational; set member prices per event." },
      {
        name: "entitlements",
        label: "Included sessions",
        type: "repeater",
        span: 2,
        help: "Sessions members can book at no charge each period.",
        fields: [
          { name: "sessionTypeId", label: "Session type", type: "select", options: await sessionTypeOptions() },
          { name: "quantity", label: "Quantity", type: "number" },
          { name: "period", label: "Per", type: "select", options: [{ value: "WEEK", label: "Week" }, { value: "MONTH", label: "Month" }, { value: "BILLING_PERIOD", label: "Billing period" }] },
        ],
      },
      { name: "ctaLabel", label: "Button label", type: "text", help: "Blank = “Choose {price}”", section: "Display" },
      { name: "priority", label: "Sort order", type: "number" },
      { name: "featured", label: "Highlight as most popular", type: "switch" },
      { name: "seoTitle", label: "SEO title", type: "text" },
      { name: "seoDescription", label: "SEO description", type: "textarea", span: 2 },
    ];
  },
  async list(q, page) {
    const where: Prisma.MembershipPlanWhereInput = q ? { name: ci(q) } : {};
    const [rows, total] = await Promise.all([
      prisma.membershipPlan.findMany({ where, orderBy: [{ priority: "asc" }], ...skip(page), include: { _count: { select: { memberships: { where: { status: "ACTIVE", expiresAt: { gt: new Date() } } } } } } }),
      prisma.membershipPlan.count({ where }),
    ]);
    return { total, rows: rows.map((p) => ({ id: p.id, cells: [p.name, { text: `${formatMoney(p.price, p.currency)} / ${BILLING_PERIOD_LABELS[p.billingPeriod].short}`, mono: true }, String(p._count.memberships), { text: p.status, badge: true }] })) };
  },
  async defaults(ctx) {
    return { currency: ctx.currency, billingPeriod: "MONTHLY", status: "DRAFT", canBookCoaching: true, learningAccess: true, priority: 0, eventDiscountPercent: 0, entitlements: [] };
  },
  async load(id) {
    const p = await prisma.membershipPlan.findUnique({ where: { id }, include: { features: { orderBy: { position: "asc" } }, entitlements: true } });
    if (!p) return null;
    return { ...p, price: decimalString(p.price), features: p.features.map((x) => x.label).join("\n"), entitlements: p.entitlements.map((e) => ({ sessionTypeId: e.sessionTypeId, quantity: e.quantity, period: e.period })) };
  },
  schema: () =>
    z.object({
      name: f.text(120),
      slug: f.slug(),
      audience: f.optText(160),
      description: f.text(4000),
      price: f.money(),
      currency: z.string().trim().length(3).toUpperCase(),
      billingPeriod: f.enumOf(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"]),
      status: f.enumOf(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]),
      features: f.lines(),
      accessStartTime: f.optClock(),
      accessEndTime: f.optClock(),
      canBookCoaching: f.bool(),
      learningAccess: f.bool(),
      eventDiscountPercent: f.int(0, 100),
      entitlements: f.json(z.object({ sessionTypeId: z.string().min(1, "Pick a session type"), quantity: z.coerce.number().int().min(1).max(100), period: z.enum(["WEEK", "MONTH", "BILLING_PERIOD"]) })),
      ctaLabel: f.optText(60),
      priority: f.int(-1000, 1000),
      featured: f.bool(),
      seoTitle: f.optText(160),
      seoDescription: f.optText(300),
    }),
  async save(id, raw) {
    const { features, entitlements, ...data } = raw as { features: string[]; entitlements: { sessionTypeId: string; quantity: number; period: "WEEK" | "MONTH" | "BILLING_PERIOD" }[] } & Record<string, unknown>;
    const values = { ...data, slug: ensureSlug(String(data.slug), String(data.name)) } as Prisma.MembershipPlanUncheckedCreateInput;
    if (new Set(entitlements.map((e) => e.sessionTypeId)).size !== entitlements.length) throw new UserError("Each session type can only be listed once.");
    return prisma.$transaction(async (tx) => {
      const plan = id ? await tx.membershipPlan.update({ where: { id }, data: values }) : await tx.membershipPlan.create({ data: values });
      await tx.membershipFeature.deleteMany({ where: { planId: plan.id } });
      await tx.membershipFeature.createMany({ data: features.map((label, position) => ({ planId: plan.id, label, position })) });
      await tx.planEntitlement.deleteMany({ where: { planId: plan.id } });
      await tx.planEntitlement.createMany({ data: entitlements.map((e) => ({ ...e, planId: plan.id })) });
      return plan.id;
    });
  },
  async remove(id) {
    const used = await prisma.membership.count({ where: { planId: id } });
    if (used) {
      await prisma.membershipPlan.update({ where: { id }, data: { status: "ARCHIVED" } });
      return "archived";
    }
    await prisma.membershipPlan.delete({ where: { id } });
    return "deleted";
  },
  publicHref: (v) => (v.slug ? `/join/${v.slug}` : null),
};

// ─── Session types ────────────────────────────────────────────────────────
const sessionTypes: Resource = {
  key: "session-types",
  title: "Session types",
  singular: "session type",
  group: "Coaching",
  permission: "sessions.manage",
  description: "What members can book: duration, price, capacity, eligibility and policy.",
  columns: ["Session", "Duration", "Price", "Coaches", "Status"],
  async fields() {
    return [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "slug", label: "Slug", type: "slug" },
      { name: "description", label: "Description", type: "textarea", required: true, span: 2 },
      { name: "durationMinutes", label: "Duration (minutes)", type: "number", required: true },
      { name: "capacity", label: "Capacity (players per slot)", type: "number", required: true },
      { name: "price", label: "Price", type: "money", required: true, help: "0 = no charge" },
      { name: "currency", label: "Currency", type: "text" },
      { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]) },
      { name: "position", label: "Sort order", type: "number" },
      { name: "coaches", label: "Coaches offering this", type: "multiselect", options: await coachOptions(), span: 2 },
      { name: "membershipRequired", label: "Requires an active membership", type: "switch", section: "Rules" },
      { name: "allowedPlans", label: "Only these plans (optional)", type: "multiselect", options: await planOptions(), help: "Leave empty to allow any eligible plan." },
      { name: "minNoticeHours", label: "Minimum notice (hours)", type: "number", help: "Blank = club default" },
      { name: "maxAdvanceDays", label: "Bookable up to (days ahead)", type: "number", help: "Blank = club default" },
      { name: "cancellationHours", label: "Free cancellation until (hours before)", type: "number", help: "Blank = club default" },
      { name: "cancellationPolicy", label: "Cancellation policy text", type: "textarea", span: 2 },
    ];
  },
  async list(q, page) {
    const where: Prisma.SessionTypeWhereInput = q ? { name: ci(q) } : {};
    const [rows, total] = await Promise.all([prisma.sessionType.findMany({ where, orderBy: { position: "asc" }, ...skip(page), include: { _count: { select: { coaches: true } } } }), prisma.sessionType.count({ where })]);
    return { total, rows: rows.map((s) => ({ id: s.id, cells: [s.name, `${s.durationMinutes} min`, { text: s.price.greaterThan(0) ? formatMoney(s.price, s.currency) : "Free / included", mono: true }, String(s._count.coaches), { text: s.status, badge: true }] })) };
  },
  async defaults(ctx) {
    return { currency: ctx.currency, durationMinutes: 60, capacity: 1, price: "0", status: "DRAFT", position: 0, coaches: [], allowedPlans: [] };
  },
  async load(id) {
    const s = await prisma.sessionType.findUnique({ where: { id }, include: { coaches: { select: { id: true } }, allowedPlans: { select: { id: true } } } });
    if (!s) return null;
    return { ...s, price: decimalString(s.price), coaches: s.coaches.map((c) => c.id), allowedPlans: s.allowedPlans.map((p) => p.id) };
  },
  schema: () =>
    z.object({
      name: f.text(120),
      slug: f.slug(),
      description: f.text(4000),
      durationMinutes: f.int(10, 600),
      capacity: f.int(1, 100),
      price: f.money(),
      currency: z.string().trim().length(3).toUpperCase(),
      status: f.enumOf(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]),
      position: f.int(-1000, 1000),
      coaches: f.ids(),
      membershipRequired: f.bool(),
      allowedPlans: f.ids(),
      minNoticeHours: f.optInt(0, 720),
      maxAdvanceDays: f.optInt(1, 365),
      cancellationHours: f.optInt(0, 720),
      cancellationPolicy: f.optText(2000),
    }),
  async save(id, raw) {
    const { coaches, allowedPlans, ...data } = raw as { coaches: string[]; allowedPlans: string[] } & Record<string, unknown>;
    const values = { ...data, slug: ensureSlug(String(data.slug), String(data.name)) } as Prisma.SessionTypeUncheckedCreateInput;
    const relations = { coaches: { set: coaches.map((c) => ({ id: c })) }, allowedPlans: { set: allowedPlans.map((p) => ({ id: p })) } };
    const s = id
      ? await prisma.sessionType.update({ where: { id }, data: { ...values, ...relations } })
      : await prisma.sessionType.create({ data: { ...values, coaches: { connect: coaches.map((c) => ({ id: c })) }, allowedPlans: { connect: allowedPlans.map((p) => ({ id: p })) } } });
    return s.id;
  },
  async remove(id) {
    if (await prisma.booking.count({ where: { sessionTypeId: id } })) {
      await prisma.sessionType.update({ where: { id }, data: { status: "ARCHIVED" } });
      return "archived";
    }
    await prisma.sessionType.delete({ where: { id } });
    return "deleted";
  },
  move: (id, dir) => swap(prisma.sessionType as unknown as PosDelegate, id, dir),
};

// ─── Services ─────────────────────────────────────────────────────────────
const services: Resource = {
  key: "services",
  title: "Services & passes",
  singular: "service",
  group: "Coaching",
  permission: "sessions.manage",
  description: "One-off purchases such as day passes. Buyers get a check-in code.",
  columns: ["Service", "Price", "Valid for", "Status"],
  async fields() {
    return [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "slug", label: "Slug", type: "slug" },
      { name: "description", label: "Description", type: "textarea", required: true, span: 2 },
      { name: "price", label: "Price", type: "money", required: true },
      { name: "currency", label: "Currency", type: "text" },
      { name: "validityHours", label: "Valid for (hours after purchase)", type: "number" },
      { name: "position", label: "Sort order", type: "number" },
      { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]) },
    ];
  },
  async list(q, page) {
    const where: Prisma.ServiceWhereInput = q ? { name: ci(q) } : {};
    const [rows, total] = await Promise.all([prisma.service.findMany({ where, orderBy: { position: "asc" }, ...skip(page) }), prisma.service.count({ where })]);
    return { total, rows: rows.map((s) => ({ id: s.id, cells: [s.name, { text: formatMoney(s.price, s.currency), mono: true }, `${s.validityHours} h`, { text: s.status, badge: true }] })) };
  },
  defaults: async (ctx) => ({ currency: ctx.currency, validityHours: 12, status: "DRAFT", position: 0 }),
  async load(id) {
    const s = await prisma.service.findUnique({ where: { id } });
    return s ? { ...s, price: decimalString(s.price) } : null;
  },
  schema: () => z.object({ name: f.text(120), slug: f.slug(), description: f.text(2000), price: f.money(), currency: z.string().trim().length(3).toUpperCase(), validityHours: f.int(1, 24 * 365), position: f.int(-1000, 1000), status: f.enumOf(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]) }),
  async save(id, raw) {
    const data = { ...raw, slug: ensureSlug(String(raw.slug), String(raw.name)) } as Prisma.ServiceUncheckedCreateInput;
    return (id ? await prisma.service.update({ where: { id }, data }) : await prisma.service.create({ data })).id;
  },
  async remove(id) {
    if (await prisma.servicePurchase.count({ where: { serviceId: id } })) {
      await prisma.service.update({ where: { id }, data: { status: "ARCHIVED" } });
      return "archived";
    }
    await prisma.service.delete({ where: { id } });
    return "deleted";
  },
};

// ─── Events ───────────────────────────────────────────────────────────────
const EVENT_TYPES = ["TOURNAMENT", "RAPID_TOURNAMENT", "BLITZ_TOURNAMENT", "TRAINING_CAMP", "HANGOUT", "KIDS_SESSION", "EXHIBITION", "COMMUNITY"] as const;
const events: Resource = {
  key: "events",
  title: "Events",
  singular: "event",
  group: "Events",
  permission: "events.manage",
  description: "Tournaments, hangouts and camps. Capacity is enforced at registration.",
  columns: ["Event", "Date", "Price", "Registrations", "Status"],
  async fields() {
    return [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "slug", label: "Slug", type: "slug" },
      { name: "type", label: "Type", type: "select", options: STATUS_OPTIONS([...EVENT_TYPES]) },
      { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS(["DRAFT", "PUBLISHED", "CANCELLED", "COMPLETED"]) },
      { name: "excerpt", label: "Short summary", type: "text", span: 2 },
      { name: "description", label: "Description", type: "markdown", required: true, span: 2 },
      { name: "coverImage", label: "Cover image", type: "image", span: 2 },
      { name: "startsAt", label: "Starts", type: "datetime", required: true, section: "Schedule & venue" },
      { name: "endsAt", label: "Ends", type: "datetime", required: true },
      { name: "locationId", label: "Location", type: "select", options: [{ value: "", label: "—" }, ...(await locationOptions())] },
      { name: "venueNote", label: "Venue note", type: "text", placeholder: "e.g. Main hall" },
      { name: "capacity", label: "Capacity", type: "number", help: "Blank = unlimited", section: "Registration" },
      { name: "registrationDeadline", label: "Registration deadline", type: "datetime" },
      { name: "price", label: "Price", type: "money", help: "0 = free" },
      { name: "memberPrice", label: "Member price", type: "money", help: "Optional discounted price for active members" },
      { name: "currency", label: "Currency", type: "text" },
      { name: "registrationOpen", label: "Registration open", type: "switch" },
      { name: "timeControl", label: "Time control", type: "text", placeholder: "e.g. 10+5", section: "Tournament details" },
      { name: "format", label: "Format", type: "text", placeholder: "e.g. 7-round Swiss" },
      { name: "prizeInfo", label: "Prizes", type: "textarea", span: 2 },
      { name: "featured", label: "Featured", type: "switch" },
      { name: "seoTitle", label: "SEO title", type: "text", section: "SEO" },
      { name: "seoDescription", label: "SEO description", type: "textarea", span: 2 },
    ];
  },
  async list(q, page) {
    const where: Prisma.EventWhereInput = { deletedAt: null, ...(q ? { title: ci(q) } : {}) };
    const [rows, total, tz] = await Promise.all([
      prisma.event.findMany({ where, orderBy: { startsAt: "desc" }, ...skip(page), include: { _count: { select: { registrations: { where: { status: { in: ["CONFIRMED", "ATTENDED"] } } } } } } }),
      prisma.event.count({ where }),
      getAllSettings().then((s) => s.general.timezone),
    ]);
    return { total, rows: rows.map((e) => ({ id: e.id, cells: [e.title, formatDate(e.startsAt, tz), { text: e.price.greaterThan(0) ? formatMoney(e.price, e.currency) : "Free", mono: true }, `${e._count.registrations}${e.capacity ? ` / ${e.capacity}` : ""}`, { text: e.status, badge: true }] })) };
  },
  defaults: async (ctx) => ({ type: "TOURNAMENT", status: "DRAFT", price: "0", currency: ctx.currency, registrationOpen: true }),
  async load(id, ctx) {
    const e = await prisma.event.findFirst({ where: { id, deletedAt: null } });
    if (!e) return null;
    return { ...e, price: decimalString(e.price), memberPrice: decimalString(e.memberPrice), startsAt: toLocalInput(e.startsAt, ctx.tz), endsAt: toLocalInput(e.endsAt, ctx.tz), registrationDeadline: toLocalInput(e.registrationDeadline, ctx.tz), capacity: e.capacity ?? "" };
  },
  schema: (ctx) =>
    z
      .object({
        title: f.text(160),
        slug: f.slug(),
        type: f.enumOf(EVENT_TYPES),
        status: f.enumOf(["DRAFT", "PUBLISHED", "CANCELLED", "COMPLETED"]),
        excerpt: f.optText(300),
        description: f.text(20000),
        coverImage: f.url(),
        startsAt: f.datetime(ctx.tz),
        endsAt: f.datetime(ctx.tz),
        locationId: f.optId(),
        venueNote: f.optText(160),
        capacity: f.optInt(1, 100000),
        registrationDeadline: f.optDatetime(ctx.tz),
        price: f.money(),
        memberPrice: f.optMoney(),
        currency: z.string().trim().length(3).toUpperCase(),
        registrationOpen: f.bool(),
        timeControl: f.optText(60),
        format: f.optText(120),
        prizeInfo: f.optText(4000),
        featured: f.bool(),
        seoTitle: f.optText(160),
        seoDescription: f.optText(300),
      })
      .refine((d) => d.endsAt > d.startsAt, { message: "The event must end after it starts", path: ["endsAt"] }),
  async save(id, raw) {
    const data = { ...raw, slug: ensureSlug(String(raw.slug), String(raw.title)) } as Prisma.EventUncheckedCreateInput;
    if (id && data.capacity) {
      const taken = await prisma.eventRegistration.count({ where: { eventId: id, status: { in: ["CONFIRMED", "ATTENDED"] } } });
      if (taken > (data.capacity as number)) throw new UserError(`Capacity can't be lower than the ${taken} confirmed registrations.`, { capacity: `At least ${taken}` });
    }
    return (id ? await prisma.event.update({ where: { id }, data }) : await prisma.event.create({ data })).id;
  },
  async remove(id) {
    await prisma.event.update({ where: { id }, data: { deletedAt: new Date(), status: "CANCELLED" } });
    return "archived";
  },
  removeLabel: "Delete event",
  publicHref: (v) => (v.slug ? `/events/${v.slug}` : null),
};

// ─── Learning ─────────────────────────────────────────────────────────────
const learningCategories: Resource = {
  key: "learning-categories",
  title: "Learning categories",
  singular: "category",
  group: "Learning",
  permission: "learning.manage",
  columns: ["Category", "Lessons", "Visible"],
  async fields() {
    return [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "slug", label: "Slug", type: "slug" },
      { name: "description", label: "Description", type: "textarea", span: 2 },
      { name: "position", label: "Sort order", type: "number" },
      { name: "visible", label: "Visible", type: "switch" },
    ];
  },
  async list(q, page) {
    const where: Prisma.LearningCategoryWhereInput = q ? { name: ci(q) } : {};
    const [rows, total] = await Promise.all([prisma.learningCategory.findMany({ where, orderBy: { position: "asc" }, ...skip(page), include: { _count: { select: { materials: { where: { deletedAt: null } } } } } }), prisma.learningCategory.count({ where })]);
    return { total, rows: rows.map((c) => ({ id: c.id, cells: [c.name, String(c._count.materials), { text: c.visible ? "VISIBLE" : "HIDDEN", badge: true }] })) };
  },
  defaults: async () => ({ visible: true, position: 0 }),
  load: (id) => prisma.learningCategory.findUnique({ where: { id } }),
  schema: () => z.object({ name: f.text(80), slug: f.slug(), description: f.optText(1000), position: f.int(-1000, 1000), visible: f.bool() }),
  async save(id, raw) {
    const data = { ...raw, slug: ensureSlug(String(raw.slug), String(raw.name)) } as Prisma.LearningCategoryUncheckedCreateInput;
    return (id ? await prisma.learningCategory.update({ where: { id }, data }) : await prisma.learningCategory.create({ data })).id;
  },
  async remove(id) {
    if (await prisma.learningMaterial.count({ where: { categoryId: id, deletedAt: null } })) throw new UserError("Move or delete this category's lessons first.");
    await prisma.learningMaterial.deleteMany({ where: { categoryId: id } });
    await prisma.learningCategory.delete({ where: { id } });
    return "deleted";
  },
  move: (id, dir) => swap(prisma.learningCategory as unknown as PosDelegate, id, dir),
};

const MATERIAL_TYPES = ["ARTICLE", "PDF", "VIDEO", "STUDY", "PGN", "PUZZLE", "ASSIGNMENT"] as const;
const materials: Resource = {
  key: "materials",
  title: "Learning materials",
  singular: "material",
  group: "Learning",
  permission: "learning.manage",
  description: "Articles, PDFs, videos, studies and PGNs. Members-only lessons need a plan with academy access.",
  columns: ["Lesson", "Category", "Type", "Access", "Status"],
  async fields() {
    const cats = await prisma.learningCategory.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } });
    return [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "slug", label: "Slug", type: "slug" },
      { name: "categoryId", label: "Category", type: "select", options: cats.map((c) => ({ value: c.id, label: c.name })), required: true },
      { name: "type", label: "Format", type: "select", options: STATUS_OPTIONS([...MATERIAL_TYPES]) },
      { name: "summary", label: "Summary", type: "textarea", required: true, span: 2 },
      { name: "body", label: "Lesson content", type: "markdown", span: 2 },
      { name: "coverImage", label: "Cover image", type: "image", span: 2 },
      { name: "videoUrl", label: "Video URL (YouTube / Vimeo)", type: "url", section: "Media" },
      { name: "fileUrl", label: "File (PDF / PGN)", type: "file" },
      { name: "pgn", label: "PGN (shown in the game viewer)", type: "textarea", span: 2 },
      { name: "level", label: "Level", type: "text", placeholder: "Beginner", section: "Access & display" },
      { name: "durationMinutes", label: "Duration (minutes)", type: "number" },
      { name: "access", label: "Access", type: "select", options: [{ value: "PUBLIC", label: "Everyone" }, { value: "MEMBERS", label: "Members with academy access" }] },
      { name: "downloadable", label: "Allow downloads", type: "switch" },
      { name: "position", label: "Sort order", type: "number" },
      { name: "published", label: "Published", type: "switch" },
    ];
  },
  async list(q, page) {
    const where: Prisma.LearningMaterialWhereInput = { deletedAt: null, ...(q ? { title: ci(q) } : {}) };
    const [rows, total] = await Promise.all([prisma.learningMaterial.findMany({ where, orderBy: [{ category: { position: "asc" } }, { position: "asc" }], ...skip(page), include: { category: true } }), prisma.learningMaterial.count({ where })]);
    return { total, rows: rows.map((m) => ({ id: m.id, cells: [m.title, m.category.name, humanize(m.type), m.access === "MEMBERS" ? "Members" : "Public", { text: m.published ? "PUBLISHED" : "DRAFT", badge: true }] })) };
  },
  defaults: async () => ({ type: "ARTICLE", access: "PUBLIC", published: false, position: 0 }),
  async load(id) {
    const m = await prisma.learningMaterial.findFirst({ where: { id, deletedAt: null } });
    return m ? { ...m, durationMinutes: m.durationMinutes ?? "" } : null;
  },
  schema: () =>
    z.object({
      title: f.text(160),
      slug: f.slug(),
      categoryId: z.string().min(1, "Pick a category"),
      type: f.enumOf(MATERIAL_TYPES),
      summary: f.text(1000),
      body: f.optText(100000),
      coverImage: f.url(),
      videoUrl: f.url(),
      fileUrl: f.url(),
      pgn: f.optText(100000),
      level: f.optText(40),
      durationMinutes: f.optInt(1, 1000),
      access: f.enumOf(["PUBLIC", "MEMBERS"]),
      downloadable: f.bool(),
      position: f.int(-1000, 1000),
      published: f.bool(),
    }),
  async save(id, raw) {
    if (raw.pgn) {
      const { Chess } = await import("chess.js");
      try {
        new Chess().loadPgn(String(raw.pgn));
      } catch {
        throw new UserError("The PGN could not be read.", { pgn: "Invalid PGN" });
      }
    }
    const data = { ...raw, slug: ensureSlug(String(raw.slug), String(raw.title)) } as Prisma.LearningMaterialUncheckedCreateInput;
    return (id ? await prisma.learningMaterial.update({ where: { id }, data }) : await prisma.learningMaterial.create({ data })).id;
  },
  async remove(id) {
    await prisma.learningMaterial.update({ where: { id }, data: { deletedAt: new Date(), published: false } });
    return "archived";
  },
  publicHref: (v) => (v.slug ? `/learn/${v.slug}` : null),
};

const puzzles: Resource = {
  key: "puzzles",
  title: "Puzzles",
  singular: "puzzle",
  group: "Learning",
  permission: "puzzles.manage",
  description: "Positions are validated move by move. Solutions use UCI notation (e2e4, e7e8q), alternating solver and reply.",
  columns: ["Puzzle", "Theme", "Rating", "Attempts", "Status"],
  async fields() {
    return [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "theme", label: "Theme / category", type: "text", placeholder: "Fork" },
      { name: "fen", label: "Position (FEN)", type: "text", required: true, span: 2 },
      { name: "solution", label: "Solution (UCI, space separated)", type: "text", required: true, span: 2, placeholder: "c4g8 d8g8 h6f7" },
      { name: "hint", label: "Hint", type: "text", span: 2 },
      { name: "description", label: "Description", type: "textarea", span: 2 },
      { name: "difficulty", label: "Difficulty", type: "select", options: STATUS_OPTIONS(["BEGINNER", "EASY", "MEDIUM", "HARD", "EXPERT"]) },
      { name: "rating", label: "Rating", type: "number" },
      { name: "published", label: "Published", type: "switch" },
    ];
  },
  async list(q, page) {
    const where: Prisma.PuzzleWhereInput = q ? { OR: [{ title: ci(q) }, { theme: ci(q) }] } : {};
    const [rows, total] = await Promise.all([prisma.puzzle.findMany({ where, orderBy: { rating: "asc" }, ...skip(page), include: { _count: { select: { attempts: true } } } }), prisma.puzzle.count({ where })]);
    return { total, rows: rows.map((p) => ({ id: p.id, cells: [p.title, p.theme ?? "—", String(p.rating), String(p._count.attempts), { text: p.published ? "PUBLISHED" : "DRAFT", badge: true }] })) };
  },
  defaults: async () => ({ difficulty: "MEDIUM", rating: 1200, published: false }),
  async load(id) {
    const p = await prisma.puzzle.findUnique({ where: { id } });
    return p ? { ...p, solution: p.solution.join(" ") } : null;
  },
  schema: () =>
    z.object({
      title: f.text(120),
      theme: f.optText(60),
      fen: z.string().trim().min(10).max(120),
      solution: z.string().trim().transform((v) => v.split(/[\s,]+/).filter(Boolean)),
      hint: f.optText(300),
      description: f.optText(2000),
      difficulty: f.enumOf(["BEGINNER", "EASY", "MEDIUM", "HARD", "EXPERT"]),
      rating: f.int(100, 3500),
      published: f.bool(),
    }),
  async save(id, raw) {
    const error = validatePuzzleLine(String(raw.fen), raw.solution as string[]);
    if (error) throw new UserError(error, { solution: error });
    const data = raw as Prisma.PuzzleUncheckedCreateInput;
    return (id ? await prisma.puzzle.update({ where: { id }, data }) : await prisma.puzzle.create({ data })).id;
  },
  async remove(id) {
    await prisma.puzzle.delete({ where: { id } });
    return "deleted";
  },
  publicHref: () => null,
};

// ─── Gallery ──────────────────────────────────────────────────────────────
const galleryCategories: Resource = {
  key: "gallery-categories",
  title: "Gallery categories",
  singular: "category",
  group: "Content",
  permission: "gallery.manage",
  columns: ["Category", "Photos"],
  fields: async () => [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "slug", label: "Slug", type: "slug" },
    { name: "position", label: "Sort order", type: "number" },
  ],
  async list(q, page) {
    const where: Prisma.GalleryCategoryWhereInput = q ? { name: ci(q) } : {};
    const [rows, total] = await Promise.all([prisma.galleryCategory.findMany({ where, orderBy: { position: "asc" }, ...skip(page), include: { _count: { select: { images: { where: { deletedAt: null } } } } } }), prisma.galleryCategory.count({ where })]);
    return { total, rows: rows.map((c) => ({ id: c.id, cells: [c.name, String(c._count.images)] })) };
  },
  defaults: async () => ({ position: 0 }),
  load: (id) => prisma.galleryCategory.findUnique({ where: { id } }),
  schema: () => z.object({ name: f.text(60), slug: f.slug(), position: f.int(-1000, 1000) }),
  async save(id, raw) {
    const data = { ...raw, slug: ensureSlug(String(raw.slug), String(raw.name)) } as Prisma.GalleryCategoryUncheckedCreateInput;
    return (id ? await prisma.galleryCategory.update({ where: { id }, data }) : await prisma.galleryCategory.create({ data })).id;
  },
  async remove(id) {
    await prisma.galleryCategory.delete({ where: { id } });
    return "deleted";
  },
  move: (id, dir) => swap(prisma.galleryCategory as unknown as PosDelegate, id, dir),
};

const gallery: Resource = {
  key: "gallery",
  title: "Gallery",
  singular: "photo",
  group: "Content",
  permission: "gallery.manage",
  description: "Upload, categorise, feature, hide and reorder photos.",
  columns: ["Photo", "Title", "Category", "Featured", "Visible"],
  async fields() {
    const cats = await prisma.galleryCategory.findMany({ orderBy: { position: "asc" } });
    return [
      { name: "imageUrl", label: "Image", type: "image", required: true, span: 2 },
      { name: "title", label: "Title", type: "text", required: true },
      { name: "categoryId", label: "Category", type: "select", options: [{ value: "", label: "Uncategorised" }, ...cats.map((c) => ({ value: c.id, label: c.name }))] },
      { name: "caption", label: "Caption", type: "text", span: 2 },
      { name: "alt", label: "Alt text (accessibility)", type: "text", span: 2 },
      { name: "position", label: "Sort order", type: "number" },
      { name: "featured", label: "Featured", type: "switch" },
      { name: "visible", label: "Visible", type: "switch" },
    ];
  },
  async list(q, page) {
    const where: Prisma.GalleryImageWhereInput = { deletedAt: null, ...(q ? { OR: [{ title: ci(q) }, { caption: ci(q) }] } : {}) };
    const [rows, total] = await Promise.all([prisma.galleryImage.findMany({ where, orderBy: [{ position: "asc" }], ...skip(page), include: { category: true } }), prisma.galleryImage.count({ where })]);
    return { total, rows: rows.map((g) => ({ id: g.id, cells: [{ text: g.title, image: g.imageUrl }, g.title, g.category?.name ?? "—", g.featured ? "★" : "", { text: g.visible ? "VISIBLE" : "HIDDEN", badge: true }] })) };
  },
  defaults: async () => ({ visible: true, featured: false, position: (await prisma.galleryImage.count()) }),
  load: (id) => prisma.galleryImage.findFirst({ where: { id, deletedAt: null } }),
  schema: () => z.object({ imageUrl: f.url().refine((v) => Boolean(v), "Upload an image"), title: f.text(120), categoryId: f.optId(), caption: f.optText(300), alt: f.optText(200), position: f.int(-10000, 10000), featured: f.bool(), visible: f.bool() }),
  async save(id, raw) {
    const size = await imageSize(String(raw.imageUrl));
    const data = { ...raw, ...size } as Prisma.GalleryImageUncheckedCreateInput;
    return (id ? await prisma.galleryImage.update({ where: { id }, data }) : await prisma.galleryImage.create({ data })).id;
  },
  async remove(id) {
    await prisma.galleryImage.update({ where: { id }, data: { deletedAt: new Date(), visible: false } });
    return "deleted";
  },
  move: (id, dir) => swap(prisma.galleryImage as unknown as PosDelegate, id, dir, { deletedAt: null }),
};

// ─── Simple CMS collections ───────────────────────────────────────────────
const testimonials: Resource = {
  key: "testimonials",
  title: "Testimonials",
  singular: "testimonial",
  group: "Content",
  permission: "cms.manage",
  columns: ["Name", "Quote", "Visible"],
  fields: async () => [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "roleLabel", label: "Role / label", type: "text", placeholder: "Player Development member" },
    { name: "quote", label: "Quote", type: "textarea", required: true, span: 2 },
    { name: "imageUrl", label: "Photo", type: "image", span: 2 },
    { name: "position", label: "Sort order", type: "number" },
    { name: "visible", label: "Visible", type: "switch" },
  ],
  async list(q, page) {
    const where: Prisma.TestimonialWhereInput = q ? { OR: [{ name: ci(q) }, { quote: ci(q) }] } : {};
    const [rows, total] = await Promise.all([prisma.testimonial.findMany({ where, orderBy: { position: "asc" }, ...skip(page) }), prisma.testimonial.count({ where })]);
    return { total, rows: rows.map((t) => ({ id: t.id, cells: [t.name, { text: t.quote.slice(0, 80), muted: true }, { text: t.visible ? "VISIBLE" : "HIDDEN", badge: true }] })) };
  },
  defaults: async () => ({ visible: true, position: 0 }),
  load: (id) => prisma.testimonial.findUnique({ where: { id } }),
  schema: () => z.object({ name: f.text(120), roleLabel: f.optText(120), quote: f.text(2000), imageUrl: f.url(), position: f.int(-1000, 1000), visible: f.bool() }),
  async save(id, raw) {
    const data = raw as Prisma.TestimonialUncheckedCreateInput;
    return (id ? await prisma.testimonial.update({ where: { id }, data }) : await prisma.testimonial.create({ data })).id;
  },
  async remove(id) {
    await prisma.testimonial.delete({ where: { id } });
    return "deleted";
  },
  move: (id, dir) => swap(prisma.testimonial as unknown as PosDelegate, id, dir),
};

const faqs: Resource = {
  key: "faqs",
  title: "FAQs",
  singular: "FAQ",
  group: "Content",
  permission: "cms.manage",
  columns: ["Question", "Category", "Visible"],
  fields: async () => [
    { name: "question", label: "Question", type: "text", required: true, span: 2 },
    { name: "answer", label: "Answer", type: "textarea", required: true, span: 2 },
    { name: "category", label: "Category", type: "text" },
    { name: "position", label: "Sort order", type: "number" },
    { name: "visible", label: "Visible", type: "switch" },
  ],
  async list(q, page) {
    const where: Prisma.FAQWhereInput = q ? { OR: [{ question: ci(q) }, { answer: ci(q) }] } : {};
    const [rows, total] = await Promise.all([prisma.fAQ.findMany({ where, orderBy: { position: "asc" }, ...skip(page) }), prisma.fAQ.count({ where })]);
    return { total, rows: rows.map((x) => ({ id: x.id, cells: [x.question, x.category ?? "—", { text: x.visible ? "VISIBLE" : "HIDDEN", badge: true }] })) };
  },
  defaults: async () => ({ visible: true, position: 0 }),
  load: (id) => prisma.fAQ.findUnique({ where: { id } }),
  schema: () => z.object({ question: f.text(300), answer: f.text(4000), category: f.optText(60), position: f.int(-1000, 1000), visible: f.bool() }),
  async save(id, raw) {
    const data = raw as Prisma.FAQUncheckedCreateInput;
    return (id ? await prisma.fAQ.update({ where: { id }, data }) : await prisma.fAQ.create({ data })).id;
  },
  async remove(id) {
    await prisma.fAQ.delete({ where: { id } });
    return "deleted";
  },
  move: (id, dir) => swap(prisma.fAQ as unknown as PosDelegate, id, dir),
};

const announcements: Resource = {
  key: "announcements",
  title: "Announcements",
  singular: "announcement",
  group: "Content",
  permission: "cms.manage",
  description: "Shown in the bar at the top of every page while published and within the date window.",
  columns: ["Title", "Window", "Status"],
  fields: async () => [
    { name: "title", label: "Headline", type: "text", required: true, span: 2 },
    { name: "body", label: "Detail", type: "text", span: 2 },
    { name: "linkLabel", label: "Link label", type: "text" },
    { name: "linkUrl", label: "Link URL", type: "url" },
    { name: "startsAt", label: "Show from", type: "datetime" },
    { name: "endsAt", label: "Show until", type: "datetime" },
    { name: "position", label: "Sort order", type: "number" },
    { name: "published", label: "Published", type: "switch" },
  ],
  async list(q, page) {
    const where: Prisma.AnnouncementWhereInput = q ? { title: ci(q) } : {};
    const [rows, total, tz] = await Promise.all([prisma.announcement.findMany({ where, orderBy: [{ position: "asc" }, { createdAt: "desc" }], ...skip(page) }), prisma.announcement.count({ where }), getAllSettings().then((s) => s.general.timezone)]);
    return { total, rows: rows.map((a) => ({ id: a.id, cells: [a.title, `${a.startsAt ? formatDate(a.startsAt, tz) : "Now"} → ${a.endsAt ? formatDate(a.endsAt, tz) : "∞"}`, { text: a.published ? "PUBLISHED" : "DRAFT", badge: true }] })) };
  },
  defaults: async () => ({ published: false, position: 0 }),
  async load(id, ctx) {
    const a = await prisma.announcement.findUnique({ where: { id } });
    return a ? { ...a, startsAt: toLocalInput(a.startsAt, ctx.tz), endsAt: toLocalInput(a.endsAt, ctx.tz) } : null;
  },
  schema: (ctx) => z.object({ title: f.text(200), body: f.optText(400), linkLabel: f.optText(40), linkUrl: f.url(), startsAt: f.optDatetime(ctx.tz), endsAt: f.optDatetime(ctx.tz), position: f.int(-1000, 1000), published: f.bool() }),
  async save(id, raw) {
    const data = raw as Prisma.AnnouncementUncheckedCreateInput;
    return (id ? await prisma.announcement.update({ where: { id }, data }) : await prisma.announcement.create({ data })).id;
  },
  async remove(id) {
    await prisma.announcement.delete({ where: { id } });
    return "deleted";
  },
};

const socialLinks: Resource = {
  key: "social-links",
  title: "Social links",
  singular: "link",
  group: "Content",
  permission: "cms.manage",
  columns: ["Platform", "URL", "Visible"],
  fields: async () => [
    { name: "platform", label: "Platform", type: "select", options: ["instagram", "facebook", "x", "youtube", "tiktok", "linkedin", "whatsapp", "website"].map((v) => ({ value: v, label: humanize(v.toUpperCase()) })) },
    { name: "label", label: "Label", type: "text", placeholder: "@handle" },
    { name: "url", label: "URL", type: "url", required: true, span: 2 },
    { name: "position", label: "Sort order", type: "number" },
    { name: "visible", label: "Visible", type: "switch" },
  ],
  async list(q, page) {
    const [rows, total] = await Promise.all([prisma.socialLink.findMany({ orderBy: { position: "asc" }, ...skip(page) }), prisma.socialLink.count()]);
    void q;
    return { total, rows: rows.map((s) => ({ id: s.id, cells: [humanize(s.platform.toUpperCase()), { text: s.url, mono: true }, { text: s.visible ? "VISIBLE" : "HIDDEN", badge: true }] })) };
  },
  defaults: async () => ({ platform: "instagram", visible: true, position: 0 }),
  load: (id) => prisma.socialLink.findUnique({ where: { id } }),
  schema: () => z.object({ platform: f.text(30), label: f.optText(60), url: z.string().trim().url(), position: f.int(-1000, 1000), visible: f.bool() }),
  async save(id, raw) {
    const data = raw as Prisma.SocialLinkUncheckedCreateInput;
    return (id ? await prisma.socialLink.update({ where: { id }, data }) : await prisma.socialLink.create({ data })).id;
  },
  async remove(id) {
    await prisma.socialLink.delete({ where: { id } });
    return "deleted";
  },
  move: (id, dir) => swap(prisma.socialLink as unknown as PosDelegate, id, dir),
};

const contentBlocks: Resource = {
  key: "content",
  title: "Page content",
  singular: "content block",
  group: "Content",
  permission: "cms.manage",
  description: "Hero, highlights, steps and calls to action on the homepage and about page. Pages render blocks by key and order.",
  columns: ["Key", "Page", "Title", "Visible"],
  fields: async () => [
    { name: "key", label: "Key", type: "text", required: true, help: "e.g. home.hero, home.method, about.intro" },
    { name: "page", label: "Page", type: "select", options: [{ value: "home", label: "Home" }, { value: "about", label: "About" }] },
    { name: "eyebrow", label: "Eyebrow", type: "text", span: 2 },
    { name: "title", label: "Title", type: "text" },
    { name: "highlight", label: "Highlighted title", type: "text" },
    { name: "body", label: "Body", type: "textarea", span: 2 },
    { name: "imageUrl", label: "Image", type: "image", span: 2 },
    { name: "ctaLabel", label: "Button label", type: "text" },
    { name: "ctaHref", label: "Button link", type: "url" },
    { name: "secondaryLabel", label: "Second button label", type: "text" },
    { name: "secondaryHref", label: "Second button link", type: "url" },
    { name: "items", label: "Items", type: "repeater", span: 2, fields: [{ name: "title", label: "Title", type: "text" }, { name: "body", label: "Text", type: "text" }] },
    { name: "position", label: "Order", type: "number" },
    { name: "visible", label: "Visible", type: "switch" },
  ],
  async list(q, page) {
    const where: Prisma.ContentBlockWhereInput = q ? { OR: [{ key: ci(q) }, { title: ci(q) }] } : {};
    const [rows, total] = await Promise.all([prisma.contentBlock.findMany({ where, orderBy: [{ page: "asc" }, { position: "asc" }], ...skip(page) }), prisma.contentBlock.count({ where })]);
    return { total, rows: rows.map((b) => ({ id: b.id, cells: [{ text: b.key, mono: true }, b.page, b.title ?? "—", { text: b.visible ? "VISIBLE" : "HIDDEN", badge: true }] })) };
  },
  defaults: async () => ({ page: "home", visible: true, position: 0, items: [] }),
  async load(id) {
    const b = await prisma.contentBlock.findUnique({ where: { id } });
    return b ? { ...b, items: Array.isArray(b.items) ? b.items : [] } : null;
  },
  schema: () =>
    z.object({
      key: z.string().trim().regex(/^[a-z0-9.-]+$/, "Lowercase letters, numbers, dots and dashes").max(60),
      page: f.enumOf(["home", "about"]),
      eyebrow: f.optText(160),
      title: f.optText(200),
      highlight: f.optText(200),
      body: f.optText(4000),
      imageUrl: f.url(),
      ctaLabel: f.optText(60),
      ctaHref: f.url(),
      secondaryLabel: f.optText(60),
      secondaryHref: f.url(),
      items: f.json(z.object({ title: z.string().trim().min(1, "Item title required").max(200), body: z.string().trim().max(600).optional() })),
      position: f.int(-1000, 1000),
      visible: f.bool(),
    }),
  async save(id, raw) {
    const data = raw as Prisma.ContentBlockUncheckedCreateInput;
    return (id ? await prisma.contentBlock.update({ where: { id }, data }) : await prisma.contentBlock.create({ data })).id;
  },
  async remove(id) {
    await prisma.contentBlock.delete({ where: { id } });
    return "deleted";
  },
};

const seoEntries: Resource = {
  key: "seo",
  title: "SEO overrides",
  singular: "SEO entry",
  group: "Content",
  permission: "cms.manage",
  description: "Override titles and descriptions for listing pages (/memberships, /events, /learn …). Detail pages use their own content.",
  columns: ["Path", "Title", "Noindex"],
  fields: async () => [
    { name: "path", label: "Path", type: "text", required: true, placeholder: "/memberships" },
    { name: "title", label: "Title", type: "text" },
    { name: "description", label: "Description", type: "textarea", span: 2 },
    { name: "ogImage", label: "Social image", type: "image", span: 2 },
    { name: "noindex", label: "Hide from search engines", type: "switch" },
  ],
  async list(q, page) {
    const where: Prisma.SeoEntryWhereInput = q ? { path: ci(q) } : {};
    const [rows, total] = await Promise.all([prisma.seoEntry.findMany({ where, orderBy: { path: "asc" }, ...skip(page) }), prisma.seoEntry.count({ where })]);
    return { total, rows: rows.map((s) => ({ id: s.id, cells: [{ text: s.path, mono: true }, s.title ?? "—", s.noindex ? "Yes" : "No"] })) };
  },
  defaults: async () => ({ noindex: false }),
  load: (id) => prisma.seoEntry.findUnique({ where: { id } }),
  schema: () => z.object({ path: z.string().trim().regex(/^\/[a-z0-9/-]*$/, "Start with / and use lowercase").max(120), title: f.optText(160), description: f.optText(320), ogImage: f.url(), noindex: f.bool() }),
  async save(id, raw) {
    const data = raw as Prisma.SeoEntryUncheckedCreateInput;
    return (id ? await prisma.seoEntry.update({ where: { id }, data }) : await prisma.seoEntry.create({ data })).id;
  },
  async remove(id) {
    await prisma.seoEntry.delete({ where: { id } });
    return "deleted";
  },
};

// ─── Locations & opening hours ────────────────────────────────────────────
const locations: Resource = {
  key: "locations",
  title: "Locations & hours",
  singular: "location",
  group: "Settings",
  permission: "settings.manage",
  description: "Opening hours and closures are enforced by the booking system.",
  columns: ["Location", "Address", "Primary", "Active"],
  fields: async () => [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "slug", label: "Slug", type: "slug" },
    { name: "address", label: "Address", type: "text", required: true },
    { name: "city", label: "City", type: "text", required: true },
    { name: "description", label: "Description", type: "textarea", span: 2 },
    { name: "phone", label: "Phone", type: "text" },
    { name: "email", label: "Email", type: "email" },
    { name: "mapUrl", label: "Map link / embed URL", type: "url", span: 2 },
    { name: "timezone", label: "Timezone", type: "text", help: "IANA name, e.g. Africa/Nairobi" },
    { name: "openingDate", label: "Opening date", type: "date" },
    { name: "isPrimary", label: "Primary location", type: "switch" },
    { name: "active", label: "Active", type: "switch" },
    {
      name: "openingHours",
      label: "Opening hours",
      type: "repeater",
      span: 2,
      section: "Opening hours",
      fields: [
        { name: "weekday", label: "Day", type: "select", options: WEEKDAYS.map((d, i) => ({ value: String(i), label: d })) },
        { name: "opensAt", label: "Opens", type: "time" },
        { name: "closesAt", label: "Closes", type: "time" },
        { name: "closed", label: "Closed", type: "switch" },
      ],
    },
    { name: "closures", label: "Closed dates", type: "repeater", span: 2, fields: [{ name: "date", label: "Date", type: "date" }, { name: "reason", label: "Reason", type: "text" }] },
  ],
  async list(q, page) {
    const [rows, total] = await Promise.all([prisma.location.findMany({ orderBy: { position: "asc" }, ...skip(page) }), prisma.location.count()]);
    void q;
    return { total, rows: rows.map((l) => ({ id: l.id, cells: [l.name, `${l.address}, ${l.city}`, l.isPrimary ? "★" : "", { text: l.active ? "ACTIVE" : "INACTIVE", badge: true }] })) };
  },
  defaults: async (ctx) => ({ timezone: ctx.tz, active: true, isPrimary: false, openingHours: WEEKDAYS.map((_, i) => ({ weekday: String(i), opensAt: "09:00", closesAt: "21:00", closed: false })), closures: [] }),
  async load(id) {
    const l = await prisma.location.findUnique({ where: { id }, include: { openingHours: { orderBy: { weekday: "asc" } }, closures: { where: { date: { gte: new Date(Date.now() - 86400_000) } }, orderBy: { date: "asc" } } } });
    if (!l) return null;
    return {
      ...l,
      openingDate: l.openingDate ? l.openingDate.toISOString().slice(0, 10) : "",
      openingHours: l.openingHours.map((h) => ({ weekday: String(h.weekday), opensAt: h.opensAt, closesAt: h.closesAt, closed: h.closed })),
      closures: l.closures.map((c) => ({ date: c.date.toISOString().slice(0, 10), reason: c.reason ?? "" })),
    };
  },
  schema: () =>
    z.object({
      name: f.text(120),
      slug: f.slug(),
      address: f.text(200),
      city: f.text(80),
      description: f.optText(2000),
      phone: f.optText(30),
      email: f.email(),
      mapUrl: f.url(),
      timezone: z.string().trim().refine((tz) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "Unknown timezone"),
      openingDate: f.optDate(),
      isPrimary: f.bool(),
      active: f.bool(),
      openingHours: f.json(z.object({ weekday: z.coerce.number().int().min(0).max(6), opensAt: f.clock(), closesAt: f.clock(), closed: f.bool() }).refine((h) => h.closed || h.opensAt < h.closesAt, "Closing must be after opening")),
      closures: f.json(z.object({ date: z.string().date("Pick a date"), reason: z.string().max(200).optional() })),
    }),
  async save(id, raw) {
    const { openingHours, closures, ...rest } = raw as { openingHours: { weekday: number; opensAt: string; closesAt: string; closed: boolean }[]; closures: { date: string; reason?: string }[] } & Record<string, unknown>;
    if (new Set(openingHours.map((h) => h.weekday)).size !== openingHours.length) throw new UserError("Each day can only appear once in opening hours.");
    const data = { ...rest, slug: ensureSlug(String(rest.slug), String(rest.name)) } as Prisma.LocationUncheckedCreateInput;
    return prisma.$transaction(async (tx) => {
      if (data.isPrimary) await tx.location.updateMany({ where: { isPrimary: true, ...(id ? { id: { not: id } } : {}) }, data: { isPrimary: false } });
      const l = id ? await tx.location.update({ where: { id }, data }) : await tx.location.create({ data });
      await tx.openingHour.deleteMany({ where: { locationId: l.id } });
      await tx.openingHour.createMany({ data: openingHours.map((h) => ({ ...h, locationId: l.id })) });
      await tx.closureDate.deleteMany({ where: { locationId: l.id, date: { gte: new Date(Date.now() - 86400_000) } } });
      await tx.closureDate.createMany({ data: closures.map((c) => ({ locationId: l.id, date: new Date(`${c.date}T00:00:00Z`), reason: c.reason || null })), skipDuplicates: true });
      return l.id;
    });
  },
  async remove(id) {
    await prisma.location.update({ where: { id }, data: { active: false } });
    return "archived";
  },
};

// ─── Coaches (profile; availability has its own screen) ───────────────────
const coaches: Resource = {
  key: "coaches",
  title: "Coaches",
  singular: "coach",
  group: "Coaching",
  permission: "coaches.manage",
  description: "Coach profiles are linked to user accounts. Creating a coach gives that user the COACH role.",
  columns: ["Coach", "Title", "Sessions", "Bookable", "Active"],
  async fields() {
    return [
      { name: "userEmail", label: "User account email", type: "email", required: true, createOnly: true, help: "The person must have registered an account first." },
      { name: "slug", label: "Profile URL slug", type: "slug" },
      { name: "title", label: "Title", type: "text", placeholder: "Resident coach" },
      { name: "headline", label: "Headline", type: "text", span: 2 },
      { name: "bio", label: "Bio", type: "markdown", required: true, span: 2 },
      { name: "imageUrl", label: "Photo", type: "image", span: 2 },
      { name: "specialties", label: "Specialties", type: "lines", help: "One per line" },
      { name: "rating", label: "Rating", type: "number" },
      { name: "sessionTypes", label: "Session types offered", type: "multiselect", options: await sessionTypeOptions(), span: 2 },
      { name: "position", label: "Sort order", type: "number" },
      { name: "isActive", label: "Active (listed publicly)", type: "switch" },
      { name: "acceptsBookings", label: "Accepting bookings", type: "switch" },
    ];
  },
  async list(q, page) {
    const where: Prisma.CoachProfileWhereInput = q ? { user: { name: ci(q) } } : {};
    const [rows, total] = await Promise.all([prisma.coachProfile.findMany({ where, orderBy: { position: "asc" }, ...skip(page), include: { user: { select: { name: true } }, _count: { select: { sessionTypes: true } } } }), prisma.coachProfile.count({ where })]);
    return { total, rows: rows.map((c) => ({ id: c.id, cells: [c.user.name, c.title ?? "—", String(c._count.sessionTypes), c.acceptsBookings ? "Yes" : "No", { text: c.isActive ? "ACTIVE" : "INACTIVE", badge: true }] })) };
  },
  defaults: async () => ({ isActive: true, acceptsBookings: true, position: 0, sessionTypes: [] }),
  async load(id) {
    const c = await prisma.coachProfile.findUnique({ where: { id }, include: { sessionTypes: { select: { id: true } }, user: { select: { email: true } } } });
    return c ? { ...c, userEmail: c.user.email, specialties: c.specialties.join("\n"), sessionTypes: c.sessionTypes.map((s) => s.id), rating: c.rating ?? "" } : null;
  },
  schema: () =>
    z.object({
      userEmail: z.string().trim().toLowerCase().email().optional(),
      slug: f.slug(),
      title: f.optText(80),
      headline: f.optText(200),
      bio: f.text(8000),
      imageUrl: f.url(),
      specialties: f.lines(),
      rating: f.optInt(100, 3500),
      sessionTypes: f.ids(),
      position: f.int(-1000, 1000),
      isActive: f.bool(),
      acceptsBookings: f.bool(),
    }),
  async save(id, raw) {
    const { userEmail, sessionTypes: st, ...data } = raw as { userEmail?: string; sessionTypes: string[] } & Record<string, unknown>;
    if (id) {
      const c = await prisma.coachProfile.update({ where: { id }, data: { ...(data as Prisma.CoachProfileUpdateInput), slug: ensureSlug(String(data.slug), id), sessionTypes: { set: st.map((s) => ({ id: s })) } } });
      return c.id;
    }
    const user = userEmail ? await prisma.user.findUnique({ where: { email: userEmail } }) : null;
    if (!user) throw new UserError("No account uses that email. Ask the coach to register first.", { userEmail: "Account not found" });
    if (await prisma.coachProfile.findUnique({ where: { userId: user.id } })) throw new UserError("That user already has a coach profile.");
    return prisma.$transaction(async (tx) => {
      if (user.role === "MEMBER") await tx.user.update({ where: { id: user.id }, data: { role: "COACH" } });
      const c = await tx.coachProfile.create({
        data: { ...(data as Omit<Prisma.CoachProfileUncheckedCreateInput, "userId" | "slug">), bio: String(data.bio), userId: user.id, slug: ensureSlug(String(data.slug), user.name), sessionTypes: { connect: st.map((s) => ({ id: s })) } },
      });
      return c.id;
    });
  },
  async remove(id) {
    await prisma.coachProfile.update({ where: { id }, data: { isActive: false, acceptsBookings: false } });
    return "archived";
  },
  removeLabel: "Deactivate coach",
  move: (id, dir) => swap(prisma.coachProfile as unknown as PosDelegate, id, dir),
  publicHref: (v) => (v.slug ? `/coaches/${v.slug}` : null),
};

export const RESOURCES: Record<string, Resource> = Object.fromEntries(
  [plans, sessionTypes, services, coaches, events, learningCategories, materials, puzzles, gallery, galleryCategories, contentBlocks, announcements, testimonials, faqs, socialLinks, seoEntries, locations].map((r) => [r.key, r]),
);

export async function resourceContext(): Promise<Ctx> {
  const s = await getAllSettings();
  return { tz: s.general.timezone, currency: s.general.currency };
}

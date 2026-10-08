/**
 * Integration tests: real PostgreSQL, real service layer, real HTTP callbacks
 * into the running app, and the local Daraja stand-in (tests/mock-daraja.mjs).
 * Run via `npm run test:integration` (tests/run.mjs starts everything).
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma, makeUser, cleanup, completePayment, APP_URL, TEST_PREFIX } from "./helpers";
import { can } from "@/server/rbac";
import { startMembershipCheckout } from "@/server/memberships";
import { startPayment, reconcilePayment } from "@/server/payments/service";
import { bookingContext, computeSlots, createBooking, quoteBooking, bookableSessionType } from "@/server/booking";
import { registerForEvent, seatsTaken } from "@/server/events";
import { checkMove } from "@/server/puzzles";
import { startServiceCheckout } from "@/server/services";
import { addDaysToKey, dateKeyInZone, zonedTimeToUtc, weekdayOfKey } from "@/lib/time";

const startedAt = new Date();
let providerWasEnabled = false;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  await cleanup();
  const provider = await prisma.paymentProvider.findUniqueOrThrow({ where: { key: "mpesa" } });
  providerWasEnabled = provider.enabled;
  await prisma.paymentProvider.update({ where: { id: provider.id }, data: { enabled: true } });
});

after(async () => {
  await prisma.paymentProvider.update({ where: { key: "mpesa" }, data: { enabled: providerWasEnabled } });
  await cleanup(startedAt);
  await prisma.$disconnect();
});

describe("RBAC", () => {
  test("permissions come from the database matrix", async () => {
    assert.equal(await can("MEMBER", "admin.access"), false);
    assert.equal(await can("MEMBER", "payments.view"), false);
    assert.equal(await can("ADMIN", "payments.secrets"), false, "only super admins handle credentials");
    assert.equal(await can("ADMIN", "memberships.manage"), true);
    assert.equal(await can("COACH", "coach.portal"), true);
    assert.equal(await can("MODERATOR", "community.moderate"), true);
    assert.equal(await can("MODERATOR", "payments.view"), false);
    assert.equal(await can("SUPER_ADMIN", "payments.secrets"), true);
  });

  test("protected pages redirect anonymous users and members", async () => {
    for (const path of ["/admin", "/admin/payments", "/dashboard", "/coach"]) {
      const res = await fetch(`${APP_URL}${path}`, { redirect: "manual" });
      assert.ok([303, 307, 308].includes(res.status), `${path} should redirect, got ${res.status}`);
      assert.match(res.headers.get("location") ?? "", /\/login/);
    }
  });
});

describe("M-Pesa membership payments", () => {
  test("STK push → verified callback activates the plan exactly once, duplicates are ignored", async () => {
    const user = await makeUser("buyer");
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { slug: "player-development" } });
    const order = await startMembershipCheckout(user.id, plan.id);
    assert.equal(order.total.toString(), plan.price.toString(), "order price comes from the plan row");

    const payment = await startPayment(user.id, order.id, "0712 345 678");
    assert.equal(payment.status, "PROCESSING");
    assert.ok(payment.checkoutRequestId);
    assert.equal(payment.phoneNumber, "254712345678");
    assert.equal(await prisma.membership.count({ where: { userId: user.id } }), 0, "nothing is activated on initiation");

    const { responses } = await completePayment({ checkoutRequestId: payment.checkoutRequestId!, result: "success", times: 3 });
    assert.deepEqual(responses.map((r) => r.status), [200, 200, 200]);
    assert.equal(responses[0].body?.ResultDesc, "success");
    assert.equal(responses[1].body?.ResultDesc, "duplicate");

    const settled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { order: { include: { invoice: true } } } });
    assert.equal(settled.status, "SUCCESS");
    assert.match(settled.receiptNumber ?? "", /^T[A-Z0-9]+$/);
    assert.equal(settled.order.status, "PAID");
    assert.ok(settled.order.invoice, "invoice issued");

    const memberships = await prisma.membership.findMany({ where: { userId: user.id } });
    assert.equal(memberships.length, 1);
    assert.equal(memberships[0].status, "ACTIVE");
    const days = (memberships[0].expiresAt!.getTime() - memberships[0].startsAt!.getTime()) / 86400_000;
    assert.ok(days >= 28 && days <= 31, `monthly period, got ${days} days`);
    assert.equal(await prisma.membershipPayment.count({ where: { paymentId: payment.id } }), 1);
    assert.equal(await prisma.paymentCallback.count({ where: { paymentId: payment.id } }), 1, "duplicate deliveries stored once");

    // Renewal extends the same membership by one period.
    const renewOrder = await startMembershipCheckout(user.id, plan.id);
    const renewPayment = await startPayment(user.id, renewOrder.id, "254712345678");
    await completePayment({ checkoutRequestId: renewPayment.checkoutRequestId!, result: "success" });
    const after = await prisma.membership.findMany({ where: { userId: user.id } });
    assert.equal(after.length, 1, "renewal does not create a second membership");
    assert.ok(after[0].expiresAt!.getTime() > memberships[0].expiresAt!.getTime() + 27 * 86400_000);
    assert.equal(await prisma.membershipRenewal.count({ where: { membershipId: after[0].id } }), 1);
  });

  test("a cancelled STK prompt marks the payment cancelled and activates nothing", async () => {
    const user = await makeUser("canceller");
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { slug: "clubhouse-sparring" } });
    const order = await startMembershipCheckout(user.id, plan.id);
    const payment = await startPayment(user.id, order.id, "0722000000");
    await completePayment({ checkoutRequestId: payment.checkoutRequestId!, result: "cancelled" });
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { order: true } });
    assert.equal(p.status, "CANCELLED");
    assert.equal(p.order.status, "PENDING", "order stays open so the member can retry");
    assert.equal(await prisma.membership.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.notification.count({ where: { userId: user.id, type: "PAYMENT_FAILED" } }), 1);
  });

  test("a success callback contradicted by the status query is not trusted", async () => {
    const user = await makeUser("forger");
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { slug: "clubhouse-sparring" } });
    const order = await startMembershipCheckout(user.id, plan.id);
    const payment = await startPayment(user.id, order.id, "0733000000");
    const { responses } = await completePayment({ checkoutRequestId: payment.checkoutRequestId!, result: "success", queryOverride: "failed" });
    assert.equal(responses[0].body?.ResultDesc, "query-disagrees");
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.notEqual(p.status, "SUCCESS");
    assert.equal(await prisma.membership.count({ where: { userId: user.id } }), 0);
  });

  test("an amount mismatch is never fulfilled", async () => {
    const user = await makeUser("underpayer");
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { slug: "clubhouse-sparring" } });
    const order = await startMembershipCheckout(user.id, plan.id);
    const payment = await startPayment(user.id, order.id, "0744000000");
    await completePayment({ checkoutRequestId: payment.checkoutRequestId!, result: "success", paidAmount: Number(plan.price) - 1 });
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    assert.equal(p.status, "PROCESSING");
    assert.equal(await prisma.membership.count({ where: { userId: user.id } }), 0);
  });

  test("callbacks with a bad token or forged payload are rejected", async () => {
    const bad = await fetch(`${APP_URL}/api/payments/mpesa/callback/not-the-token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(bad.status, 404);
  });

  test("a missed callback is recovered by status-query reconciliation", async () => {
    const user = await makeUser("reconcile");
    const service = await prisma.service.findFirstOrThrow({ where: { status: "ACTIVE" } });
    const order = await startServiceCheckout(user.id, service.id);
    const payment = await startPayment(user.id, order.id, "0755000000");
    await completePayment({ checkoutRequestId: payment.checkoutRequestId!, result: "success", sendCallback: false });
    assert.equal(await reconcilePayment(payment.id), "SUCCESS");
    const pass = await prisma.servicePurchase.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(pass.status, "ACTIVE");
    assert.ok(pass.validUntil && pass.validUntil > new Date());
  });

  test("phone numbers are validated before contacting M-Pesa", async () => {
    const user = await makeUser("badphone");
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { slug: "clubhouse-sparring" } });
    const order = await startMembershipCheckout(user.id, plan.id);
    await assert.rejects(() => startPayment(user.id, order.id, "12345"), /valid M-Pesa number/);
  });

  test("members cannot pay for someone else's order", async () => {
    const owner = await makeUser("owner");
    const intruder = await makeUser("intruder");
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { slug: "clubhouse-sparring" } });
    const order = await startMembershipCheckout(owner.id, plan.id);
    await assert.rejects(() => startPayment(intruder.id, order.id, "0712345678"), /Order not found/);
  });
});

describe("Booking engine", () => {
  let coachProfileId = "";
  let sessionTypeId = "";
  let dateKey = "";
  let tz = "";

  before(async () => {
    const ctx = await bookingContext();
    tz = ctx.timezone;
    // A date at least 2 days ahead, avoiding today's notice window.
    dateKey = addDaysToKey(dateKeyInZone(new Date(), tz), 2);
    const coachUser = await makeUser("coach", "COACH");
    const coach = await prisma.coachProfile.create({ data: { userId: coachUser.id, slug: `test-coach-${Date.now()}`, bio: "Test coach", availability: { create: [{ weekday: weekdayOfKey(dateKey), startTime: "07:00", endTime: "14:00" }] } } });
    coachProfileId = coach.id;
    const st = await prisma.sessionType.create({
      data: { name: `${TEST_PREFIX}Private coaching`, slug: `test-private-${Date.now()}`, description: "Test", durationMinutes: 60, price: 1000, capacity: 1, status: "ACTIVE", coaches: { connect: { id: coach.id } } },
    });
    sessionTypeId = st.id;
  });

  const at = (hhmm: string) => zonedTimeToUtc(dateKey, hhmm, tz);

  test("slots respect clubhouse opening hours and coach availability", async () => {
    const ctx = await bookingContext();
    const st = (await bookableSessionType(sessionTypeId))!;
    const slots = await computeSlots(ctx, st, [coachProfileId], dateKey);
    const starts = slots.map((s) => s.startsAt);
    const opens = ctx.location!.openingHours.find((h) => h.weekday === weekdayOfKey(dateKey))!.opensAt;
    assert.ok(!starts.includes(at("07:00").toISOString()), "coach availability before opening is clipped");
    assert.ok(starts.includes(at(opens).toISOString()));
    assert.ok(starts.includes(at("13:00").toISOString()), "last 60-minute slot ends at 14:00");
    assert.ok(!starts.includes(at("13:30").toISOString()), "a slot that would overrun availability is excluded");
  });

  test("double booking is prevented, including under concurrency", async () => {
    const a = await makeUser("booker-a");
    const b = await makeUser("booker-b");
    const c = await makeUser("booker-c");
    const first = await createBooking(a.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("10:00") });
    assert.equal(first.booking.status, "PENDING", "paid session waits for payment");
    assert.ok(first.orderId);
    await assert.rejects(() => createBooking(b.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("10:00") }), /no longer available/);
    await assert.rejects(() => createBooking(b.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("10:30") }), /no longer available/, "overlapping start is blocked");

    const race = await Promise.allSettled([
      createBooking(b.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("11:00") }),
      createBooking(c.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("11:00") }),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1, "exactly one concurrent booking wins");
    assert.equal(await prisma.booking.count({ where: { coachId: coachProfileId, startsAt: at("11:00"), status: { in: ["PENDING", "CONFIRMED"] } } }), 1);
  });

  test("bookings outside availability, during time off, on closures or for inactive coaches are refused", async () => {
    const m = await makeUser("booker-d");
    await assert.rejects(() => createBooking(m.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("15:00") }), /no longer available/, "outside coach availability");
    await prisma.coachTimeOff.create({ data: { coachId: coachProfileId, startsAt: at("12:00"), endsAt: at("13:00") } });
    await assert.rejects(() => createBooking(m.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("12:00") }), /no longer available/, "coach time off");
    await prisma.coachProfile.update({ where: { id: coachProfileId }, data: { acceptsBookings: false } });
    await assert.rejects(() => createBooking(m.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("13:00") }), /not taking bookings/);
    await prisma.coachProfile.update({ where: { id: coachProfileId }, data: { acceptsBookings: true } });
    const location = (await bookingContext()).location!;
    await prisma.closureDate.create({ data: { locationId: location.id, date: new Date(`${dateKey}T00:00:00Z`), reason: `${TEST_PREFIX}closure` } });
    await assert.rejects(() => createBooking(m.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("13:00") }), /no longer available/, "club closure");
    await prisma.closureDate.deleteMany({ where: { reason: `${TEST_PREFIX}closure` } });
  });

  test("an expired payment hold frees the slot", async () => {
    const m = await makeUser("hold");
    const { booking } = await createBooking(m.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("13:00") });
    await prisma.booking.update({ where: { id: booking.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const other = await makeUser("hold-2");
    const second = await createBooking(other.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("13:00") });
    assert.ok(second.booking.id);
  });

  test("paying for a booking confirms it via the callback", async () => {
    const m = await makeUser("payer");
    const { booking, orderId } = await createBooking(m.id, { sessionTypeId, coachId: coachProfileId, startsAt: at("09:00") });
    const payment = await startPayment(m.id, orderId!, "0711111111");
    await completePayment({ checkoutRequestId: payment.checkoutRequestId!, result: "success" });
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(b.status, "CONFIRMED");
    assert.equal(b.holdExpiresAt, null);
  });

  test("membership-only sessions and weekly included lessons are enforced", async () => {
    const lesson = await prisma.sessionType.findUniqueOrThrow({ where: { slug: "personal-lesson-review" } });
    await prisma.sessionType.update({ where: { id: lesson.id }, data: { coaches: { connect: { id: coachProfileId } } } });
    const guest = await makeUser("guest");
    const member = await makeUser("pd-member");
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { slug: "player-development" } });
    await prisma.membership.create({ data: { userId: member.id, planId: plan.id, status: "ACTIVE", startsAt: new Date(Date.now() - 86400_000), expiresAt: new Date(Date.now() + 20 * 86400_000) } });

    const guestQuote = await quoteBooking(guest.id, lesson.id, at("09:00"));
    assert.equal(guestQuote.price.toString(), lesson.price.toString(), "non-members pay the session price");
    const memberQuote = await quoteBooking(member.id, lesson.id, at("09:00"));
    assert.equal(memberQuote.usedEntitlement, true);
    assert.equal(memberQuote.price.toNumber(), 0, "weekly lesson is included");

    // The coach only works on dateKey's weekday; one week later is the same weekday in a fresh entitlement week.
    const free = await createBooking(member.id, { sessionTypeId: lesson.id, coachId: coachProfileId, startsAt: zonedTimeToUtc(addDaysToKey(dateKey, 7), "10:00", tz) });
    assert.equal(free.booking.status, "CONFIRMED");
    assert.equal(free.booking.usedEntitlement, true);
    const second = await quoteBooking(member.id, lesson.id, zonedTimeToUtc(addDaysToKey(dateKey, 7), "11:00", tz));
    assert.equal(second.usedEntitlement, false, "only one included lesson per week");

    const beginner = await prisma.sessionType.findUniqueOrThrow({ where: { slug: "beginner-guided-session" } });
    await assert.rejects(() => quoteBooking(guest.id, beginner.id, at("09:00")), /membership plan/);
    await prisma.sessionType.update({ where: { id: lesson.id }, data: { coaches: { disconnect: { id: coachProfileId } } } });
  });
});

describe("Events", () => {
  test("capacity is enforced under concurrent registration", async () => {
    const event = await prisma.event.create({
      data: { title: `${TEST_PREFIX}Blitz night`, slug: `test-blitz-${Date.now()}`, type: "BLITZ_TOURNAMENT", description: "Test", startsAt: new Date(Date.now() + 5 * 86400_000), endsAt: new Date(Date.now() + 5 * 86400_000 + 3 * 3600_000), capacity: 2, price: 0, status: "PUBLISHED" },
    });
    const users = await Promise.all([1, 2, 3, 4, 5].map((i) => makeUser(`player-${i}`)));
    const results = await Promise.allSettled(users.map((u) => registerForEvent(u.id, event.id)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
    assert.equal(await seatsTaken(event.id), 2);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.match(String(rejected.reason), /full/);
  });

  test("registration closes after the deadline", async () => {
    const event = await prisma.event.create({
      data: { title: `${TEST_PREFIX}Closed`, slug: `test-closed-${Date.now()}`, type: "HANGOUT", description: "Test", startsAt: new Date(Date.now() + 86400_000), endsAt: new Date(Date.now() + 90000_000), registrationDeadline: new Date(Date.now() - 1000), status: "PUBLISHED" },
    });
    const u = await makeUser("late");
    await assert.rejects(() => registerForEvent(u.id, event.id), /deadline/);
  });
});

describe("Puzzles", () => {
  test("moves are validated server-side and the solution stays hidden", async () => {
    const puzzle = await prisma.puzzle.findFirstOrThrow({ where: { title: "Smothered mate" } });
    const wrong = await checkMove(puzzle.id, ["c4c5"]);
    assert.equal(wrong.correct, false);
    const first = await checkMove(puzzle.id, ["c4g8"]);
    assert.ok(first.correct && !first.done && first.reply === "d8g8");
    const last = await checkMove(puzzle.id, ["c4g8", "h6f7"]);
    assert.ok(last.correct && last.done);
  });
});

describe("Public site", () => {
  test("pages render database content and prices", async () => {
    const plans = await prisma.membershipPlan.findMany({ where: { status: "ACTIVE" } });
    const html = await (await fetch(`${APP_URL}/memberships`)).text();
    for (const p of plans) {
      assert.ok(html.includes(p.name), `${p.name} shown`);
      assert.ok(html.includes(Number(p.price).toLocaleString("en-KE")), `${p.name} price shown`);
    }
    for (const path of ["/", "/events", "/learn", "/puzzles", "/community", "/gallery", "/coaches", "/book", "/faq", "/contact", "/about", "/sitemap.xml", "/robots.txt"]) {
      const res = await fetch(`${APP_URL}${path}`);
      assert.equal(res.status, 200, path);
    }
    await wait(10);
  });
});

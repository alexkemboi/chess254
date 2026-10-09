/**
 * Browser end-to-end tests (Playwright + installed Chrome) against the
 * production build started by tests/run.mjs.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { prisma, makeUser, cleanup, completePayment, APP_URL, TEST_PASSWORD, TEST_PREFIX } from "./helpers";

const SHOTS = process.env.SCREENSHOT_DIR;
const startedAt = new Date();
let browser: Browser;
let providerWasEnabled = false;
const originalPrices = new Map<string, string>();

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function login(page: Page, email: string) {
  await page.goto(`${APP_URL}/login`);
  await page.fill("#email", email);
  await page.fill("#password", TEST_PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }), page.click("button[type=submit]")]);
}

/** Surfaces browser-side failures in the test output. */
function watch(page: Page, label: string) {
  page.on("console", (m) => { if (m.type() === "error") console.log(`[${label} console] ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 400) console.log(`[${label} http ${r.status()}] ${r.request().method()} ${r.url()}`); });
  page.on("pageerror", (e) => console.log(`[${label} pageerror] ${e.message}`));
}

async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

before(async () => {
  await cleanup();
  const provider = await prisma.paymentProvider.findUniqueOrThrow({ where: { key: "mpesa" } });
  providerWasEnabled = provider.enabled;
  await prisma.paymentProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  for (const p of await prisma.membershipPlan.findMany()) originalPrices.set(p.id, p.price.toString());
  browser = await chromium.launch({ channel: "chrome", headless: true });
});

after(async () => {
  await browser?.close();
  for (const [id, price] of originalPrices) await prisma.membershipPlan.update({ where: { id }, data: { price } });
  await prisma.paymentProvider.update({ where: { key: "mpesa" }, data: { enabled: providerWasEnabled } });
  await cleanup(startedAt);
  await prisma.$disconnect();
});

describe("public site", () => {
  test("homepage renders CMS content on desktop and mobile without overflow", async () => {
    const hero = await prisma.contentBlock.findUniqueOrThrow({ where: { key: "home.hero" } });
    for (const viewport of [{ width: 1440, height: 900, name: "desktop" }, { width: 390, height: 844, name: "mobile" }]) {
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(APP_URL, { waitUntil: "networkidle" });
      await assert.doesNotReject(page.getByRole("heading", { level: 1 }).filter({ hasText: hero.title! }).waitFor({ timeout: 5000 }));
      assert.ok(await noHorizontalOverflow(page), `${viewport.name}: no horizontal scroll`);
      await shot(page, `home-${viewport.name}`);
      await page.evaluate(() => window.scrollTo(0, 1100));
      await page.waitForTimeout(900);
      await shot(page, `home-${viewport.name}-memberships`);
      assert.deepEqual(errors, []);
      await page.close();
    }
  });

  test("key pages fit mobile screens", async () => {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    for (const p of ["/memberships", "/events", "/learn", "/puzzles", "/community", "/gallery", "/book", "/contact", "/login", "/register"]) {
      await page.goto(`${APP_URL}${p}`, { waitUntil: "networkidle" });
      assert.ok(await noHorizontalOverflow(page), `${p} overflows on mobile`);
    }
    await page.goto(`${APP_URL}/gallery`, { waitUntil: "networkidle" });
    await shot(page, "gallery-mobile");
    // Mobile navigation opens and navigates.
    await page.goto(APP_URL);
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Academy" }).click();
    await page.waitForURL(/\/learn/);
    await page.close();
  });

  test("the theme toggle switches to light mode and persists across reloads", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const theme = () => page.evaluate(() => document.documentElement.className.match(/\b(light|dark)\b/)?.[1]);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    assert.equal(await theme(), "dark", "dark by default");
    const darkBg = await bg();
    await page.getByRole("button", { name: "Switch to light mode" }).first().click();
    assert.equal(await theme(), "light");
    // Wait out the 0.3s colour transition before reading the background.
    await page.waitForTimeout(500);
    assert.notEqual(await bg(), darkBg, "background changes");
    // The saved choice is applied before first paint on the next load and on other pages.
    await page.goto(`${APP_URL}/coaches`, { waitUntil: "commit" });
    await page.waitForSelector("body");
    assert.equal(await theme(), "light", "applied before hydration");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await theme(), "light", "persists after reload");
    await shot(page, "coaches-light");
    await page.getByRole("button", { name: "Switch to dark mode" }).first().click();
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await theme(), "dark");
    await context.close();
  });

  test("cards in the same row share one height", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    // Selectors are passed in rather than wrapped in a helper: tsx would inject a
    // `__name` call into a named function, which does not exist in the browser.
    const rows = {
      plans: await page.$$eval("article:has(a[href^='/join/'])", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height))),
      stats: await page.$$eval("main li > a[href='/coaches'], main li > a[href='/learn'], main li > a[href='/puzzles']", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height))),
    };
    for (const [name, h] of Object.entries(rows)) {
      assert.ok(h.length >= 2, `${name}: found cards`);
      assert.equal(new Set(h).size, 1, `${name}: equal heights ${h.join(", ")}`);
    }
    await page.close();
  });

  test("a puzzle can be solved by clicking the board", async () => {
    const puzzle = await prisma.puzzle.findFirstOrThrow({ where: { title: "Back-rank mate" } });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${APP_URL}/puzzles/${puzzle.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^d1 white r/ }).click();
    await page.getByRole("button", { name: /^d8$/ }).click();
    await page.getByText("Solved!").waitFor({ timeout: 8000 });
    await shot(page, "puzzle-solved");
    await page.close();
  });
});

describe("member journey", () => {
  test("register form validates, then a member buys a membership with M-Pesa", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    watch(page, "pay");
    await page.goto(`${APP_URL}/register`);
    await page.fill("#name", "x");
    await page.fill("#email", "not-an-email");
    await page.fill("#password", "short");
    await page.check("input[name=terms]");
    await page.click("button[type=submit]");
    await page.waitForTimeout(400);
    assert.ok(page.url().includes("/register"), "invalid registration stays on the form");

    const user = await makeUser("e2e-member");
    await login(page, user.email);
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { slug: "clubhouse-sparring" } });
    await page.goto(`${APP_URL}/memberships`);
    await page.getByRole("link", { name: new RegExp(`Choose KSh ${Number(plan.price).toLocaleString("en-KE")}`) }).first().click();
    await page.waitForURL(/\/join\//);
    await page.getByRole("button", { name: /Continue to payment/ }).click();
    await page.waitForURL(/\/pay\//);
    await page.fill("#phone", "0712345678");
    await shot(page, "pay-mobile");
    await page.getByRole("button", { name: /with M-Pesa/ }).click();
    await page.getByText("Check your phone").first().waitFor({ timeout: 10000 });
    assert.equal(await prisma.membership.count({ where: { userId: user.id } }), 0, "no activation before confirmation");

    await completePayment({ result: "success" });
    await page.getByText("Payment confirmed").waitFor({ timeout: 20000 });
    await shot(page, "pay-confirmed");
    await page.goto(`${APP_URL}/dashboard`);
    await page.getByText(plan.name).first().waitFor();
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(m.status, "ACTIVE");
    await page.close();
  });

  test("a member books a coaching session from the calendar", async () => {
    const coachUser = await makeUser("e2e-coach", "COACH");
    const weekdays = [0, 1, 2, 3, 4, 5, 6];
    const coach = await prisma.coachProfile.create({ data: { userId: coachUser.id, slug: `e2e-coach-${Date.now()}`, bio: "Test", availability: { create: weekdays.map((weekday) => ({ weekday, startTime: "16:00", endTime: "20:00" })) } } });
    const st = await prisma.sessionType.create({ data: { name: `${TEST_PREFIX}Game review`, slug: `e2e-review-${Date.now()}`, description: "Review", durationMinutes: 60, price: 0, capacity: 1, status: "ACTIVE", coaches: { connect: { id: coach.id } } } });
    const member = await makeUser("e2e-booker");
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await login(page, member.email);
    await page.goto(`${APP_URL}/book?type=${st.id}`, { waitUntil: "networkidle" });
    const day = page.locator("button[aria-label*='slots']").first();
    await day.waitFor({ timeout: 15000 });
    await day.click();
    await page.getByRole("button", { name: /PM/ }).first().click();
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await page.waitForURL(/\/dashboard\/bookings/, { timeout: 15000 });
    await shot(page, "booking-confirmed");
    const booking = await prisma.booking.findFirstOrThrow({ where: { memberId: member.id } });
    assert.equal(booking.status, "CONFIRMED");
    assert.equal(booking.coachId, coach.id);
    await page.close();
  });

  test("members post, comment and like in the community", async () => {
    const member = await makeUser("e2e-poster");
    const page = await browser.newPage();
    watch(page, "community");
    await login(page, member.email);
    await page.goto(`${APP_URL}/community/new`);
    await page.fill("input[name=title]", `${TEST_PREFIX}Best response to the London?`);
    await page.fill("textarea[name=body]", "What do you all play against 1.d4 2.Bf4?");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/community\/[a-z0-9]+$/);
    await page.getByPlaceholder("Add to the discussion…").fill("I like ...c5 setups.");
    await page.getByRole("button", { name: "Comment" }).click();
    await page.getByText("I like ...c5 setups.").waitFor();
    await page.getByRole("button", { name: "Like" }).click();
    await page.waitForTimeout(500);
    const post = await prisma.communityPost.findFirstOrThrow({ where: { authorId: member.id } });
    assert.equal(post.commentCount, 1);
    assert.equal(post.likeCount, 1);
    await page.close();
  });
});

describe("staff journeys", () => {
  test("an admin price change is reflected on the public site immediately", async () => {
    const admin = await makeUser("e2e-admin", "SUPER_ADMIN");
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { slug: "clubhouse-sparring" } });
    const newPrice = Number(plan.price) + 500;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, admin.email);
    await page.goto(`${APP_URL}/admin`, { waitUntil: "networkidle" });
    await shot(page, "admin-dashboard");
    await page.goto(`${APP_URL}/admin/manage/plans/${plan.id}`);
    await page.fill("input[name=price]", String(newPrice));
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText("Plan saved.").waitFor();
    await page.goto(`${APP_URL}/memberships`);
    await page.getByText(`KSh ${newPrice.toLocaleString("en-KE")}`).first().waitFor();
    const log = await prisma.auditLog.findFirst({ where: { actorId: admin.id, action: "plans.update", entityId: plan.id } });
    assert.ok(log, "change is audited");
    for (const p of ["/admin/users", "/admin/bookings", "/admin/payments", "/admin/settings", "/admin/payment-settings", "/admin/roles", "/admin/audit", "/admin/reports", "/admin/moderation", "/admin/manage/gallery", "/admin/manage/events/new"]) {
      const res = await page.goto(`${APP_URL}${p}`);
      assert.equal(res?.status(), 200, p);
    }
    await page.goto(`${APP_URL}/admin/payment-settings`);
    const html = await page.content();
    assert.ok(!html.includes("test-consumer-secret") && !html.includes("test-passkey-0123456789"), "secrets never reach the browser");
    await shot(page, "admin-payment-settings");
    await page.close();
  });

  test("a member cannot open the admin portal; a coach manages availability", async () => {
    const member = await makeUser("e2e-nosy");
    const page = await browser.newPage();
    await login(page, member.email);
    await page.goto(`${APP_URL}/admin/payments`);
    await page.waitForURL(/\/forbidden/);

    const coachUser = await makeUser("e2e-coach-2", "COACH");
    await prisma.coachProfile.create({ data: { userId: coachUser.id, slug: `e2e-coach2-${Date.now()}`, bio: "Test" } });
    const coachPage = await browser.newPage();
    await login(coachPage, coachUser.email);
    await coachPage.goto(`${APP_URL}/coach/availability`);
    await coachPage.getByRole("button", { name: "Add hours" }).first().click();
    await coachPage.getByRole("button", { name: "Save availability" }).click();
    await coachPage.getByText("Availability saved").waitFor();
    const coach = await prisma.coachProfile.findUniqueOrThrow({ where: { userId: coachUser.id }, include: { availability: true } });
    assert.equal(coach.availability.length, 1);
    await page.close();
    await coachPage.close();
  });
});

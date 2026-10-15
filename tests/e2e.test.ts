/**
 * Browser end-to-end tests (Playwright + installed Chrome) against the
 * production build started by tests/run.mjs.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createHash, randomBytes } from "node:crypto";
import { prisma, makeUser, cleanup, completePayment, APP_URL, TEST_DOMAIN, TEST_PASSWORD, TEST_PREFIX } from "./helpers";

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

  test("the theme toggle switches to dark mode and persists across reloads", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const theme = () => page.evaluate(() => document.documentElement.className.match(/\b(light|dark)\b/)?.[1]);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    assert.equal(await theme(), "light", "light by default");
    const lightBg = await bg();
    await page.getByRole("button", { name: "Switch to dark mode" }).first().click();
    assert.equal(await theme(), "dark");
    // Wait out the 0.3s colour transition before reading the background.
    await page.waitForTimeout(500);
    assert.notEqual(await bg(), lightBg, "background changes");
    // The saved choice is applied before first paint on the next load and on other pages.
    await page.goto(`${APP_URL}/coaches`, { waitUntil: "commit" });
    await page.waitForSelector("body");
    assert.equal(await theme(), "dark", "applied before hydration");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await theme(), "dark", "persists after reload");
    await shot(page, "coaches-dark");
    await page.getByRole("button", { name: "Switch to light mode" }).first().click();
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await theme(), "light");
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

  test("a visitor pays first, then creates the account from the emailed registration link", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    watch(page, "pay-first");
    const email = `guest-${Date.now()}${TEST_DOMAIN}`;
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { slug: "clubhouse-sparring" } });
    await page.goto(`${APP_URL}/join/${plan.slug}`);
    await page.fill("input[name=name]", `${TEST_PREFIX}Guest Payer`);
    await page.fill("input[name=email]", email);
    await page.fill("input[name=phone]", "0712345678");
    await page.check("input[name=terms]");
    await page.getByRole("button", { name: /Continue to M-Pesa payment/ }).click();
    await page.waitForURL(/\/checkout\//);
    const pending = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(pending.passwordHash, "", "no password before payment");
    await page.getByRole("button", { name: /with M-Pesa/ }).click();
    await page.getByText("Check your phone").first().waitFor({ timeout: 10000 });
    await completePayment({ result: "success" });
    await page.getByText("Check your email").waitFor({ timeout: 20000 });
    assert.ok(await noHorizontalOverflow(page), "guest checkout fits a phone screen");
    await shot(page, "pay-first-confirmed");
    assert.equal((await prisma.membership.findFirstOrThrow({ where: { userId: pending.id } })).status, "ACTIVE");
    assert.equal(await prisma.verificationToken.count({ where: { userId: pending.id, type: "ACCOUNT_SETUP", usedAt: null } }), 1, "registration link issued after payment");

    // The emailed token is hashed at rest, so issue a known one the same way to follow the link.
    const token = randomBytes(24).toString("base64url");
    await prisma.verificationToken.create({ data: { userId: pending.id, type: "ACCOUNT_SETUP", tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } });
    await page.goto(`${APP_URL}/complete-registration?token=${token}`);
    await page.getByText("Almost there.").waitFor();
    await page.fill("input[name=password]", TEST_PASSWORD);
    await page.fill("input[name=confirm]", TEST_PASSWORD);
    await page.getByRole("button", { name: "Create my account" }).click();
    await page.waitForURL(/\/dashboard\/membership/);
    await page.getByText(plan.name).first().waitFor();
    const done = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.ok(done.passwordHash && done.emailVerifiedAt, "account is complete");
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

describe("camp registration journey", () => {
  test("a parent registers week by week on phone, tablet and desktop, then pays by M-Pesa", async () => {
    // Copy the real camp's form into a test event so the journey exercises the configured fields.
    const source = await prisma.event.findUnique({ where: { slug: "minichess-holiday-camp" } });
    assert.ok(source, "Holiday Camp is seeded");
    const start = Date.now() + 30 * 86400_000;
    const day = 86400_000;
    const camp = await prisma.event.create({
      data: {
        title: `${TEST_PREFIX}Camp journey`,
        slug: `test-camp-journey-${Date.now()}`,
        type: "TRAINING_CAMP",
        description: "Test",
        status: "PUBLISHED",
        registrationMode: "FORM",
        sessionLabel: "Week",
        submitLabel: "Register for Holiday Camp",
        formFields: source.formFields ?? [],
        startsAt: new Date(start),
        endsAt: new Date(start + 11 * day),
        sessions: { create: [0, 1, 2].map((w) => ({ label: `Week ${w + 1}`, startsAt: new Date(start + w * 7 * day), endsAt: new Date(start + (w * 7 + 4) * day), paymentDeadline: new Date(start + (w * 7 - 7) * day), position: w })) },
        packages: { create: [{ name: "Half Day", price: 4500, position: 0 }, { name: "Full Day", price: 6500, position: 1 }] },
      },
    });

    for (const viewport of [{ width: 390, height: 844, name: "phone" }, { width: 820, height: 1180, name: "tablet" }, { width: 1440, height: 900, name: "desktop" }]) {
      const page = await browser.newPage({ viewport });
      watch(page, `camp-${viewport.name}`);
      const email = `camp-${viewport.name}-${Date.now()}${TEST_DOMAIN}`;
      await page.goto(`${APP_URL}/events/${camp.slug}`);
      await page.getByRole("link", { name: "Register for Holiday Camp" }).first().click();
      await page.waitForURL(/\/register$/);

      // Step 1 — Continue stays inactive until the required answers are valid.
      await page.getByText("Step 1 of 4").waitFor();
      const next = page.getByRole("button", { name: "Continue" });
      assert.equal(await next.getAttribute("aria-disabled"), "true");
      await page.fill("#field-child_name", `Kid ${viewport.name}`);
      await page.fill("#field-child_age", "9");
      await page.getByRole("radio", { name: "Beginner" }).click();
      assert.equal(await next.getAttribute("aria-disabled"), "false");
      await next.click();

      // Step 2 — week cards with a live total.
      await page.getByText("Step 2 of 4").waitFor();
      await page.getByRole("radiogroup", { name: "Week 1 attendance" }).getByRole("radio", { name: /Full Day/ }).click();
      await page.getByRole("radiogroup", { name: "Week 3 attendance" }).getByRole("radio", { name: /Half Day/ }).click();
      await page.getByText("KSh 11,000").first().waitFor();
      assert.ok(await noHorizontalOverflow(page), `${viewport.name}: weeks fit the screen`);
      await shot(page, `camp-weeks-${viewport.name}`);
      await next.click();

      // Step 3 — answers survive going back and forward.
      await page.getByText("Step 3 of 4").waitFor();
      await page.getByRole("button", { name: /Back/ }).click();
      await page.getByText("Step 2 of 4").waitFor();
      await page.getByText("KSh 11,000").first().waitFor();
      await next.click();
      await page.fill("#field-parent_name", "Test Parent");
      await page.fill("#field-parent_phone", "712345678");
      await page.fill("#field-parent_email", email);
      await page.fill("#field-emergency_name", "Aunt Test");
      await page.fill("#field-emergency_phone", "+254722000000");
      await page.fill("#field-authorised_collector", "Aunt Test 0722 000 000");
      await page.getByRole("radio", { name: "Yes, I consent" }).click();
      assert.equal(await page.inputValue("#field-parent_phone"), "0712 345 678", "Kenyan numbers are formatted");
      await next.click();

      // Step 4 — review, edit link, payment options, submit once.
      await page.getByText("Step 4 of 4").waitFor();
      await page.getByText("Week 1 · Full Day").waitFor();
      await page.getByRole("radio", { name: "M-Pesa" }).click();
      assert.equal(await page.locator("#field-payment_reference").count(), 0, "reference only when already paid");
      await page.getByRole("radio", { name: "Yes", exact: true }).click();
      await page.locator("#field-payment_reference").waitFor();
      await page.getByRole("radio", { name: "No, please send payment instructions" }).click();
      await page.getByText(/I confirm I am the child/).click();
      await shot(page, `camp-review-${viewport.name}`);
      const submit = page.getByRole("button", { name: "Register for Holiday Camp" });
      assert.equal(await submit.getAttribute("aria-disabled"), "false", "submit is enabled once everything is valid");
      await Promise.all([page.waitForURL(/\/registrations\/EV-/, { timeout: 20000 }), submit.click()]);
      await page.getByText("You're registered!").waitFor();
      const reg = await prisma.eventRegistration.findFirstOrThrow({ where: { contactEmail: email }, include: { items: true } });
      assert.equal(reg.price.toString(), "11000");
      assert.equal(reg.items.length, 2);
      assert.equal(reg.contactPhone, "0712 345 678");
      await page.getByText(reg.reference).first().waitFor();
      assert.ok(await noHorizontalOverflow(page), `${viewport.name}: success screen fits`);
      await page.getByText("Invite another family").waitFor();

      if (viewport.name === "phone") {
        await page.getByRole("button", { name: /Pay KSh 11,000 with M-Pesa/ }).click();
        await page.getByText("Check your phone").first().waitFor({ timeout: 10000 });
        await completePayment({ result: "success" });
        await page.getByText("Payment confirmed").waitFor({ timeout: 20000 });
        assert.equal(await page.getByText("Change weeks or number").count(), 0);
        await shot(page, "camp-paid-phone");
        const paid = await prisma.eventRegistration.findUniqueOrThrow({ where: { id: reg.id } });
        assert.equal(paid.feeStatus, "PAID", "verified by the backend");
        assert.equal(paid.status, "CONFIRMED");
      }
      await page.close();
    }
  });
});

describe("merchandise shop", () => {
  test("a guest picks a size, checks out on a phone and pays by M-Pesa", async () => {
    const n = Date.now().toString(36);
    const category = await prisma.productCategory.create({ data: { name: `${TEST_PREFIX}Apparel ${n}`, slug: `test-apparel-${n}` } });
    await prisma.deliveryOption.create({ data: { name: `${TEST_PREFIX}Front desk pick-up`, method: "COLLECTION", fee: 0, counties: [], position: -100 } });
    const product = await prisma.product.create({
      data: {
        name: `${TEST_PREFIX}Club Hoodie ${n}`,
        slug: `test-hoodie-${n}`,
        sku: `TEST-HOODIE-${n}`.toUpperCase(),
        categoryId: category.id,
        description: "Warm **club** hoodie.",
        price: 2500,
        salePrice: 2200,
        status: "PUBLISHED",
        images: { create: [{ url: "/gallery/minichesphotos/rubber-board-walnut.jpeg", alt: "Test", position: 0 }] },
        variants: { create: [{ sku: `TEST-HOODIE-${n}-M`.toUpperCase(), name: "M", options: { Size: "M" }, stockOnHand: 3, position: 0 }, { sku: `TEST-HOODIE-${n}-L`.toUpperCase(), name: "L", options: { Size: "L" }, stockOnHand: 0, position: 1 }] },
      },
      include: { variants: true },
    });
    const email = `hoodie-${n}${TEST_DOMAIN}`;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    watch(page, "shop");
    await page.goto(`${APP_URL}/shop/${product.slug}`, { waitUntil: "networkidle" });
    assert.ok(await noHorizontalOverflow(page), "product page fits a phone");
    await page.getByText("KSh 2,200").first().waitFor();
    await page.getByRole("button", { name: "L", exact: true }).click();
    await page.getByText("Sold out").first().waitFor();
    await page.getByRole("button", { name: "M", exact: true }).click();
    await page.getByRole("button", { name: "Increase quantity" }).click();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.getByText("Added to your cart").waitFor();
    await shot(page, "shop-product-phone");

    await page.goto(`${APP_URL}/shop/cart`, { waitUntil: "networkidle" });
    await page.getByText("KSh 4,400").first().waitFor();
    assert.ok(await noHorizontalOverflow(page), "cart fits a phone");
    await Promise.all([page.waitForURL(/\/shop\/checkout/), page.getByRole("link", { name: "Checkout" }).click()]);
    await page.fill("#name", "Test Shopper");
    await page.fill("#email", email);
    await page.fill("#phone", "0712 345 678");
    await page.getByText(`${TEST_PREFIX}Front desk pick-up`).click();
    await page.getByRole("button", { name: /Place order · KSh 4,400/ }).waitFor();
    assert.ok(await noHorizontalOverflow(page), "checkout fits a phone");
    await shot(page, "shop-checkout-phone");
    await Promise.all([page.waitForURL(/\/shop\/orders\//, { timeout: 20000 }), page.getByRole("button", { name: /Place order/ }).click()]);

    const order = await prisma.shopOrder.findFirstOrThrow({ where: { customerEmail: email } });
    assert.equal(order.total.toString(), "4400", "server-side price");
    assert.equal((await prisma.productVariant.findFirstOrThrow({ where: { sku: `TEST-HOODIE-${n}-M`.toUpperCase() } })).stockReserved, 2);
    await page.getByRole("button", { name: /Pay KSh 4,400 with M-Pesa/ }).click();
    await page.getByText("Check your phone").first().waitFor({ timeout: 10000 });
    await completePayment({ result: "success" });
    await page.getByText("Payment confirmed").first().waitFor({ timeout: 20000 });
    await shot(page, "shop-paid-phone");
    const paid = await prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(paid.status, "PAID", "verified by the backend");
    assert.equal((await prisma.productVariant.findFirstOrThrow({ where: { sku: `TEST-HOODIE-${n}-M`.toUpperCase() } })).stockOnHand, 1);
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
    for (const p of ["/admin/users", "/admin/bookings", "/admin/payments", "/admin/mpesa-transactions", "/admin/settings", "/admin/settings?group=payments", "/admin/payment-settings", "/admin/roles", "/admin/audit", "/admin/reports", "/admin/moderation", "/admin/manage/gallery", "/admin/manage/events/new"]) {
      const res = await page.goto(`${APP_URL}${p}`);
      assert.equal(res?.status(), 200, p);
    }
    await page.goto(`${APP_URL}/admin/payment-settings`);
    const html = await page.content();
    assert.ok(!html.includes("test-consumer-secret") && !html.includes("test-passkey-0123456789"), "secrets never reach the browser");
    await shot(page, "admin-payment-settings");
    await page.close();
  });

  test("an admin configures the M-Pesa account from Settings → Payments", async () => {
    const admin = await makeUser("e2e-mpesa-admin", "SUPER_ADMIN");
    const before = await prisma.paymentConfiguration.findFirstOrThrow({ where: { provider: { key: "mpesa" } } });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await login(page, admin.email);
      await page.goto(`${APP_URL}/admin/settings?group=payments`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "M-Pesa account" }).waitFor();
      const html = await page.content();
      assert.ok(!html.includes("test-consumer-secret") && !html.includes("test-passkey-0123456789"), "secrets never reach the browser");
      assert.equal(await page.locator("input[name=tillNumber]").count(), 0, "till field hidden for a paybill");
      await page.selectOption("select[name=accountType]", "TILL");
      await page.fill("input[name=tillNumber]", "5432101");
      await page.fill("input[name=pullNominatedNumber]", "0722 000 000");
      await shot(page, "admin-settings-mpesa");
      await page.getByRole("button", { name: "Save M-Pesa account" }).click();
      await page.getByText(/M-Pesa account saved|Saved, but/).first().waitFor();
      const after = await prisma.paymentConfiguration.findUniqueOrThrow({ where: { id: before.id } });
      assert.equal(after.transactionType, "CustomerBuyGoodsOnline");
      assert.equal(after.tillNumber, "5432101");
      assert.equal(after.pullNominatedNumber, "254722000000");
    } finally {
      await prisma.paymentConfiguration.update({ where: { id: before.id }, data: { transactionType: before.transactionType, tillNumber: before.tillNumber, paybillNumber: before.paybillNumber, shortcode: before.shortcode, environment: before.environment, pullNominatedNumber: before.pullNominatedNumber } });
      await page.close();
    }
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

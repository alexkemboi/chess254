/**
 * Merchandise shop integration tests: catalogue, cart, checkout pricing,
 * stock reservations under concurrency, M-Pesa settlement and retries,
 * expiry, fulfilment transitions, refunds and inventory adjustments.
 * Run via `npm run test:integration` (tests/run.mjs starts the app and the Daraja mock).
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma, makeUser, cleanup, completePayment, APP_URL, TEST_DOMAIN, TEST_PREFIX } from "./helpers";
import { addToCart, cartView, createCart } from "@/server/shop/cart";
import { placeShopOrder, quoteCheckout } from "@/server/shop/checkout";
import { transitionShopOrder } from "@/server/shop/lifecycle";
import { adjustStock } from "@/server/shop/inventory";
import { shopOrderPath } from "@/server/shop/links";
import { expireOrder, startPayment } from "@/server/payments/service";

const startedAt = new Date();
let providerWasEnabled = false;
const tag = `${Date.now().toString(36)}`;

let categoryId = "";
let pickupId = "";
let deliveryId = "";

async function makeProduct(opts: { name: string; price: number; salePrice?: number; status?: "PUBLISHED" | "DRAFT"; variants: { size?: string; stock: number }[] }) {
  const n = Math.round(Math.random() * 1e9).toString(36);
  return prisma.product.create({
    data: {
      name: `${TEST_PREFIX}${opts.name}`,
      slug: `test-${n}`,
      sku: `TEST-${n}`.toUpperCase(),
      categoryId,
      description: "Test product",
      price: opts.price,
      salePrice: opts.salePrice ?? null,
      status: opts.status ?? "PUBLISHED",
      variants: {
        create: opts.variants.map((v, i) => ({ sku: `TEST-${n}-${i}`.toUpperCase(), name: v.size ?? "Default", options: v.size ? { Size: v.size } : {}, isDefault: !v.size, stockOnHand: v.stock, position: i })),
      },
    },
    include: { variants: { orderBy: { position: "asc" } } },
  });
}

async function cartWith(lines: { variantId: string; quantity: number }[]) {
  const { cart } = await createCart(null);
  for (const l of lines) await addToCart(cart.id, l.variantId, l.quantity);
  return cart;
}

const customer = (n: string | number) => ({ name: "Test Customer", email: `shopper-${n}-${tag}${TEST_DOMAIN}`, phone: "0712345678" });

function order(cartId: string, extra: Partial<Parameters<typeof placeShopOrder>[0]> = {}) {
  return placeShopOrder({
    cartId,
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    viewerId: null,
    ...customer(Math.round(Math.random() * 1e6)),
    method: "COLLECTION",
    deliveryOptionId: pickupId,
    county: null,
    town: null,
    address: null,
    instructions: null,
    discountCode: null,
    ...extra,
  });
}

async function paidOrder(cartId: string) {
  const so = await order(cartId);
  const payment = await startPayment(so.userId, so.orderId, "0712345678");
  await completePayment({ checkoutRequestId: payment.checkoutRequestId!, result: "success" });
  return prisma.shopOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } });
}

const variant = (id: string) => prisma.productVariant.findUniqueOrThrow({ where: { id } });

before(async () => {
  await cleanup();
  const provider = await prisma.paymentProvider.findUniqueOrThrow({ where: { key: "mpesa" } });
  providerWasEnabled = provider.enabled;
  await prisma.paymentProvider.update({ where: { id: provider.id }, data: { enabled: true } });
  categoryId = (await prisma.productCategory.create({ data: { name: `${TEST_PREFIX}Category ${tag}`, slug: `test-cat-${tag}` } })).id;
  pickupId = (await prisma.deliveryOption.create({ data: { name: `${TEST_PREFIX}Pick-up`, method: "COLLECTION", fee: 0, counties: [] } })).id;
  deliveryId = (await prisma.deliveryOption.create({ data: { name: `${TEST_PREFIX}Nairobi delivery`, method: "DELIVERY", fee: 300, freeAbove: 5000, counties: ["Nairobi"] } })).id;
});

after(async () => {
  await prisma.paymentProvider.update({ where: { key: "mpesa" }, data: { enabled: providerWasEnabled } });
  await cleanup(startedAt);
  await prisma.$disconnect();
});

describe("Shop catalogue and cart", () => {
  test("cart prices come from the database and stock limits are enforced", async () => {
    const tee = await makeProduct({ name: "Club tee", price: 1500, salePrice: 1200, variants: [{ size: "M", stock: 5 }, { size: "L", stock: 1 }] });
    const draft = await makeProduct({ name: "Hidden draft", price: 900, status: "DRAFT", variants: [{ stock: 5 }] });
    const [m, l] = tee.variants;
    const { cart } = await createCart(null);
    await addToCart(cart.id, m.id, 2);
    await assert.rejects(() => addToCart(cart.id, l.id, 2), /Only 1 available/);
    await assert.rejects(() => addToCart(cart.id, draft.variants[0].id, 1), /no longer available/);
    const view = await cartView(cart.id);
    assert.equal(view.subtotal, 2400, "sale price × quantity");
    assert.equal(view.lines[0].regularPrice, 1500);

    // A price change is picked up live; carts never store prices.
    await prisma.product.update({ where: { id: tee.id }, data: { salePrice: 1100 } });
    assert.equal((await cartView(cart.id)).subtotal, 2200);
    // Unpublishing flags the line instead of silently selling it.
    await prisma.product.update({ where: { id: tee.id }, data: { status: "UNPUBLISHED" } });
    const flagged = await cartView(cart.id);
    assert.equal(flagged.lines[0].issue, "unavailable");
    assert.equal(flagged.hasIssues, true);
  });
});

describe("Shop checkout", () => {
  test("re-prices on the server, applies discount and delivery rules, reserves stock and is idempotent", async () => {
    const set = await makeProduct({ name: "Vinyl set", price: 1249, variants: [{ stock: 10 }] });
    const code = await prisma.discountCode.create({ data: { code: `TEST${tag}`.toUpperCase().slice(0, 30), type: "PERCENT", value: 10, maxUses: 5 } });
    const cart = await cartWith([{ variantId: set.variants[0].id, quantity: 2 }]);

    const quote = await quoteCheckout({ cartId: cart.id, deliveryOptionId: deliveryId, county: "Mombasa", discountCode: code.code });
    assert.match(quote.deliveryError ?? "", /doesn't deliver to Mombasa/);

    const key = `idem-${tag}`;
    const input = { cartId: cart.id, idempotencyKey: key, viewerId: null, ...customer("checkout"), method: "DELIVERY" as const, deliveryOptionId: deliveryId, county: "Nairobi", town: "Westlands", address: "Test House", instructions: null, discountCode: code.code };
    const so = await placeShopOrder(input);
    assert.equal(so.subtotal.toString(), "2498");
    assert.equal(so.discountTotal.toString(), "249.8", "10% of merchandise");
    assert.equal(so.deliveryFee.toString(), "300");
    assert.equal(so.total.toString(), "2548.2");
    assert.equal(so.status, "PENDING_PAYMENT");
    const payOrder = await prisma.order.findUniqueOrThrow({ where: { id: so.orderId } });
    assert.equal(payOrder.total.toString(), so.total.toString(), "payment order total matches");
    assert.equal(payOrder.number, so.number);
    assert.equal((await variant(set.variants[0].id)).stockReserved, 2, "stock held at checkout");
    assert.equal((await prisma.discountCode.findUniqueOrThrow({ where: { id: code.id } })).usesCount, 1);

    const again = await placeShopOrder(input);
    assert.equal(again.id, so.id, "a double submit returns the same order");
    assert.equal((await variant(set.variants[0].id)).stockReserved, 2, "and doesn't reserve twice");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: so.userId } });
    assert.equal(user.passwordHash, "", "guests get a pending account, never a login");
    assert.ok(await prisma.notificationDelivery.findFirst({ where: { recipient: so.customerEmail, subject: { contains: "received" } } }), "acknowledgement recorded");

    // Checking out again from the same cart replaces the unpaid order instead of holding stock twice.
    const replaced = await placeShopOrder({ ...input, idempotencyKey: `${key}-2` });
    assert.notEqual(replaced.id, so.id);
    assert.equal((await prisma.shopOrder.findUniqueOrThrow({ where: { id: so.id } })).status, "CANCELLED");
    assert.equal((await variant(set.variants[0].id)).stockReserved, 2);
  });

  test("concurrent checkouts can never oversell the last item", async () => {
    const rare = await makeProduct({ name: "Last board", price: 5000, variants: [{ stock: 1 }] });
    const carts = await Promise.all([1, 2, 3].map(() => cartWith([{ variantId: rare.variants[0].id, quantity: 1 }])));
    const results = await Promise.allSettled(carts.map((c) => order(c.id)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "exactly one order gets the item");
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.match(String(rejected.reason?.message), /sold out|Only 0/);
    const v = await variant(rare.variants[0].id);
    assert.equal(v.stockReserved, 1);
    assert.equal(v.stockOnHand, 1, "nothing deducted before payment");
  });
});

describe("Shop payments", () => {
  test("a failed payment can be retried; the verified payment commits stock exactly once", async () => {
    const set = await makeProduct({ name: "Rubber set", price: 1349, variants: [{ size: "M", stock: 4 }] });
    const cart = await cartWith([{ variantId: set.variants[0].id, quantity: 2 }]);
    const so = await order(cart.id);

    const first = await startPayment(so.userId, so.orderId, "0712345678");
    await completePayment({ checkoutRequestId: first.checkoutRequestId!, result: "cancelled" });
    let current = await prisma.shopOrder.findUniqueOrThrow({ where: { id: so.id } });
    assert.equal(current.status, "PENDING_PAYMENT", "still open for a retry");
    assert.equal((await variant(set.variants[0].id)).stockReserved, 2, "items stay held");

    const retry = await startPayment(so.userId, so.orderId, "0712345678");
    assert.notEqual(retry.id, first.id);
    const { responses } = await completePayment({ checkoutRequestId: retry.checkoutRequestId!, result: "success", times: 3 });
    assert.equal(responses[1].body?.ResultDesc, "duplicate");

    current = await prisma.shopOrder.findUniqueOrThrow({ where: { id: so.id } });
    assert.equal(current.status, "PAID");
    assert.ok(current.paidAt && current.receiptSentAt);
    const v = await variant(set.variants[0].id);
    assert.equal(v.stockOnHand, 2, "deducted once");
    assert.equal(v.stockReserved, 0);
    assert.equal(await prisma.stockMovement.count({ where: { shopOrderId: so.id, type: "SALE" } }), 1);
    assert.equal(await prisma.shopOrder.count({ where: { orderId: so.orderId } }), 1, "no duplicate orders");
    assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 0, "basket emptied after payment");
    const receipts = await prisma.notificationDelivery.count({ where: { recipient: so.customerEmail, subject: { contains: "Payment confirmed" } } });
    assert.equal(receipts, 1, "one receipt, sent only after verification");
    await assert.rejects(() => startPayment(so.userId, so.orderId, "0712345678"), /already been paid/);
  });

  test("a success callback contradicted by the status query never marks the order paid", async () => {
    const set = await makeProduct({ name: "Clock", price: 3500, variants: [{ stock: 2 }] });
    const so = await order((await cartWith([{ variantId: set.variants[0].id, quantity: 1 }])).id);
    const payment = await startPayment(so.userId, so.orderId, "0712345678");
    await completePayment({ checkoutRequestId: payment.checkoutRequestId!, result: "success", queryOverride: "failed" });
    const current = await prisma.shopOrder.findUniqueOrThrow({ where: { id: so.id } });
    assert.equal(current.status, "PENDING_PAYMENT");
    assert.equal((await variant(set.variants[0].id)).stockOnHand, 2);
  });

  test("an unpaid order that lapses releases its stock and discount", async () => {
    const set = await makeProduct({ name: "Bag", price: 800, variants: [{ stock: 3 }] });
    const code = await prisma.discountCode.create({ data: { code: `TESTX${tag}`.toUpperCase().slice(0, 30), type: "FIXED", value: 100, maxUses: 1 } });
    const so = await order((await cartWith([{ variantId: set.variants[0].id, quantity: 3 }])).id, { discountCode: code.code });
    assert.equal(so.total.toString(), "2300");
    assert.equal((await prisma.discountCode.findUniqueOrThrow({ where: { id: code.id } })).usesCount, 1);
    await expireOrder(so.orderId);
    const current = await prisma.shopOrder.findUniqueOrThrow({ where: { id: so.id } });
    assert.equal(current.status, "CANCELLED");
    assert.ok(current.stockReleasedAt);
    assert.equal((await variant(set.variants[0].id)).stockReserved, 0);
    assert.equal((await prisma.discountCode.findUniqueOrThrow({ where: { id: code.id } })).usesCount, 0, "code usable again");
    assert.equal(await prisma.stockMovement.count({ where: { shopOrderId: so.id, type: "RELEASE" } }), 1);
  });
});

describe("Shop fulfilment and inventory", () => {
  test("status changes follow the allowed flow, are audited, and refunds restock", async () => {
    const admin = await makeUser("shop-admin", "ADMIN");
    const set = await makeProduct({ name: "Wooden set", price: 6000, variants: [{ stock: 5 }] });
    const so = await paidOrder((await cartWith([{ variantId: set.variants[0].id, quantity: 1 }])).id);
    assert.equal((await variant(set.variants[0].id)).stockOnHand, 4);

    await assert.rejects(() => transitionShopOrder(so.id, { to: "SHIPPED" }, admin.id), /can't be marked shipped/, "pick-up orders aren't shipped");
    await assert.rejects(() => transitionShopOrder(so.id, { to: "DELIVERED" }, admin.id), /can't be marked delivered/);
    await transitionShopOrder(so.id, { to: "PROCESSING" }, admin.id);
    await transitionShopOrder(so.id, { to: "READY_FOR_COLLECTION", note: "Collect at the front desk" }, admin.id);
    await transitionShopOrder(so.id, { to: "DELIVERED", collectedBy: "Parent" }, admin.id);
    let current = await prisma.shopOrder.findUniqueOrThrow({ where: { id: so.id }, include: { events: true } });
    assert.equal(current.status, "DELIVERED");
    assert.ok(current.processingAt && current.readyAt && current.deliveredAt);
    assert.equal(current.collectedBy, "Parent");
    assert.equal(current.events.filter((e) => e.kind === "STATUS" && e.actorId === admin.id).length, 3);
    assert.equal(await prisma.auditLog.count({ where: { entity: "ShopOrder", entityId: so.id } }), 3);
    assert.ok(await prisma.notificationDelivery.findFirst({ where: { recipient: so.customerEmail, subject: { contains: "ready for collection" } } }), "customer told it's ready");

    await assert.rejects(() => transitionShopOrder(so.id, { to: "REFUNDED" }, admin.id), /refund reference/);
    await transitionShopOrder(so.id, { to: "REFUNDED", refundReference: "TREF12345", restock: true }, admin.id);
    current = await prisma.shopOrder.findUniqueOrThrow({ where: { id: so.id }, include: { events: true } });
    assert.equal(current.status, "REFUNDED");
    assert.equal((await variant(set.variants[0].id)).stockOnHand, 5, "returned to stock");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: so.orderId } })).status, "REFUNDED");
    assert.equal((await prisma.payment.findFirstOrThrow({ where: { orderId: so.orderId } })).status, "REFUNDED");
    await assert.rejects(() => transitionShopOrder(so.id, { to: "PROCESSING" }, admin.id), /can't be marked/);
  });

  test("stock adjustments are logged and can't drop below reserved units", async () => {
    const set = await makeProduct({ name: "Scoresheets", price: 300, variants: [{ stock: 2 }] });
    await order((await cartWith([{ variantId: set.variants[0].id, quantity: 2 }])).id);
    await assert.rejects(() => prisma.$transaction((tx) => adjustStock(tx, set.variants[0].id, -1, { reason: "Damaged", actorId: null })), /reserved/);
    const row = await prisma.$transaction((tx) => adjustStock(tx, set.variants[0].id, 8, { reason: "New stock received", actorId: null }));
    assert.equal(row.stockOnHand, 10);
    const moves = await prisma.stockMovement.findMany({ where: { variantId: set.variants[0].id }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(moves.map((m) => m.type), ["RESERVE", "ADJUSTMENT"]);
    assert.equal(moves[1].onHandAfter, 10);
    // The database itself refuses impossible stock.
    await assert.rejects(() => prisma.productVariant.update({ where: { id: set.variants[0].id }, data: { stockReserved: 50 } }));
  });
});

describe("Shop pages and access", () => {
  test("the storefront shows published products only and order pages need the signed link", async () => {
    const shown = await makeProduct({ name: `Visible ${tag}`, price: 1000, variants: [{ stock: 3 }] });
    const hidden = await makeProduct({ name: `Draft ${tag}`, price: 1000, status: "DRAFT", variants: [{ stock: 3 }] });
    const html = await (await fetch(`${APP_URL}/shop?q=${tag}`)).text();
    assert.ok(html.includes(shown.name), "published product listed");
    assert.ok(!html.includes(hidden.name), "draft hidden");
    const page = await fetch(`${APP_URL}/shop/${shown.slug}`);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes("Add to cart"));
    // notFound() streams the 404 page (the site layout has a loading state), so check the content.
    const notFound = async (path: string) => { const t = await (await fetch(`${APP_URL}${path}`)).text(); return t.includes("That square is empty") && !t.includes("Add to cart"); };
    assert.ok(await notFound(`/shop/${hidden.slug}`), "draft product page is not found");

    const so = await order((await cartWith([{ variantId: shown.variants[0].id, quantity: 1 }])).id);
    assert.ok(await notFound(`/shop/orders/${so.number}`), "no key, no order");
    assert.ok(await notFound(`/shop/orders/${so.number}?k=forged`), "forged key, no order");
    const ok = await fetch(`${APP_URL}${shopOrderPath(so.number)}`);
    assert.equal(ok.status, 200);
    assert.ok((await ok.text()).includes(so.number));
  });
});

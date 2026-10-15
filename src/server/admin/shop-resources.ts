import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { UserError } from "@/server/errors";
import { currentUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { adjustStock } from "@/server/shop/inventory";
import type { FieldDef, Option } from "@/lib/fields";
import { formatDate, formatMoney, humanize } from "@/lib/format";
import { available, optionsLabel, parseOptions } from "@/lib/shop";
import { KENYA_COUNTIES } from "@/lib/kenya";
import { decimalString, ensureSlug, f, toLocalInput } from "./fields";
import type { Resource } from "./resources";

const PAGE_SIZE = 25;
const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });
const skip = (page: number) => ({ skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE });
const RESERVED_SLUGS = new Set(["cart", "checkout", "orders"]);
const PRODUCT_STATUSES = ["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"] as const;
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional().transform((v) => (v === undefined || v === null ? "" : String(v)));

async function attributes() {
  return prisma.productAttribute.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], include: { values: { orderBy: [{ position: "asc" }, { value: "asc" }] } } });
}

/** Repeater key for an attribute column (attribute names can contain spaces). */
const attrKey = (name: string) => `opt:${name}`;

// ─── Products ─────────────────────────────────────────────────────────────

type VariantRow = { id?: string; options: Record<string, string>; sku: string; price: number | null; salePrice: number | null; stock: number; hidden: boolean };

export const products: Resource = {
  key: "products",
  title: "Products",
  singular: "product",
  group: "Shop",
  permission: "shop.products",
  description: "Merchandise for the online shop. Only published products are visible to customers; prices and stock are always checked on the server at checkout.",
  columns: ["Product", "Photo", "Category", "Price", "Stock", "Status"],
  async fields() {
    const [cats, attrs] = await Promise.all([prisma.productCategory.findMany({ orderBy: { position: "asc" } }), attributes()]);
    const variantFields: FieldDef[] = [
      ...attrs.map((a) => ({ name: attrKey(a.name), label: a.name, type: "select" as const, options: [{ value: "", label: "—" }, ...a.values.map((v) => ({ value: v.value, label: v.value }))] })),
      { name: "sku", label: "Variant SKU", type: "text" },
      { name: "price", label: "Price (blank = product)", type: "money" },
      { name: "salePrice", label: "Discounted", type: "money" },
      { name: "stock", label: "Stock on hand", type: "number" },
      { name: "hidden", label: "Hidden", type: "switch" },
    ];
    return [
      { name: "name", label: "Product name", type: "text", required: true },
      { name: "sku", label: "SKU", type: "text", required: true, help: "Unique stock code, e.g. MC-VINYL-SET." },
      { name: "categoryId", label: "Category", type: "select", required: true, options: cats.map((c) => ({ value: c.id, label: c.name })) },
      { name: "productType", label: "Product type", type: "text", placeholder: "e.g. Roll-up vinyl set", help: "Free text shown above the name." },
      { name: "status", label: "Status", type: "select", options: PRODUCT_STATUSES.map((s) => ({ value: s, label: humanize(s) })), help: "Draft and unpublished products are hidden from customers." },
      { name: "slug", label: "URL slug", type: "slug", help: "Public page: /shop/<slug>. Blank = from the name." },
      { name: "shortDescription", label: "Short description", type: "text", span: 2, help: "One or two lines shown near the price." },
      { name: "description", label: "Full description", type: "markdown", required: true, span: 2 },
      { name: "images", label: "Photos", type: "images", span: 2 },
      { name: "price", label: "Selling price", type: "money", required: true, section: "Pricing" },
      { name: "salePrice", label: "Discounted price (optional)", type: "money", help: "When set and lower, customers pay this and see the original crossed out." },
      { name: "currency", label: "Currency", type: "text" },
      { name: "featured", label: "Featured product", type: "switch", help: "Shown in “Featured picks” at the top of the shop." },
      { name: "stock", label: "Stock on hand (simple products)", type: "number", section: "Inventory", help: "For products without variants. Changes are logged as stock adjustments." },
      { name: "lowStockThreshold", label: "Low-stock alert at", type: "number", help: "Blank = shop default." },
      {
        name: "variants",
        label: "Variants",
        type: "repeater",
        span: 2,
        section: "Variants (sizes, colours, materials, designs)",
        help: attrs.length
          ? "One row per sellable combination, e.g. Size M + Colour Black. Leave empty for a simple product. Removing a variant that has orders hides it instead. Add sizes, colours and other options under Shop → Attributes."
          : "Create attributes such as Size or Colour under Shop → Attributes first.",
        fields: variantFields,
      },
      { name: "position", label: "Sort order", type: "number", section: "Display & SEO" },
      { name: "seoTitle", label: "SEO title", type: "text" },
      { name: "seoDescription", label: "SEO description", type: "textarea", span: 2 },
    ];
  },
  async list(q, page) {
    const where: Prisma.ProductWhereInput = q ? { OR: [{ name: ci(q) }, { sku: ci(q) }, { variants: { some: { sku: ci(q) } } }] } : {};
    const [rows, total] = await Promise.all([
      prisma.product.findMany({ where, orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { position: "asc" }, { name: "asc" }], ...skip(page), include: { category: true, images: { orderBy: { position: "asc" }, take: 1 }, variants: { where: { active: true } } } }),
      prisma.product.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((p) => {
        const stock = p.variants.reduce((s, v) => s + available(v), 0);
        const price = p.salePrice && p.salePrice.lessThan(p.price) ? `${formatMoney(p.salePrice, p.currency)} (was ${formatMoney(p.price, p.currency)})` : formatMoney(p.price, p.currency);
        return { id: p.id, cells: [p.name, p.images[0] ? { text: p.name, image: p.images[0].url } : "—", p.category.name, { text: price, mono: true }, { text: `${stock}${p.variants.length > 1 ? ` · ${p.variants.length} variants` : ""}`, muted: stock === 0 }, { text: p.status, badge: true }] };
      }),
    };
  },
  async defaults(ctx) {
    const first = await prisma.productCategory.findFirst({ orderBy: { position: "asc" } });
    return { status: "DRAFT", currency: ctx.currency, categoryId: first?.id ?? "", featured: false, position: 0, stock: 0, images: [], variants: [] };
  },
  async load(id) {
    const p = await prisma.product.findUnique({ where: { id }, include: { images: { orderBy: { position: "asc" } }, variants: { orderBy: { position: "asc" } } } });
    if (!p) return null;
    const optioned = p.variants.filter((v) => !v.isDefault && v.active);
    const simple = p.variants.find((v) => v.isDefault);
    return {
      ...p,
      price: decimalString(p.price),
      salePrice: decimalString(p.salePrice),
      lowStockThreshold: p.lowStockThreshold ?? "",
      images: p.images.map((i) => ({ url: i.url, alt: i.alt ?? "" })),
      stock: simple?.stockOnHand ?? 0,
      variants: optioned.map((v) => ({ id: v.id, ...Object.fromEntries(Object.entries(parseOptions(v.options)).map(([k, val]) => [attrKey(k), val])), sku: v.sku, price: decimalString(v.price), salePrice: decimalString(v.salePrice), stock: v.stockOnHand, hidden: false })),
    };
  },
  schema: () =>
    z.object({
      name: f.text(160),
      sku: z.string().trim().toUpperCase().min(2, "Required").max(60).regex(/^[A-Z0-9._-]+$/, "Letters, numbers, dot, dash and underscore only"),
      categoryId: z.string().min(1, "Pick a category"),
      productType: f.optText(80),
      status: f.enumOf(PRODUCT_STATUSES),
      slug: f.slug(),
      shortDescription: f.optText(300),
      description: f.text(20000),
      images: f.json(z.object({ url: z.string().trim().min(1).max(500).refine((v) => v.startsWith("/") || /^https?:\/\//.test(v), "Photos need a /path or full URL"), alt: z.string().trim().max(200).optional() })),
      price: f.money(),
      salePrice: f.optMoney(),
      currency: z.string().trim().length(3).toUpperCase(),
      featured: f.bool(),
      stock: f.int(0, 1_000_000),
      lowStockThreshold: f.optInt(0, 100_000),
      variants: f.json(z.record(z.string(), z.unknown())).transform((rows, c): VariantRow[] => {
        const out: VariantRow[] = [];
        for (const row of rows) {
          const r = z.object({ id: z.string().max(40).optional(), sku: cell, price: cell, salePrice: cell, stock: cell, hidden: z.union([z.boolean(), z.string()]).optional() }).parse(row);
          const options = Object.fromEntries(Object.entries(row).filter(([k, v]) => k.startsWith("opt:") && typeof v === "string" && v).map(([k, v]) => [k.slice(4), String(v)]));
          const label = optionsLabel(options) || "a variant";
          const num = (v: string, field: string, int = false) => {
            if (!v.trim()) return null;
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0 || (int && !Number.isInteger(n))) {
              c.addIssue({ code: "custom", message: `${label}: ${field} must be ${int ? "a whole number" : "a positive amount"}` });
              return null;
            }
            return n;
          };
          if (!Object.keys(options).length) c.addIssue({ code: "custom", message: "Every variant needs at least one option (e.g. a size or colour)" });
          const sku = r.sku.trim().toUpperCase();
          if (sku && !/^[A-Z0-9._-]+$/.test(sku)) c.addIssue({ code: "custom", message: `${label}: SKU uses letters, numbers, dot, dash and underscore only` });
          out.push({ id: r.id || undefined, options, sku, price: num(r.price, "price"), salePrice: num(r.salePrice, "discounted price"), stock: num(r.stock, "stock", true) ?? 0, hidden: r.hidden === true || r.hidden === "true" });
        }
        return out;
      }),
      position: f.int(-10000, 10000),
      seoTitle: f.optText(160),
      seoDescription: f.optText(300),
    }),
  async save(id, raw) {
    const { images, variants, stock, ...rest } = raw as { images: { url: string; alt?: string }[]; variants: VariantRow[]; stock: number } & Record<string, unknown>;
    const slug = ensureSlug(String(rest.slug), String(rest.name));
    if (RESERVED_SLUGS.has(slug)) throw new UserError("That URL slug is reserved. Choose another.", { slug: "Reserved" });
    const price = Number(rest.price);
    if (rest.salePrice !== null && Number(rest.salePrice) >= price) throw new UserError("The discounted price must be lower than the selling price.", { salePrice: "Must be lower than the price" });
    if (rest.status === "PUBLISHED" && price <= 0 && !variants.some((v) => (v.price ?? 0) > 0)) throw new UserError("Set a price before publishing.", { price: "Required to publish" });
    const combos = new Set<string>();
    for (const v of variants) {
      const key = JSON.stringify(Object.entries(v.options).sort());
      if (combos.has(key)) throw new UserError(`Two variants have the same options (${optionsLabel(v.options)}).`);
      combos.add(key);
      if (v.price !== null && v.salePrice !== null && v.salePrice >= v.price) throw new UserError(`${optionsLabel(v.options)}: the discounted price must be lower than its price.`);
    }
    const productSku = String(rest.sku);
    const skus = variants.map((v, i) => v.sku || `${productSku}-${Object.values(v.options).join("-").toUpperCase().replace(/[^A-Z0-9]+/g, "-")}` || `${productSku}-${i + 1}`);
    if (new Set(skus).size !== skus.length) throw new UserError("Each variant needs its own SKU.");
    const actor = await currentUser();
    const previous = id ? await prisma.product.findUnique({ where: { id }, select: { status: true, publishedAt: true } }) : null;
    const data = {
      ...rest,
      slug,
      publishedAt: rest.status === "PUBLISHED" ? (previous?.publishedAt ?? new Date()) : (previous?.publishedAt ?? null),
      archivedAt: rest.status === "ARCHIVED" ? new Date() : null,
    } as Prisma.ProductUncheckedCreateInput;

    return prisma.$transaction(
      async (tx) => {
        const product = id ? await tx.product.update({ where: { id }, data }) : await tx.product.create({ data });
        await tx.productImage.deleteMany({ where: { productId: product.id } });
        if (images.length) await tx.productImage.createMany({ data: images.map((img, position) => ({ productId: product.id, url: img.url, alt: img.alt || null, position })) });

        const existing = await tx.productVariant.findMany({ where: { productId: product.id }, include: { _count: { select: { orderItems: true } } } });
        const retire = async (v: (typeof existing)[number]) => {
          if (v._count.orderItems || v.stockReserved > 0) await tx.productVariant.update({ where: { id: v.id }, data: { active: false } });
          else await tx.productVariant.delete({ where: { id: v.id } });
        };
        const setStock = async (variantId: string, current: number, wanted: number, isNew: boolean) => {
          if (wanted !== current) await adjustStock(tx, variantId, wanted - current, { reason: isNew ? "Opening stock (product form)" : "Stock set on product form", actorId: actor?.id ?? null, type: isNew ? "INITIAL" : "ADJUSTMENT" });
        };

        if (!variants.length) {
          let base = existing.find((v) => v.isDefault);
          if (!base) base = { ...(await tx.productVariant.create({ data: { productId: product.id, sku: productSku, name: "Default", options: {}, isDefault: true } })), _count: { orderItems: 0 } };
          else await tx.productVariant.update({ where: { id: base.id }, data: { sku: productSku, active: true } });
          await setStock(base.id, base.stockOnHand, stock, base.stockOnHand === 0 && !id);
          for (const v of existing.filter((x) => !x.isDefault && x.active)) await retire(v);
        } else {
          // Free up SKUs first so variants can swap codes without hitting the unique index.
          for (const v of existing) await tx.productVariant.update({ where: { id: v.id }, data: { sku: `${v.sku}~${v.id.slice(-6)}` } });
          const kept = new Set<string>();
          for (const [position, row] of variants.entries()) {
            const match = row.id ? existing.find((v) => v.id === row.id && !v.isDefault) : undefined;
            const values = { sku: skus[position], name: optionsLabel(row.options), options: row.options, price: row.price, salePrice: row.salePrice, active: !row.hidden, position };
            if (match) {
              kept.add(match.id);
              await tx.productVariant.update({ where: { id: match.id }, data: values });
              await setStock(match.id, match.stockOnHand, row.stock, false);
            } else {
              const created = await tx.productVariant.create({ data: { ...values, productId: product.id } });
              kept.add(created.id);
              await setStock(created.id, 0, row.stock, true);
            }
          }
          for (const v of existing.filter((x) => !kept.has(x.id))) {
            // Retired variants kept for order history get their code back unless a current variant now uses it.
            if (!(await tx.productVariant.findUnique({ where: { sku: v.sku } }))) await tx.productVariant.update({ where: { id: v.id }, data: { sku: v.sku } });
            await retire(v);
          }
        }
        return product.id;
      },
      { timeout: 30_000 },
    );
  },
  async remove(id) {
    const sold = await prisma.shopOrderItem.count({ where: { productId: id } });
    if (sold) {
      await prisma.product.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date(), featured: false } });
      return "archived";
    }
    if (await prisma.productVariant.count({ where: { productId: id, stockReserved: { gt: 0 } } })) throw new UserError("This product is held by unpaid orders. Archive it instead.");
    await prisma.product.delete({ where: { id } });
    return "deleted";
  },
  removeLabel: "Delete product",
  publicHref: (v) => (v.slug && v.status === "PUBLISHED" ? `/shop/${v.slug}` : null),
};

// ─── Categories ───────────────────────────────────────────────────────────

export const productCategories: Resource = {
  key: "product-categories",
  title: "Product categories",
  singular: "category",
  group: "Shop",
  permission: "shop.products",
  description: "Group products in the storefront. Hidden categories hide their products too.",
  columns: ["Category", "Products", "Visible"],
  fields: async () => [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "slug", label: "Slug", type: "slug" },
    { name: "description", label: "Description", type: "textarea", span: 2 },
    { name: "imageUrl", label: "Image", type: "image", span: 2 },
    { name: "position", label: "Sort order", type: "number" },
    { name: "visible", label: "Visible", type: "switch" },
  ],
  async list(q, page) {
    const where: Prisma.ProductCategoryWhereInput = q ? { name: ci(q) } : {};
    const [rows, total] = await Promise.all([prisma.productCategory.findMany({ where, orderBy: { position: "asc" }, ...skip(page), include: { _count: { select: { products: { where: { archivedAt: null } } } } } }), prisma.productCategory.count({ where })]);
    return { total, rows: rows.map((c) => ({ id: c.id, cells: [c.name, String(c._count.products), { text: c.visible ? "VISIBLE" : "HIDDEN", badge: true }] })) };
  },
  defaults: async () => ({ visible: true, position: (await prisma.productCategory.count()) * 10 }),
  load: (id) => prisma.productCategory.findUnique({ where: { id } }),
  schema: () => z.object({ name: f.text(80), slug: f.slug(), description: f.optText(1000), imageUrl: f.url(), position: f.int(-10000, 10000), visible: f.bool() }),
  async save(id, raw) {
    const data = { ...raw, slug: ensureSlug(String(raw.slug), String(raw.name)) } as Prisma.ProductCategoryUncheckedCreateInput;
    return (id ? await prisma.productCategory.update({ where: { id }, data }) : await prisma.productCategory.create({ data })).id;
  },
  async remove(id) {
    if (await prisma.product.count({ where: { categoryId: id } })) throw new UserError("Move this category's products to another category first, or hide it.");
    await prisma.productCategory.delete({ where: { id } });
    return "deleted";
  },
  move: async (id, dir) => {
    const current = await prisma.productCategory.findUnique({ where: { id } });
    if (!current) return;
    const neighbour = await prisma.productCategory.findFirst({ where: { position: dir === -1 ? { lt: current.position } : { gt: current.position } }, orderBy: { position: dir === -1 ? "desc" : "asc" } });
    if (!neighbour) return;
    await prisma.$transaction([prisma.productCategory.update({ where: { id: current.id }, data: { position: neighbour.position } }), prisma.productCategory.update({ where: { id: neighbour.id }, data: { position: current.position } })]);
  },
};

// ─── Attributes (Size, Colour, Material, Design…) ─────────────────────────

export const productAttributes: Resource = {
  key: "product-attributes",
  title: "Attributes & sizes",
  singular: "attribute",
  group: "Shop",
  permission: "shop.products",
  description: "Variant options such as Size (S–XXL), Colour, Material or Design. Each becomes a column in the product variant table.",
  columns: ["Attribute", "Values"],
  fields: async () => [
    { name: "name", label: "Attribute name", type: "text", required: true, placeholder: "Size" },
    { name: "position", label: "Sort order", type: "number" },
    { name: "values", label: "Values", type: "repeater", span: 2, help: "In display order. Colour values can have a hex swatch such as #019C98.", fields: [{ name: "value", label: "Value", type: "text" }, { name: "colorHex", label: "Swatch (optional)", type: "text" }] },
  ],
  async list(q, page) {
    const where: Prisma.ProductAttributeWhereInput = q ? { name: ci(q) } : {};
    const [rows, total] = await Promise.all([prisma.productAttribute.findMany({ where, orderBy: { position: "asc" }, ...skip(page), include: { values: { orderBy: { position: "asc" } } } }), prisma.productAttribute.count({ where })]);
    return { total, rows: rows.map((a) => ({ id: a.id, cells: [a.name, { text: a.values.map((v) => v.value).join(", ") || "—", muted: true }] })) };
  },
  defaults: async () => ({ position: (await prisma.productAttribute.count()) * 10, values: [] }),
  async load(id) {
    const a = await prisma.productAttribute.findUnique({ where: { id }, include: { values: { orderBy: { position: "asc" } } } });
    return a ? { ...a, values: a.values.map((v) => ({ value: v.value, colorHex: v.colorHex ?? "" })) } : null;
  },
  schema: () =>
    z.object({
      name: z.string().trim().min(1, "Required").max(40).refine((v) => !v.includes(":"), "No colons, please"),
      position: f.int(-10000, 10000),
      values: f.json(z.object({ value: z.string().trim().min(1, "Every row needs a value").max(40), colorHex: z.union([z.literal(""), z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Swatches look like #019C98")]).optional() })),
    }),
  async save(id, raw) {
    const { values, ...data } = raw as { values: { value: string; colorHex?: string }[]; name: string; position: number };
    if (new Set(values.map((v) => v.value.toLowerCase())).size !== values.length) throw new UserError("Each value can only be listed once.");
    const previous = id ? await prisma.productAttribute.findUnique({ where: { id } }) : null;
    return prisma.$transaction(async (tx) => {
      const attr = id ? await tx.productAttribute.update({ where: { id }, data }) : await tx.productAttribute.create({ data });
      await tx.productAttributeValue.deleteMany({ where: { attributeId: attr.id } });
      await tx.productAttributeValue.createMany({ data: values.map((v, position) => ({ attributeId: attr.id, value: v.value, colorHex: v.colorHex || null, position })) });
      // Keep existing variants in step when an attribute is renamed.
      if (previous && previous.name !== attr.name) {
        await tx.$executeRaw`UPDATE "ProductVariant" SET "options" = ("options" - ${previous.name}) || jsonb_build_object(${attr.name}::text, "options"->>${previous.name}) WHERE "options" ? ${previous.name}`;
      }
      return attr.id;
    });
  },
  async remove(id) {
    const attr = await prisma.productAttribute.findUnique({ where: { id } });
    if (!attr) return "deleted";
    const used = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "ProductVariant" WHERE "active" = true AND "options" ? ${attr.name}`;
    if (Number(used[0]?.n ?? 0)) throw new UserError("Products still use this attribute. Remove it from their variants first.");
    await prisma.productAttribute.delete({ where: { id } });
    return "deleted";
  },
};

// ─── Delivery & collection options ────────────────────────────────────────

export const deliveryOptions: Resource = {
  key: "delivery-options",
  title: "Delivery & collection",
  singular: "option",
  group: "Shop",
  permission: "shop.products",
  description: "What customers can choose at checkout: pick-up points and delivery zones with their fees.",
  columns: ["Option", "Type", "Fee", "Areas", "Active"],
  fields: async () => [
    { name: "name", label: "Name", type: "text", required: true, placeholder: "Nairobi delivery" },
    { name: "method", label: "Type", type: "select", options: [{ value: "COLLECTION", label: "Customer collects (pick-up)" }, { value: "DELIVERY", label: "We deliver" }] },
    { name: "description", label: "Description", type: "text", span: 2, help: "Address of the pick-up point, courier used, etc." },
    { name: "fee", label: "Fee", type: "money", help: "0 = free" },
    { name: "freeAbove", label: "Free when the order reaches", type: "money", help: "Optional, after discounts." },
    { name: "estimatedTime", label: "Estimated time", type: "text", placeholder: "1–3 working days" },
    { name: "position", label: "Sort order", type: "number" },
    { name: "counties", label: "Counties served (delivery)", type: "multiselect", options: KENYA_COUNTIES.map((c): Option => ({ value: c, label: c })), help: "None selected = all of Kenya." },
    { name: "active", label: "Offered at checkout", type: "switch" },
  ],
  async list(q, page) {
    const where: Prisma.DeliveryOptionWhereInput = q ? { name: ci(q) } : {};
    const [rows, total, { currency }] = await Promise.all([prisma.deliveryOption.findMany({ where, orderBy: { position: "asc" }, ...skip(page) }), prisma.deliveryOption.count({ where }), getSettings("general")]);
    return { total, rows: rows.map((o) => ({ id: o.id, cells: [o.name, o.method === "COLLECTION" ? "Pick-up" : "Delivery", { text: o.fee.isZero() ? "Free" : formatMoney(o.fee, currency), mono: true }, o.method === "COLLECTION" ? "—" : o.counties.length ? `${o.counties.length} counties` : "All of Kenya", { text: o.active ? "ACTIVE" : "INACTIVE", badge: true }] })) };
  },
  defaults: async () => ({ method: "COLLECTION", fee: "0", active: true, position: (await prisma.deliveryOption.count()) * 10, counties: [] }),
  async load(id) {
    const o = await prisma.deliveryOption.findUnique({ where: { id } });
    return o ? { ...o, fee: decimalString(o.fee), freeAbove: decimalString(o.freeAbove) } : null;
  },
  schema: () => z.object({ name: f.text(80), method: f.enumOf(["COLLECTION", "DELIVERY"]), description: f.optText(300), fee: f.money(), freeAbove: f.optMoney(), estimatedTime: f.optText(60), position: f.int(-10000, 10000), counties: f.ids().refine((v) => v.every((c) => (KENYA_COUNTIES as readonly string[]).includes(c)), "Unknown county"), active: f.bool() }),
  async save(id, raw) {
    const data = { ...raw, counties: raw.method === "COLLECTION" ? [] : raw.counties } as Prisma.DeliveryOptionUncheckedCreateInput;
    return (id ? await prisma.deliveryOption.update({ where: { id }, data }) : await prisma.deliveryOption.create({ data })).id;
  },
  async remove(id) {
    if (await prisma.shopOrder.count({ where: { deliveryOptionId: id } })) {
      await prisma.deliveryOption.update({ where: { id }, data: { active: false } });
      return "archived";
    }
    await prisma.deliveryOption.delete({ where: { id } });
    return "deleted";
  },
};

// ─── Discount codes ───────────────────────────────────────────────────────

export const discountCodes: Resource = {
  key: "discount-codes",
  title: "Discount codes",
  singular: "discount code",
  group: "Shop",
  permission: "shop.products",
  description: "Promotional codes customers enter at checkout. Discounts apply to merchandise, not delivery, and are validated on the server.",
  columns: ["Code", "Discount", "Used", "Valid", "Active"],
  fields: async () => [
    { name: "code", label: "Code", type: "text", required: true, placeholder: "BACK2SCHOOL" },
    { name: "description", label: "Internal note", type: "text" },
    { name: "type", label: "Type", type: "select", options: [{ value: "PERCENT", label: "Percentage off" }, { value: "FIXED", label: "Fixed amount off" }] },
    { name: "value", label: "Value", type: "money", required: true, help: "Percent (1–100) or amount." },
    { name: "minSubtotal", label: "Minimum spend", type: "money" },
    { name: "maxUses", label: "Total uses allowed", type: "number", help: "Blank = unlimited" },
    { name: "perCustomerLimit", label: "Uses per customer (by email)", type: "number" },
    { name: "startsAt", label: "Starts", type: "datetime" },
    { name: "endsAt", label: "Ends", type: "datetime" },
    { name: "active", label: "Active", type: "switch" },
  ],
  async list(q, page) {
    const where: Prisma.DiscountCodeWhereInput = q ? { code: ci(q) } : {};
    const [rows, total, { currency, timezone }] = await Promise.all([prisma.discountCode.findMany({ where, orderBy: { createdAt: "desc" }, ...skip(page) }), prisma.discountCode.count({ where }), getSettings("general")]);
    return { total, rows: rows.map((d) => ({ id: d.id, cells: [d.code, d.type === "PERCENT" ? `${d.value.toNumber()}%` : formatMoney(d.value, currency), `${d.usesCount}${d.maxUses ? ` / ${d.maxUses}` : ""}`, d.endsAt ? `until ${formatDate(d.endsAt, timezone)}` : "No end date", { text: d.active ? "ACTIVE" : "INACTIVE", badge: true }] })) };
  },
  defaults: async () => ({ type: "PERCENT", active: true }),
  async load(id, ctx) {
    const d = await prisma.discountCode.findUnique({ where: { id } });
    return d ? { ...d, value: decimalString(d.value), minSubtotal: decimalString(d.minSubtotal), maxUses: d.maxUses ?? "", perCustomerLimit: d.perCustomerLimit ?? "", startsAt: toLocalInput(d.startsAt, ctx.tz), endsAt: toLocalInput(d.endsAt, ctx.tz) } : null;
  },
  schema: (ctx) =>
    z
      .object({
        code: z.string().trim().toUpperCase().min(3, "At least 3 characters").max(40).regex(/^[A-Z0-9_-]+$/, "Letters, numbers, dash and underscore only"),
        description: f.optText(200),
        type: f.enumOf(["PERCENT", "FIXED"]),
        value: z.coerce.number({ message: "Enter a value" }).positive("Must be more than 0").max(10_000_000),
        minSubtotal: f.optMoney(),
        maxUses: f.optInt(1, 1_000_000),
        perCustomerLimit: f.optInt(1, 1000),
        startsAt: f.optDatetime(ctx.tz),
        endsAt: f.optDatetime(ctx.tz),
        active: f.bool(),
      })
      .refine((d) => d.type !== "PERCENT" || d.value <= 100, { message: "A percentage can't exceed 100", path: ["value"] })
      .refine((d) => !d.startsAt || !d.endsAt || d.endsAt > d.startsAt, { message: "The end must be after the start", path: ["endsAt"] }),
  async save(id, raw) {
    const data = raw as Prisma.DiscountCodeUncheckedCreateInput;
    return (id ? await prisma.discountCode.update({ where: { id }, data }) : await prisma.discountCode.create({ data })).id;
  },
  async remove(id) {
    if (await prisma.shopOrder.count({ where: { discountCodeId: id } })) {
      await prisma.discountCode.update({ where: { id }, data: { active: false } });
      return "archived";
    }
    await prisma.discountCode.delete({ where: { id } });
    return "deleted";
  },
};

export const SHOP_RESOURCES = [products, productCategories, productAttributes, deliveryOptions, discountCodes];

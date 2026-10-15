import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { available, discountPercent, parseOptions, priceOf } from "@/lib/shop";
import { thresholdFor } from "./inventory";

/** Customers only ever see published products in visible categories. */
export const publicProductWhere = (): Prisma.ProductWhereInput => ({ status: "PUBLISHED", archivedAt: null, category: { visible: true } });

const cardInclude = {
  category: { select: { name: true, slug: true } },
  images: { orderBy: { position: "asc" }, take: 2 },
  variants: { where: { active: true }, orderBy: { position: "asc" } },
} satisfies Prisma.ProductInclude;
type CardRow = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

export type ProductCardData = {
  id: string;
  slug: string;
  name: string;
  category: string;
  categorySlug: string;
  image: string | null;
  hoverImage: string | null;
  price: number;
  regularPrice: number;
  priceFrom: boolean;
  discount: number;
  currency: string;
  inStock: boolean;
  lowStock: boolean;
  featured: boolean;
  options: number;
  createdAt: Date;
  position: number;
};

function toCard(p: CardRow, lowThreshold: number): ProductCardData {
  const priced = p.variants.map((v) => ({ v, ...priceOf(p, v) }));
  const cheapest = priced.reduce<(typeof priced)[number] | null>((a, b) => (!a || b.effective < a.effective ? b : a), null) ?? { ...priceOf(p), v: null };
  const stock = p.variants.reduce((sum, v) => sum + available(v), 0);
  const low = p.variants.some((v) => available(v) > 0 && available(v) <= thresholdFor(v, p, lowThreshold));
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category.name,
    categorySlug: p.category.slug,
    image: p.images[0]?.url ?? null,
    hoverImage: p.images[1]?.url ?? null,
    price: cheapest.effective,
    regularPrice: cheapest.regular,
    priceFrom: new Set(priced.map((x) => x.effective)).size > 1,
    discount: discountPercent(cheapest.regular, cheapest.effective),
    currency: p.currency,
    inStock: stock > 0,
    lowStock: stock > 0 && low,
    featured: p.featured,
    options: p.variants.filter((v) => Object.keys(parseOptions(v.options)).length).length,
    createdAt: p.createdAt,
    position: p.position,
  };
}

export const SORTS = { featured: "Featured", newest: "Newest", "price-asc": "Price: low to high", "price-desc": "Price: high to low", name: "Name A–Z" } as const;
export type Sort = keyof typeof SORTS;

export async function shopCategories() {
  return prisma.productCategory.findMany({
    where: { visible: true, products: { some: publicProductWhere() } },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: { where: publicProductWhere() } } } },
  });
}

/** Storefront listing with search, category filter, stock filter and sorting. */
export async function listProducts(input: { q?: string; category?: string; sort?: string; inStock?: boolean; page?: number; pageSize?: number }) {
  const shop = await getSettings("shop");
  const q = input.q?.trim().slice(0, 80);
  const where: Prisma.ProductWhereInput = {
    ...publicProductWhere(),
    ...(input.category ? { category: { slug: input.category, visible: true } } : {}),
    ...(q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { shortDescription: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { productType: { contains: q, mode: "insensitive" } }, { category: { name: { contains: q, mode: "insensitive" } } }] }
      : {}),
  };
  const rows = await prisma.product.findMany({ where, include: cardInclude, take: 1000 });
  let cards = rows.map((r) => toCard(r, shop.lowStockThreshold));
  if (input.inStock) cards = cards.filter((c) => c.inStock);
  const sort = (input.sort && input.sort in SORTS ? input.sort : "featured") as Sort;
  const byName = (a: ProductCardData, b: ProductCardData) => a.name.localeCompare(b.name);
  cards.sort((a, b) => {
    switch (sort) {
      case "newest": return b.createdAt.getTime() - a.createdAt.getTime();
      case "price-asc": return a.price - b.price || byName(a, b);
      case "price-desc": return b.price - a.price || byName(a, b);
      case "name": return byName(a, b);
      default: return Number(b.featured) - Number(a.featured) || Number(b.inStock) - Number(a.inStock) || a.position - b.position || byName(a, b);
    }
  });
  const pageSize = input.pageSize ?? 24;
  const page = Math.max(1, input.page ?? 1);
  return { total: cards.length, page, pageSize, sort, products: cards.slice((page - 1) * pageSize, page * pageSize) };
}

export async function featuredProducts(take = 8) {
  const shop = await getSettings("shop");
  const rows = await prisma.product.findMany({ where: { ...publicProductWhere(), featured: true }, include: cardInclude, orderBy: [{ position: "asc" }, { createdAt: "desc" }], take });
  return rows.map((r) => toCard(r, shop.lowStockThreshold));
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof productBySlug>>>;

/** Full product page data, including the attribute matrix the variant picker needs. */
export async function productBySlug(slug: string) {
  const p = await prisma.product.findFirst({
    where: { slug, ...publicProductWhere() },
    include: { category: true, images: { orderBy: { position: "asc" } }, variants: { where: { active: true }, orderBy: { position: "asc" } } },
  });
  if (!p) return null;
  const shop = await getSettings("shop");
  const attributeRows = await prisma.productAttribute.findMany({ orderBy: { position: "asc" }, include: { values: { orderBy: { position: "asc" } } } });
  const variants = p.variants.map((v) => {
    const price = priceOf(p, v);
    const left = available(v);
    return { id: v.id, sku: v.sku, options: parseOptions(v.options), price: price.effective, regularPrice: price.regular, available: left, low: left > 0 && left <= thresholdFor(v, p, shop.lowStockThreshold) };
  });
  // Attributes in admin order, values in admin order, limited to what this product offers.
  const used = new Map<string, Set<string>>();
  for (const v of variants) for (const [k, val] of Object.entries(v.options)) used.set(k, (used.get(k) ?? new Set()).add(val));
  const attributes = [...used.entries()]
    .map(([name, values]) => {
      const def = attributeRows.find((a) => a.name === name);
      const ordered = def ? def.values.filter((x) => values.has(x.value)).map((x) => ({ value: x.value, colorHex: x.colorHex })) : [];
      for (const value of values) if (!ordered.some((o) => o.value === value)) ordered.push({ value, colorHex: null });
      return { name, position: def?.position ?? 999, values: ordered };
    })
    .sort((a, b) => a.position - b.position);
  return { product: p, variants, attributes, maxQuantity: shop.maxQuantityPerItem };
}

export async function relatedProducts(product: { id: string; categoryId: string }, take = 4) {
  const shop = await getSettings("shop");
  const same = await prisma.product.findMany({ where: { ...publicProductWhere(), categoryId: product.categoryId, id: { not: product.id } }, include: cardInclude, orderBy: [{ featured: "desc" }, { position: "asc" }], take });
  const more = same.length < take ? await prisma.product.findMany({ where: { ...publicProductWhere(), id: { notIn: [product.id, ...same.map((s) => s.id)] } }, include: cardInclude, orderBy: [{ featured: "desc" }, { position: "asc" }], take: take - same.length }) : [];
  return [...same, ...more].map((r) => toCard(r, shop.lowStockThreshold));
}

/** Whether the storefront has anything to show (used to hide the nav link on an empty shop). */
export async function shopIsLive() {
  const shop = await getSettings("shop");
  if (!shop.enabled) return false;
  return (await prisma.product.count({ where: publicProductWhere() })) > 0;
}

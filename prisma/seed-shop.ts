/**
 * Starting shop catalogue: categories, variant attributes, pick-up / delivery
 * options and the club's own products (photos in /gallery/minichesphotos,
 * prices from the club's posters). Everything is created only when missing, so
 * re-running never overwrites what admins have edited.
 *
 *   npm run db:seed:shop                 (new variants start with 0 stock)
 *   SHOP_SEED_STOCK=10 npm run db:seed:shop
 *
 * Products without a known price are created as drafts.
 */
import { PrismaClient, type Prisma } from "@prisma/client";

const IMG = "/gallery/minichesphotos";

const CATEGORIES = [
  { name: "Chess sets & boards", slug: "chess-sets-boards", description: "Tournament roll-up sets, wooden boards and everything to play." },
  { name: "Chess tables", slug: "chess-tables", description: "Tables with built-in boards for homes, schools and clubs." },
  { name: "Bags & backpacks", slug: "bags-backpacks", description: "Carry your set, clock and scoresheets in style." },
  { name: "Hoodies & sweaters", slug: "hoodies-sweaters", description: "Warm club gear for long tournament days." },
  { name: "T-shirts & apparel", slug: "t-shirts-apparel", description: "Branded tees and apparel." },
  { name: "Chess clocks", slug: "chess-clocks", description: "Digital clocks for rapid, blitz and classical play." },
  { name: "Books & learning", slug: "books-learning", description: "Books, demonstration boards and training materials." },
  { name: "Accessories", slug: "accessories", description: "Spare pieces, scoresheets, medals and more." },
  { name: "Other merchandise", slug: "other-merchandise", description: "Everything else from the club." },
];

const ATTRIBUTES = [
  { name: "Size", values: ["S", "M", "L", "XL", "XXL"].map((value) => ({ value })) },
  {
    name: "Colour",
    values: [
      { value: "Black", colorHex: "#151515" },
      { value: "Blue", colorHex: "#2349b5" },
      { value: "Green", colorHex: "#1f7a4a" },
      { value: "Brown", colorHex: "#7a4a2b" },
      { value: "Pink", colorHex: "#e46aa3" },
      { value: "White", colorHex: "#ffffff" },
      { value: "Teal", colorHex: "#019c98" },
    ],
  },
  { name: "Material", values: ["Vinyl", "Rubber", "Wood", "Plastic", "Cotton"].map((value) => ({ value })) },
];

const DELIVERY = [
  { name: "Pick up — Nairobi CBD", method: "COLLECTION" as const, description: "Collect from our Nairobi CBD pick-up point. We'll confirm the exact place and time when your order is ready.", fee: 0, active: true, position: 0 },
  { name: "Countrywide delivery", method: "DELIVERY" as const, description: "Courier delivery anywhere in Kenya.", fee: 0, active: false, position: 10 },
];

type SeedProduct = {
  sku: string;
  slug: string;
  name: string;
  category: string;
  productType: string;
  shortDescription: string;
  description: string;
  price: number;
  status: "PUBLISHED" | "DRAFT";
  featured?: boolean;
  images: { file: string; alt: string }[];
  /** One variant per value of this attribute (e.g. board colours). */
  variants?: { attribute: string; values: string[] };
  position: number;
};

const SET_SPECS = "- Board: 51 × 51 cm, roll-up\n- Pieces: tournament size, king height 3.75\"\n- Two queens per side (\"polygamous\" set) for pawn promotions";

const PRODUCTS: SeedProduct[] = [
  {
    sku: "MC-RUBBER-SET-BAG",
    slug: "tournament-rubber-chess-set-bag",
    name: "Tournament Rubber Chess Set + Bag",
    category: "chess-sets-boards",
    productType: "Tournament set",
    shortDescription: "Roll-up rubber tournament board, full-size pieces and a large carry bag.",
    description: `The complete tournament kit: a #Chess254 rubber board that rolls up and lies flat, weighted tournament-size pieces and a large drawstring bag.\n\n${SET_SPECS}\n- Large bag fits two chess sets and a clock\n\nGreat for school chess clubs, tournaments and back-to-school.`,
    price: 1349,
    status: "PUBLISHED",
    featured: true,
    images: [
      { file: "rubber-board-blue-in-play.jpeg", alt: "Blue rubber board in play with a chess clock" },
      { file: "poster-rubber-set-bag.jpeg", alt: "Tournament rubber chess set with bag" },
      { file: "rubber-board-black-wood.jpeg", alt: "Black and wood-print rubber board" },
    ],
    variants: { attribute: "Colour", values: ["Blue", "Green", "Black"] },
    position: 0,
  },
  {
    sku: "MC-VINYL-SET-BAG",
    slug: "tournament-vinyl-chess-set-bag",
    name: "Tournament Vinyl Chess Set + Bag",
    category: "chess-sets-boards",
    productType: "Combo offer",
    shortDescription: "Vinyl tournament board, full-size pieces and a padded carry bag.",
    description: `Our combo offer: a roll-up vinyl tournament board with tournament-size pieces and a carry bag.\n\n${SET_SPECS}\n- Zipped carry bag with shoulder strap`,
    price: 1249,
    status: "PUBLISHED",
    featured: true,
    images: [
      { file: "vinyl-set-chess254-bag.jpeg", alt: "Vinyl board set up with pieces and pouch" },
      { file: "poster-vinyl-set-bag.jpeg", alt: "Tournament vinyl chess set with bag" },
      { file: "chess254-tournament-pouch.jpeg", alt: "Chess254 tournament-size pouch" },
      { file: "vinyl-board-rolled-pouch.jpeg", alt: "Vinyl board rolled in its pouch" },
    ],
    variants: { attribute: "Colour", values: ["Black", "Blue", "Brown", "Green", "Pink"] },
    position: 1,
  },
  {
    sku: "MC-RUBBER-SET",
    slug: "tournament-rubber-chess-set",
    name: "Tournament Rubber Chess Set",
    category: "chess-sets-boards",
    productType: "Tournament set",
    shortDescription: "Roll-up rubber tournament board with full-size pieces.",
    description: `A durable rubber board that rolls up and lies perfectly flat, with tournament-size pieces.\n\n${SET_SPECS}`,
    price: 1300,
    status: "PUBLISHED",
    images: [
      { file: "rubber-board-walnut.jpeg", alt: "Walnut-print rubber chess board with pieces" },
      { file: "rubber-board-rosewood.jpeg", alt: "Rosewood-print rubber chess board" },
      { file: "rubber-board-black-wood.jpeg", alt: "Black and wood-print rubber chess board" },
    ],
    position: 2,
  },
  {
    sku: "MC-VINYL-SET",
    slug: "tournament-vinyl-chess-set",
    name: "Tournament Vinyl Chess Set",
    category: "chess-sets-boards",
    productType: "Tournament set",
    shortDescription: "Roll-up vinyl tournament board with full-size pieces.",
    description: `The classic club and school set: a roll-up vinyl board with tournament-size pieces.\n\n${SET_SPECS}`,
    price: 999,
    status: "PUBLISHED",
    images: [
      { file: "vinyl-board-rolled-pouch.jpeg", alt: "Vinyl chess board in its pouch" },
      { file: "chess254-tournament-pouch.jpeg", alt: "Chess254 tournament-size pouch" },
    ],
    position: 3,
  },
  {
    sku: "MC-VINYL-MEDIUM",
    slug: "medium-vinyl-chess-set",
    name: "Medium Vinyl Chess Set",
    category: "chess-sets-boards",
    productType: "Starter set",
    shortDescription: "A smaller roll-up vinyl set — ideal for beginners and young players.",
    description: "A compact roll-up vinyl chess set for home practice and beginners.",
    price: 750,
    status: "PUBLISHED",
    images: [],
    position: 4,
  },
  {
    sku: "MC-WOOD-FOLDING",
    slug: "wooden-folding-chess-set",
    name: "Wooden Folding Chess Set",
    category: "chess-sets-boards",
    productType: "Wooden set",
    shortDescription: "Walnut and maple folding board with hand-turned wooden pieces stored inside.",
    description: "A beautiful folding board in walnut and maple inlay. The hand-turned Staunton-style wooden pieces store in the velvet-lined case.",
    price: 0,
    status: "DRAFT",
    images: [
      { file: "wooden-set-closeup.jpeg", alt: "Wooden chess pieces on a walnut and maple board" },
      { file: "wooden-set-case-open.jpeg", alt: "Wooden chess pieces stored in the case" },
      { file: "wooden-set-folding-side.jpeg", alt: "Folding wooden board, side view" },
    ],
    position: 5,
  },
  {
    sku: "MC-DEMO-BOARD",
    slug: "demonstration-wall-chess-board",
    name: "Demonstration Wall Chess Board",
    category: "books-learning",
    productType: "Teaching aid",
    shortDescription: "Hanging demonstration board for classrooms and coaching sessions.",
    description: "A roll-up demonstration board that hangs on a wall or door, with slot-in pieces for showing positions to a whole group.",
    price: 0,
    status: "DRAFT",
    images: [{ file: "demonstration-wall-board.jpeg", alt: "Demonstration chess board hanging on a door" }],
    position: 6,
  },
];

export async function seedShop(prisma: PrismaClient, opts: { stock?: number } = {}) {
  const stock = Math.max(0, Math.floor(opts.stock ?? Number(process.env.SHOP_SEED_STOCK ?? 0)) || 0);

  await prisma.siteSetting.upsert({
    where: { key: "shop" },
    create: { key: "shop", value: { enabled: true, title: "Shop", tagline: "for every player.", intro: "Tournament chess sets, boards and club gear. Pick up in Nairobi CBD or get it delivered countrywide.", reservationMinutes: 30, maxQuantityPerItem: 10, lowStockThreshold: 3, lowStockAlerts: true, heroImage: `${IMG}/wooden-set-closeup.jpeg` } },
    update: {},
  });

  for (const [i, c] of CATEGORIES.entries()) {
    await prisma.productCategory.upsert({ where: { slug: c.slug }, create: { ...c, position: i * 10 }, update: {} });
  }
  for (const [i, a] of ATTRIBUTES.entries()) {
    const existing = await prisma.productAttribute.findUnique({ where: { name: a.name } });
    if (existing) continue;
    await prisma.productAttribute.create({ data: { name: a.name, position: i * 10, values: { create: a.values.map((v, position) => ({ ...v, position })) } } });
  }
  if ((await prisma.deliveryOption.count()) === 0) {
    for (const d of DELIVERY) await prisma.deliveryOption.create({ data: { ...d, counties: [] } });
  }

  const cats = new Map((await prisma.productCategory.findMany()).map((c) => [c.slug, c.id]));
  for (const p of PRODUCTS) {
    const existing = await prisma.product.findFirst({ where: { OR: [{ sku: p.sku }, { slug: p.slug }] }, select: { id: true } });
    if (existing) {
      console.log(`Product "${p.name}" already exists — left unchanged.`);
      continue;
    }
    const variants: Prisma.ProductVariantCreateWithoutProductInput[] = p.variants
      ? p.variants.values.map((value, position) => ({ sku: `${p.sku}-${value.toUpperCase()}`, name: value, options: { [p.variants!.attribute]: value }, position, stockOnHand: p.status === "PUBLISHED" ? stock : 0 }))
      : [{ sku: p.sku, name: "Default", options: {}, isDefault: true, stockOnHand: p.status === "PUBLISHED" ? stock : 0 }];
    const created = await prisma.product.create({
      data: {
        sku: p.sku,
        slug: p.slug,
        name: p.name,
        categoryId: cats.get(p.category)!,
        productType: p.productType,
        shortDescription: p.shortDescription,
        description: p.description,
        price: p.price,
        currency: "KES",
        status: p.status,
        featured: p.featured ?? false,
        position: p.position,
        publishedAt: p.status === "PUBLISHED" ? new Date() : null,
        images: { create: p.images.map((img, position) => ({ url: `${IMG}/${img.file}`, alt: img.alt, position })) },
        variants: { create: variants },
      },
      include: { variants: true },
    });
    for (const v of created.variants) {
      if (v.stockOnHand > 0) await prisma.stockMovement.create({ data: { variantId: v.id, type: "INITIAL", quantity: v.stockOnHand, onHandAfter: v.stockOnHand, reservedAfter: 0, reason: "Opening stock (seed)" } });
    }
    console.log(`Created product "${created.name}" (${p.status.toLowerCase()}, ${created.variants.length} variant${created.variants.length === 1 ? "" : "s"}, stock ${p.status === "PUBLISHED" ? stock : 0} each).`);
  }
}

// Run directly: `tsx prisma/seed-shop.ts`
if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed-shop.ts")) {
  const prisma = new PrismaClient();
  seedShop(prisma)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

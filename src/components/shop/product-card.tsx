import Link from "next/link";
import { Img as Image } from "@/components/ui/img";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ProductCardProps = {
  slug: string;
  name: string;
  category: string;
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
};

export function Price({ price, regularPrice, currency, from, className, size = "md" }: { price: number; regularPrice: number; currency: string; from?: boolean; className?: string; size?: "md" | "lg" }) {
  const sale = price < regularPrice;
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2", className)}>
      {from && <span className="text-xs text-muted">From</span>}
      <span className={cn("font-display font-extrabold tracking-tight", size === "lg" ? "text-4xl sm:text-5xl" : "text-lg", sale && "text-brand-ink")}>{formatMoney(price, currency)}</span>
      {sale && <span className={cn("text-muted line-through", size === "lg" ? "text-lg" : "text-sm")}>{formatMoney(regularPrice, currency)}</span>}
    </div>
  );
}

/** Placeholder art when a product has no photo yet. */
export function ProductArt({ className }: { className?: string }) {
  return (
    <div className={cn("art-tile on-dark absolute inset-0 grid place-items-center", className)}>
      <span aria-hidden className="font-display text-[120px] leading-none text-white/[0.09]">♞</span>
    </div>
  );
}

export function ProductCard({ product, priority = false }: { product: ProductCardProps; priority?: boolean }) {
  const p = product;
  return (
    <Link href={`/shop/${p.slug}`} className="group flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-surface transition-all duration-500 hover:-translate-y-1 hover:border-border-strong hover:shadow-[0_24px_60px_-30px_var(--shadow-color)]">
      <div className="relative aspect-square overflow-hidden bg-white">
        {p.image ? (
          <>
            <Image src={p.image} alt={p.name} fill priority={priority} sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" className={cn("object-cover transition duration-700 group-hover:scale-[1.04]", p.hoverImage && "group-hover:opacity-0")} />
            {p.hoverImage && <Image src={p.hoverImage} alt="" fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" className="object-cover opacity-0 transition duration-700 group-hover:scale-[1.04] group-hover:opacity-100" />}
          </>
        ) : (
          <ProductArt />
        )}
        <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {p.discount > 0 && <Badge variant="solid">−{p.discount}%</Badge>}
          {p.featured && p.discount === 0 && <Badge className="bg-black/70 text-white backdrop-blur">Featured</Badge>}
        </div>
        {!p.inStock && <div className="absolute inset-x-0 bottom-0 bg-black/70 py-2 text-center text-xs font-bold uppercase tracking-widest text-white backdrop-blur">Sold out</div>}
      </div>
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="text-xs font-medium text-muted">{p.category}</div>
        <h3 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight group-hover:text-brand-ink sm:text-base">{p.name}</h3>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-3">
          <Price price={p.price} regularPrice={p.regularPrice} currency={p.currency} from={p.priceFrom} />
          {p.inStock && p.lowStock && <span className="text-[11px] font-semibold text-warning">Few left</span>}
          {p.inStock && !p.lowStock && p.options > 1 && <span className="text-[11px] text-muted">{p.options} options</span>}
        </div>
      </div>
    </Link>
  );
}

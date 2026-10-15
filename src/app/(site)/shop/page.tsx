import type { Metadata } from "next";
import Link from "next/link";
import { PackageSearch, ShieldCheck, Smartphone, Truck } from "lucide-react";
import { getAllSettings } from "@/server/settings";
import { seoFor } from "@/server/content";
import { featuredProducts, listProducts, shopCategories, SORTS } from "@/server/shop/catalog";
import { Container, HeroBackdrop } from "@/components/site/cards";
import { Reveal } from "@/components/site/reveal";
import { ProductCard } from "@/components/shop/product-card";
import { ShopControls } from "@/components/shop/shop-controls";
import { EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Img as Image } from "@/components/ui/img";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const [seo, settings] = await Promise.all([seoFor("/shop"), getAllSettings()]);
  return {
    title: seo?.title ?? settings.shop.title,
    description: seo?.description ?? (settings.shop.tagline || "Chess sets, boards, clocks, apparel and accessories — pay with M-Pesa."),
    alternates: { canonical: "/shop" },
  };
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; sort?: string; stock?: string; page?: string }> }) {
  const sp = await searchParams;
  const settings = await getAllSettings();
  const shop = settings.shop;
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const filtered = Boolean(q || sp.category || sp.stock || (sp.page && sp.page !== "1"));
  const [categories, result, featured] = await Promise.all([
    shopCategories(),
    listProducts({ q, category: sp.category, sort: sp.sort, inStock: sp.stock === "1", page: Number(sp.page) || 1 }),
    filtered ? Promise.resolve([]) : featuredProducts(4),
  ]);
  const active = categories.find((c) => c.slug === sp.category);
  const heroImage = shop.heroImage || featured[0]?.image || result.products.find((p) => p.image)?.image || null;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(Object.entries({ q, category: sp.category, sort: sp.sort, stock: sp.stock, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/shop${params.size ? `?${params}` : ""}`;
  };
  const chip = (on: boolean) => cn("flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition", on ? "border-brand bg-brand text-brand-foreground" : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground");

  return (
    <>
      <section className="relative overflow-hidden border-b border-border">
        <HeroBackdrop />
        <Container className="relative grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:py-20">
          <div>
            <div className="eyebrow mb-4 animate-fade-up">{settings.general.siteName} store</div>
            <h1 className="display animate-fade-up text-[clamp(2.6rem,7vw,5.4rem)] [animation-delay:80ms]">
              {shop.title} {shop.tagline && <span className="text-brand-ink">{shop.tagline}</span>}
            </h1>
            {shop.intro && <p className="mt-5 max-w-xl animate-fade-up text-lg leading-relaxed text-muted [animation-delay:160ms]">{shop.intro}</p>}
            <form role="search" action="/shop" className="mt-7 flex max-w-lg animate-fade-up gap-2 [animation-delay:220ms]">
              {sp.category && <input type="hidden" name="category" value={sp.category} />}
              <input name="q" defaultValue={q} placeholder="Search chess sets, boards, clocks…" aria-label="Search products" className="h-12 min-w-0 flex-1 rounded-full border border-border-strong bg-surface px-5 text-[15px] outline-none focus:border-brand" />
              <Button type="submit" size="lg" className="h-12">Search</Button>
            </form>
            <ul className="mt-7 flex animate-fade-up flex-wrap gap-x-5 gap-y-2 text-sm text-muted [animation-delay:280ms]">
              <li className="flex items-center gap-2"><Smartphone className="size-4 text-brand-ink" />Pay with M-Pesa</li>
              <li className="flex items-center gap-2"><Truck className="size-4 text-brand-ink" />Pick up or delivery</li>
              <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-brand-ink" />Payments verified with Safaricom</li>
            </ul>
          </div>
          {heroImage && (
            <div className="relative mx-auto hidden aspect-square w-full max-w-md animate-fade-up overflow-hidden rounded-[2.5rem] border border-border bg-white shadow-[0_40px_90px_-40px_var(--shadow-color)] [animation-delay:200ms] lg:block">
              <Image src={heroImage} alt="" fill priority sizes="448px" className="object-cover" />
            </div>
          )}
        </Container>
      </section>

      <Container className="py-10 sm:py-12">
        {!shop.enabled ? (
          <EmptyState icon={<PackageSearch />} title="The shop is closed for now" description="We're restocking. Please check back soon." />
        ) : (
          <>
            {categories.length > 0 && (
              <nav aria-label="Categories" className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1">
                <Link href={link({ category: undefined, page: undefined })} className={chip(!sp.category)}>All products</Link>
                {categories.map((c) => (
                  <Link key={c.id} href={link({ category: c.slug, page: undefined })} className={chip(sp.category === c.slug)} aria-current={sp.category === c.slug ? "page" : undefined}>
                    {c.name}<span className="text-xs opacity-70">{c._count.products}</span>
                  </Link>
                ))}
              </nav>
            )}

            {featured.length > 0 && result.total > featured.length + 4 && (
              <section className="mb-12">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Featured picks</h2>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
                  {featured.map((p, i) => <Reveal key={p.id} delay={i * 70}><ProductCard product={p} priority={i < 2} /></Reveal>)}
                </div>
              </section>
            )}

            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
                {q ? <>Results for “{q}”</> : active ? active.name : "All products"}
                <span className="ml-2 align-middle text-sm font-medium text-muted">{result.total}</span>
              </h2>
              <ShopControls sorts={SORTS} sort={result.sort} inStock={sp.stock === "1"} />
            </div>
            {active?.description && <p className="-mt-2 mb-6 max-w-2xl text-sm text-muted">{active.description}</p>}

            {result.products.length ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
                {result.products.map((p, i) => <Reveal key={p.id} delay={(i % 4) * 60}><ProductCard product={p} priority={i < 2} /></Reveal>)}
              </div>
            ) : (
              <EmptyState
                icon={<PackageSearch />}
                title={filtered ? "No products match" : "New merchandise is on its way"}
                description={filtered ? "Try another search or clear the filters." : "Chess sets, boards and club gear will appear here soon."}
                action={filtered ? <Button asChild variant="secondary"><Link href="/shop">Clear filters</Link></Button> : undefined}
              />
            )}

            {pages > 1 && (
              <nav aria-label="Pages" className="mt-10 flex items-center justify-center gap-2">
                {result.page > 1 && <Button asChild variant="secondary" size="sm"><Link href={link({ page: String(result.page - 1) })}>Previous</Link></Button>}
                <span className="px-3 text-sm text-muted">Page {result.page} of {pages}</span>
                {result.page < pages && <Button asChild variant="secondary" size="sm"><Link href={link({ page: String(result.page + 1) })}>Next</Link></Button>}
              </nav>
            )}
          </>
        )}
      </Container>
    </>
  );
}

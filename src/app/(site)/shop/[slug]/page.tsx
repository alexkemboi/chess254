import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight, ShieldCheck, Smartphone, Store, Truck } from "lucide-react";
import { getAllSettings, siteUrl } from "@/server/settings";
import { productBySlug, relatedProducts } from "@/server/shop/catalog";
import { activeDeliveryOptions } from "@/server/shop/checkout";
import { Container } from "@/components/site/cards";
import { ProductGallery } from "@/components/shop/product-gallery";
import { ProductPurchase } from "@/components/shop/product-purchase";
import { ProductCard } from "@/components/shop/product-card";
import { formatMoney } from "@/lib/format";
import { plainText, truncate } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const data = await productBySlug((await params).slug);
  if (!data) return { title: "Product not found" };
  const p = data.product;
  return {
    title: p.seoTitle || p.name,
    description: p.seoDescription || p.shortDescription || truncate(plainText(p.description), 160),
    alternates: { canonical: `/shop/${p.slug}` },
    openGraph: { images: p.images[0] ? [p.images[0].url] : undefined },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const data = await productBySlug((await params).slug);
  if (!data) notFound();
  const { product: p, variants, attributes, maxQuantity } = data;
  const [settings, related, options, base] = await Promise.all([getAllSettings(), relatedProducts(p), activeDeliveryOptions(), siteUrl()]);
  const collection = options.filter((o) => o.method === "COLLECTION");
  const delivery = options.filter((o) => o.method === "DELIVERY");
  const minPrice = Math.min(...variants.map((v) => v.price));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    sku: p.sku,
    description: p.shortDescription || truncate(plainText(p.description), 300),
    image: p.images.map((i) => (i.url.startsWith("http") ? i.url : `${base}${i.url}`)),
    category: p.category.name,
    offers: { "@type": "Offer", priceCurrency: p.currency, price: minPrice, availability: variants.some((v) => v.available > 0) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url: `${base}/shop/${p.slug}` },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Container className="py-6 sm:py-10">
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-1 text-sm text-muted">
          <Link href="/shop" className="hover:text-foreground">{settings.shop.title}</Link>
          <ChevronRight className="size-3.5" />
          <Link href={`/shop?category=${p.category.slug}`} className="hover:text-foreground">{p.category.name}</Link>
          <ChevronRight className="size-3.5" />
          <span className="truncate text-foreground">{p.name}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
          <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <ProductGallery images={p.images.map((i) => ({ url: i.url, alt: i.alt }))} name={p.name} />
          </div>
          <div className="min-w-0">
            <div className="eyebrow">{p.productType || p.category.name}</div>
            <h1 className="mt-2 font-display text-[clamp(2rem,5vw,3.2rem)] font-extrabold leading-[1.02] tracking-tight">{p.name}</h1>
            {p.shortDescription && <p className="mt-4 text-lg leading-relaxed text-muted">{p.shortDescription}</p>}
            <div className="mt-7">
              <ProductPurchase variants={variants} attributes={attributes} currency={p.currency} maxQuantity={maxQuantity} />
            </div>

            <ul className="mt-8 grid gap-3 rounded-3xl border border-border bg-surface p-5 text-sm">
              {collection.length > 0 && (
                <li className="flex gap-3">
                  <Store className="mt-0.5 size-5 shrink-0 text-brand-ink" />
                  <div><div className="font-semibold">Pick up {collection.every((o) => o.fee.isZero()) ? "free" : ""}</div><div className="text-muted">{collection.map((o) => o.name).join(" · ")}</div></div>
                </li>
              )}
              {delivery.length > 0 && (
                <li className="flex gap-3">
                  <Truck className="mt-0.5 size-5 shrink-0 text-brand-ink" />
                  <div>
                    <div className="font-semibold">Delivery</div>
                    <div className="text-muted">{delivery.map((o) => `${o.name}: ${o.fee.isZero() ? "free" : formatMoney(o.fee, p.currency)}${o.freeAbove ? ` (free over ${formatMoney(o.freeAbove, p.currency)})` : ""}${o.estimatedTime ? ` · ${o.estimatedTime}` : ""}`).join(" · ")}</div>
                  </div>
                </li>
              )}
              <li className="flex gap-3"><Smartphone className="mt-0.5 size-5 shrink-0 text-brand-ink" /><div><div className="font-semibold">Pay with M-Pesa</div><div className="text-muted">Guest checkout — no account needed.</div></div></li>
              <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-ink" /><div><div className="font-semibold">Verified payments</div><div className="text-muted">Your order is confirmed only after Safaricom confirms the payment.</div></div></li>
            </ul>

            <section className="mt-10 border-t border-border pt-8">
              <h2 className="mb-4 font-display text-2xl font-extrabold tracking-tight">Details</h2>
              <div className="prose-chess"><ReactMarkdown remarkPlugins={[remarkGfm]}>{p.description}</ReactMarkdown></div>
            </section>
            {settings.shop.returnsPolicy && (
              <details className="mt-6 rounded-2xl border border-border bg-surface p-5 text-sm">
                <summary className="cursor-pointer font-semibold">Delivery &amp; returns</summary>
                <p className="mt-3 whitespace-pre-line leading-relaxed text-muted">{settings.shop.returnsPolicy}</p>
              </details>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-16 border-t border-border pt-12 sm:mt-24">
            <h2 className="mb-6 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">You may also like</h2>
            <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
              {related.map((r) => <ProductCard key={r.id} product={r} />)}
            </div>
          </section>
        )}
      </Container>
    </>
  );
}

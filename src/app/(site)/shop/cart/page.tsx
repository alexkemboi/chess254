import Link from "next/link";
import { ArrowRight, ShieldCheck, ShoppingBag } from "lucide-react";
import { cartView } from "@/server/shop/cart";
import { cookieCart } from "@/server/shop/session";
import { featuredProducts } from "@/server/shop/catalog";
import { Container } from "@/components/site/cards";
import { CartLines } from "@/components/shop/cart-lines";
import { ProductCard } from "@/components/shop/product-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { formatMoney } from "@/lib/format";

export const metadata = { title: "Your cart", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CartPage() {
  const cart = await cookieCart();
  const view = await cartView(cart?.id);
  const suggestions = view.lines.length ? [] : await featuredProducts(4);

  return (
    <Container className="py-10 sm:py-14">
      <div className="mb-8 flex items-end justify-between gap-4">
        <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Your cart</h1>
        <Link href="/shop" className="text-sm font-semibold text-brand-ink hover:underline">Continue shopping</Link>
      </div>
      {view.lines.length === 0 ? (
        <>
          <EmptyState icon={<ShoppingBag />} title="Your cart is empty" description="Find a chess set, board or club gear you love." action={<Button asChild><Link href="/shop">Browse the shop</Link></Button>} />
          {suggestions.length > 0 && (
            <section className="mt-12">
              <h2 className="mb-5 font-display text-2xl font-extrabold tracking-tight">Popular right now</h2>
              <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">{suggestions.map((p) => <ProductCard key={p.id} product={p} />)}</div>
            </section>
          )}
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
          <CartLines lines={view.lines} currency={view.currency} />
          <aside className="rounded-3xl border border-border bg-surface p-6 lg:sticky lg:top-24">
            <h2 className="font-display text-xl font-extrabold tracking-tight">Order summary</h2>
            <dl className="mt-5 grid gap-2.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Items ({view.count})</dt><dd className="font-mono">{formatMoney(view.subtotal, view.currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd className="text-muted">Chosen at checkout</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Discount code</dt><dd className="text-muted">Add at checkout</dd></div>
              <div className="mt-2 flex justify-between border-t border-border pt-4 text-lg font-bold"><dt>Subtotal</dt><dd className="font-mono">{formatMoney(view.subtotal, view.currency)}</dd></div>
            </dl>
            {view.hasIssues && <p className="mt-4 rounded-xl bg-danger/10 p-3 text-sm text-danger">Some items need your attention before checkout.</p>}
            {view.hasIssues ? (
              <Button size="lg" className="mt-6 w-full" disabled>Checkout<ArrowRight /></Button>
            ) : (
              <Button asChild size="lg" className="mt-6 w-full"><Link href="/shop/checkout">Checkout<ArrowRight /></Link></Button>
            )}
            <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted"><ShieldCheck className="size-3.5 text-brand-ink" />Secure M-Pesa payment · guest checkout</p>
          </aside>
        </div>
      )}
    </Container>
  );
}

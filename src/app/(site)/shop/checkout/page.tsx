import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { randomToken } from "@/server/crypto";
import { getSettings } from "@/server/settings";
import { cartView } from "@/server/shop/cart";
import { cookieCart } from "@/server/shop/session";
import { activeDeliveryOptions } from "@/server/shop/checkout";
import { Container } from "@/components/site/cards";
import { CheckoutForm } from "@/components/shop/checkout-form";
import { EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { KENYA_COUNTIES } from "@/lib/kenya";

export const metadata = { title: "Checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const cart = await cookieCart();
  const view = await cartView(cart?.id);
  if (!view.lines.length || view.hasIssues) redirect("/shop/cart");
  const [user, options, shop] = await Promise.all([currentUser(), activeDeliveryOptions(), getSettings("shop")]);

  return (
    <Container className="py-10 sm:py-14">
      <Link href="/shop/cart" className="text-sm text-muted hover:text-foreground">← Back to cart</Link>
      <h1 className="mb-8 mt-3 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Checkout</h1>
      {!shop.enabled ? (
        <EmptyState title="The shop is closed right now" description="Please check back soon." action={<Button asChild><Link href="/shop">Back to the shop</Link></Button>} />
      ) : (
        <CheckoutForm
          lines={view.lines}
          currency={view.currency}
          subtotal={view.subtotal}
          counties={KENYA_COUNTIES}
          checkoutKey={randomToken(18)}
          defaults={{ name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "" }}
          options={options.map((o) => ({ id: o.id, name: o.name, method: o.method, description: o.description, fee: o.fee.toNumber(), freeAbove: o.freeAbove?.toNumber() ?? null, counties: o.counties, estimatedTime: o.estimatedTime }))}
        />
      )}
    </Container>
  );
}

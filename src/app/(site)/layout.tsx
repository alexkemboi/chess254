import { getSiteChrome } from "@/server/content";
import { currentUser } from "@/server/auth";
import { can } from "@/server/rbac";
import { prisma } from "@/server/db";
import { Header, type NavUser } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { Logo } from "@/components/site/logo";
import { AnnouncementBar } from "@/components/site/announcement-bar";
import { cartCount } from "@/server/shop/cart";
import { cookieCart } from "@/server/shop/session";
import { shopIsLive } from "@/server/shop/catalog";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [chrome, user, shopLive, cart] = await Promise.all([getSiteChrome(), currentUser(), shopIsLive(), cookieCart()]);
  const shop = { live: shopLive, cartCount: await cartCount(cart?.id) };
  let navUser: NavUser = null;
  if (user) {
    const [unread, canAdmin, coach] = await Promise.all([
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      can(user.role, "admin.access"),
      prisma.coachProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
    ]);
    navUser = { name: user.name, email: user.email, unread, canAdmin, isCoach: Boolean(coach) };
  }
  const { brand, general } = chrome.settings;
  const logo = <Logo text={brand.logoText} accent={brand.logoAccent} fallback={general.siteName} />;
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-brand-foreground">Skip to content</a>
      <AnnouncementBar items={chrome.announcements.map((a) => ({ id: a.id, title: a.title, body: a.body, linkLabel: a.linkLabel, linkUrl: a.linkUrl }))} />
      <Header logo={logo} user={navUser} shop={shop} />
      <main id="main">{children}</main>
      <Footer chrome={chrome} logo={logo} />
    </>
  );
}

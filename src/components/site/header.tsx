"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DropdownMenu, Dialog as D } from "radix-ui";
import { Bell, ChevronDown, LayoutDashboard, LogOut, Menu, Search, Shield, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SheetContent } from "@/components/ui/dialog";
import { cn, initials } from "@/lib/utils";
import { logoutAction } from "@/actions/auth";
import { ThemeToggle } from "@/components/theme";

export const NAV = [
  { href: "/memberships", label: "Memberships" },
  { href: "/coaches", label: "Coaches" },
  { href: "/events", label: "Events" },
  { href: "/learn", label: "Academy" },
  { href: "/puzzles", label: "Puzzles" },
  { href: "/community", label: "Community" },
  { href: "/gallery", label: "Gallery" },
];

export type NavUser = { name: string; email: string; unread: number; canAdmin: boolean; isCoach: boolean } | null;

export function Header({ logo, user }: { logo: React.ReactNode; user: NavUser }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const iconBtn = "grid size-10 place-items-center rounded-full text-muted transition hover:bg-foreground/[0.07] hover:text-foreground";

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-4">
      <div
        className={cn(
          "mx-auto flex h-16 max-w-7xl items-center gap-2 rounded-full sm:gap-3 border pl-3 pr-3 backdrop-blur-xl transition-all duration-300 sm:pl-4",
          scrolled
            ? "border-border-strong bg-surface/85 shadow-[0_14px_40px_-14px_var(--shadow-color)]"
            : "border-border bg-surface/60 shadow-[0_6px_24px_-16px_var(--shadow-color)]",
        )}
      >
        <div className="shrink-0">{logo}</div>
        <nav className="hidden flex-1 items-center justify-center xl:flex" aria-label="Main">
          <div className="flex items-center gap-0.5 rounded-full p-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active(item.href) ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13.5px] font-medium tracking-[-0.005em] transition-all duration-200",
                  active(item.href) ? "bg-foreground/[0.08] text-foreground" : "text-muted hover:bg-foreground/[0.05] hover:text-foreground",
                )}
              >
                {active(item.href) && <span className="size-1.5 rounded-full bg-brand" aria-hidden />}
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
        <div className="ml-auto flex items-center gap-1 xl:ml-0">
          <Link href="/search" className={cn(iconBtn, "hidden sm:grid")} aria-label="Search">
            <Search className="size-[18px]" />
          </Link>
          <ThemeToggle className="hidden sm:grid" />
          {user ? (
            <>
              <Link href="/dashboard/notifications" className={cn(iconBtn, "relative")} aria-label={`Notifications${user.unread ? ` (${user.unread} unread)` : ""}`}>
                <Bell className="size-[18px]" />
                {user.unread > 0 && <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-brand-foreground">{user.unread > 9 ? "9+" : user.unread}</span>}
              </Link>
              <UserMenu user={user} />
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm" className="ml-1 h-10 shrink-0 px-5">
                <Link href="/register"><span className="min-[380px]:hidden">Join</span><span className="max-[379px]:hidden">Join the club</span></Link>
              </Button>
            </>
          )}
          <D.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <D.Trigger asChild>
              <Button variant="ghost" size="icon" className="xl:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </D.Trigger>
            <SheetContent title="Menu">
              <div className="mb-8">{logo}</div>
              <nav className="flex flex-col gap-1" aria-label="Mobile">
                {[...NAV, { href: "/book", label: "Book a session" }, { href: "/search", label: "Search" }, { href: "/contact", label: "Contact" }].map((item, i) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={active(item.href) ? "page" : undefined}
                    style={{ animationDelay: `${i * 35}ms` }}
                    className={cn("animate-fade-up rounded-xl px-3 py-3 font-display text-2xl font-bold tracking-tight", active(item.href) ? "bg-brand-soft text-brand-ink" : "hover:bg-foreground/5")}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-6 flex items-center justify-between rounded-2xl border border-border px-4 py-2">
                <span className="text-sm font-medium text-muted">Appearance</span>
                <ThemeToggle />
              </div>
              <div className="mt-auto grid gap-2 pt-8">
                {user ? (
                  <>
                    <Button asChild variant="secondary"><Link href="/dashboard" onClick={() => setMenuOpen(false)}>My dashboard</Link></Button>
                    <form action={logoutAction}><Button variant="ghost" className="w-full">Sign out</Button></form>
                  </>
                ) : (
                  <>
                    <Button asChild><Link href="/register" onClick={() => setMenuOpen(false)}>Join the club</Link></Button>
                    <Button asChild variant="secondary"><Link href="/login" onClick={() => setMenuOpen(false)}>Sign in</Link></Button>
                  </>
                )}
              </div>
            </SheetContent>
          </D.Root>
        </div>
      </div>
    </header>
  );
}

function UserMenu({ user }: { user: NonNullable<NavUser> }) {
  const item = "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground/90 outline-none data-[highlighted]:bg-foreground/6 [&_svg]:size-4 [&_svg]:text-muted";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-1.5 rounded-full border border-border p-1 pr-2 hover:border-border-strong" aria-label="Account menu">
        <span className="grid size-8 place-items-center rounded-full bg-brand text-xs font-bold text-brand-foreground">{initials(user.name)}</span>
        <ChevronDown className="size-3.5 text-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-60 rounded-2xl border border-border bg-surface p-1.5 shadow-2xl">
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-semibold">{user.name}</div>
            <div className="truncate text-xs text-muted">{user.email}</div>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild><Link href="/dashboard" className={item}><LayoutDashboard />Dashboard</Link></DropdownMenu.Item>
          <DropdownMenu.Item asChild><Link href="/book" className={item}><Sparkles />Book a session</Link></DropdownMenu.Item>
          <DropdownMenu.Item asChild><Link href="/dashboard/profile" className={item}><User />Profile</Link></DropdownMenu.Item>
          {user.isCoach && <DropdownMenu.Item asChild><Link href="/coach" className={item}><Sparkles />Coach workspace</Link></DropdownMenu.Item>}
          {user.canAdmin && <DropdownMenu.Item asChild><Link href="/admin" className={item}><Shield />Admin portal</Link></DropdownMenu.Item>}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <form action={logoutAction}>
            <button className={cn(item, "w-full hover:bg-foreground/6")}><LogOut />Sign out</button>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

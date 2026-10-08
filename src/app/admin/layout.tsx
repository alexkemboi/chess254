import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireUser } from "@/server/auth";
import { navFor } from "@/server/admin/nav";
import { getAllSettings } from "@/server/settings";
import { AdminMobileNav, AdminSidebar } from "@/components/admin/admin-nav";
import { Logo } from "@/components/site/logo";
import { logoutAction } from "@/actions/auth";
import { humanize } from "@/lib/format";

export const metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/admin");
  const groups = await navFor(user.role);
  if (groups.length === 0) redirect("/forbidden");
  const { brand, general } = await getAllSettings();
  const header = (
    <div className="flex items-center justify-between gap-2">
      <Logo text={brand.logoText} accent={brand.logoAccent} fallback={general.siteName} />
      <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">Admin</span>
    </div>
  );
  const footer = (
    <div className="flex items-center justify-between gap-2 text-sm">
      <div className="min-w-0"><div className="truncate font-semibold">{user.name}</div><div className="text-xs text-muted">{humanize(user.role)}</div></div>
      <form action={logoutAction}><button className="text-xs text-muted hover:text-foreground">Sign out</button></form>
    </div>
  );
  return (
    <div className="flex min-h-dvh">
      <AdminSidebar groups={groups} header={header} footer={footer} />
      <div className="min-w-0 flex-1">
        <header className="glass sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border px-4 sm:px-6">
          <AdminMobileNav groups={groups} header={header} />
          <span className="text-sm text-muted lg:hidden">Admin</span>
          <Link href="/" className="ml-auto flex items-center gap-1.5 text-sm text-muted hover:text-foreground">View site <ExternalLink className="size-3.5" /></Link>
          <Link href="/dashboard" className="text-sm text-muted hover:text-foreground">My dashboard</Link>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

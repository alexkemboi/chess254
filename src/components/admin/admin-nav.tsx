"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { Circle, Menu, BadgeDollarSign, BarChart3, Bell, BookOpen, CalendarCheck, CalendarDays, ClipboardList, Clock, CreditCard, Crown, Flag, FolderTree, GraduationCap, HelpCircle, History, Images, Inbox, LayoutDashboard, LayoutTemplate, MapPin, Megaphone, Puzzle, Quote, Receipt, ScanLine, Search, Settings, Share2, ShieldCheck, Smartphone, Tags, Ticket, Users } from "lucide-react";

import { SheetContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { BadgeDollarSign, BarChart3, Bell, BookOpen, CalendarCheck, CalendarDays, ClipboardList, Clock, CreditCard, Crown, Flag, FolderTree, GraduationCap, HelpCircle, History, Images, Inbox, LayoutDashboard, LayoutTemplate, MapPin, Megaphone, Puzzle, Quote, Receipt, ScanLine, Search, Settings, Share2, ShieldCheck, Smartphone, Tags, Ticket, Users };

type Group = { label: string; items: { href: string; label: string; icon: string }[] };

function NavList({ groups, onNavigate }: { groups: Group[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav className="grid gap-6" aria-label="Admin">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-2">{g.label}</div>
          <div className="grid gap-0.5">
            {g.items.map((item) => {
              const Icon = ICONS[item.icon] ?? Circle;
              return (
                <Link key={item.href} href={item.href} onClick={onNavigate} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition", active(item.href) ? "bg-brand-soft text-brand" : "text-muted hover:bg-white/5 hover:text-foreground")}>
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AdminSidebar({ groups, header, footer }: { groups: Group[]; header: React.ReactNode; footer: React.ReactNode }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-surface/60 lg:flex">
      <div className="px-5 py-5">{header}</div>
      <div className="no-scrollbar flex-1 overflow-y-auto px-2 pb-6"><NavList groups={groups} /></div>
      <div className="border-t border-border p-4">{footer}</div>
    </aside>
  );
}

export function AdminMobileNav({ groups, header }: { groups: Group[]; header: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger className="grid size-10 place-items-center rounded-full hover:bg-white/5 lg:hidden" aria-label="Open admin menu"><Menu className="size-5" /></D.Trigger>
      <SheetContent title="Admin menu" side="left">
        <div className="mb-6">{header}</div>
        <NavList groups={groups} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </D.Root>
  );
}

import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { getAllSettings, SETTINGS_GROUPS, type SettingsGroup } from "@/server/settings";
import { SETTINGS_FORMS } from "@/server/admin/settings-fields";
import { PageHeader } from "@/components/ui/misc";
import { SettingsForm } from "@/components/admin/settings-form";
import { cn } from "@/lib/utils";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  await requirePermission("settings.manage", "/admin/settings");
  const { group: raw } = await searchParams;
  const group: SettingsGroup = SETTINGS_GROUPS.includes(raw as SettingsGroup) ? (raw as SettingsGroup) : "general";
  const settings = await getAllSettings();
  const form = SETTINGS_FORMS[group];
  return (
    <div>
      <PageHeader title="Settings" description="Club configuration stored in the database. Changes take effect immediately across the site." />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
          {SETTINGS_GROUPS.map((g) => (
            <Link key={g} href={`/admin/settings?group=${g}`} className={cn("whitespace-nowrap rounded-lg px-3 py-2 text-sm", g === group ? "bg-brand-soft text-brand-ink" : "text-muted hover:bg-foreground/5 hover:text-foreground")}>{SETTINGS_FORMS[g].title}</Link>
          ))}
          <Link href="/admin/manage/locations" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted hover:bg-foreground/5">Locations & hours →</Link>
          <Link href="/admin/payment-settings" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted hover:bg-foreground/5">M-Pesa →</Link>
        </nav>
        <div className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
          <h2 className="font-display text-2xl font-bold">{form.title}</h2>
          <p className="mb-6 mt-1 text-sm text-muted">{form.description}</p>
          <SettingsForm key={group} group={group} fields={form.fields} values={settings[group] as Record<string, unknown>} />
        </div>
      </div>
    </div>
  );
}

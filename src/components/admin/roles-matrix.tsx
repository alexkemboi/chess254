"use client";
import { Fragment } from "react";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { saveRolePermissionsAction } from "@/actions/admin";

const ROLES = ["ADMIN", "COACH", "MODERATOR", "MEMBER"] as const;

export function RolesMatrix({ permissions, granted }: { permissions: { key: string; group: string; description: string }[]; granted: string[] }) {
  const set = new Set(granted);
  const groups = [...new Set(permissions.map((p) => p.group))];
  return (
    <ActionForm action={saveRolePermissionsAction} confirm="Update permissions for all users with these roles?" className="grid gap-4">
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
            <tr><th className="px-4 py-3 text-left">Permission</th><th className="px-3 py-3">Super admin</th>{ROLES.map((r) => <th key={r} className="px-3 py-3">{r.toLowerCase()}</th>)}</tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g}>
                <tr className="bg-surface-2/50"><td colSpan={6} className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-brand-ink">{g}</td></tr>
                {permissions.filter((p) => p.group === g).map((p) => (
                  <tr key={p.key} className="border-b border-border/60">
                    <td className="px-4 py-2.5"><div className="font-mono text-xs">{p.key}</div><div className="text-xs text-muted">{p.description}</div></td>
                    <td className="text-center"><input type="checkbox" checked disabled className="size-4 accent-[var(--brand)]" aria-label={`Super admin ${p.key}`} /></td>
                    {ROLES.map((r) => (
                      <td key={r} className="text-center"><input type="checkbox" name={`${r}:${p.key}`} defaultChecked={set.has(`${r}:${p.key}`)} className="size-4 accent-[var(--brand)]" aria-label={`${r} ${p.key}`} /></td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div><SubmitButton>Save permissions</SubmitButton></div>
    </ActionForm>
  );
}

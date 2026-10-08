import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { PERMISSION_CATALOGUE, PERMISSIONS } from "@/server/rbac";
import { PageHeader } from "@/components/ui/misc";
import { RolesMatrix } from "@/components/admin/roles-matrix";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  await requirePermission("roles.manage", "/admin/roles");
  const rows = await prisma.rolePermission.findMany({ include: { permission: true } });
  const granted = rows.map((r) => `${r.role}:${r.permission.key}`);
  const counts = await prisma.user.groupBy({ by: ["role"], _count: { _all: true }, where: { deletedAt: null } });
  return (
    <div>
      <PageHeader title="Roles & permissions" description="What each role can do. Every Server Action and API route checks these on the server. Super admins always hold every permission." />
      <div className="mb-6 flex flex-wrap gap-2 text-sm text-muted">
        {counts.map((c) => <span key={c.role} className="rounded-full border border-border px-3 py-1">{c.role.toLowerCase().replace("_", " ")}: {c._count._all}</span>)}
      </div>
      <RolesMatrix
        granted={granted}
        permissions={PERMISSIONS.map((key) => ({ key, group: PERMISSION_CATALOGUE[key].group, description: PERMISSION_CATALOGUE[key].description }))}
      />
    </div>
  );
}

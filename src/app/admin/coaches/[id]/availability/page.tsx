import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { primaryLocation } from "@/server/content";
import { PageHeader } from "@/components/ui/misc";
import { AdminAvailabilityEditor } from "@/components/admin/admin-availability";

export const metadata = { title: "Coach availability" };

export default async function AdminCoachAvailability({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("coaches.manage", `/admin/coaches/${id}/availability`);
  const coach = await prisma.coachProfile.findUnique({ where: { id }, include: { user: { select: { name: true } }, availability: { orderBy: [{ weekday: "asc" }, { startTime: "asc" }] } } });
  if (!coach) notFound();
  const location = await primaryLocation();
  return (
    <div className="max-w-3xl">
      <Link href={`/admin/manage/coaches/${coach.id}`} className="text-sm text-muted hover:text-foreground">← {coach.user.name}</Link>
      <div className="mt-4"><PageHeader title={`${coach.user.name}'s availability`} description="Weekly bookable hours. Coaches can also edit this themselves in their workspace." /></div>
      <AdminAvailabilityEditor coachId={coach.id} initial={coach.availability.map((a) => ({ weekday: a.weekday, startTime: a.startTime, endTime: a.endTime }))} hours={location?.openingHours ?? []} />
    </div>
  );
}

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui/misc";
import { ProfileForm, PasswordForm } from "@/components/site/profile-forms";

export default async function ProfilePage() {
  const user = await requireUser("/dashboard/profile");
  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { memberProfile: true } });
  const p = record.memberProfile;
  return (
    <div className="grid gap-8">
      <PageHeader eyebrow="Account" title="Profile" description={record.email} />
      <section className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
        <h2 className="mb-6 font-display text-xl font-bold">Your details</h2>
        <ProfileForm defaults={{ name: record.name, phone: record.phone ?? "", bio: p?.bio ?? "", chessLevel: p?.chessLevel ?? "", rating: p?.rating?.toString() ?? "", lichessUsername: p?.lichessUsername ?? "", chesscomUsername: p?.chesscomUsername ?? "" }} />
      </section>
      <section className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
        <h2 className="mb-6 font-display text-xl font-bold">Change password</h2>
        <PasswordForm />
      </section>
    </div>
  );
}

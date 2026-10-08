import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, ExternalLink } from "lucide-react";
import { requirePermission } from "@/server/auth";
import { RESOURCES, resourceContext } from "@/server/admin/resources";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { DeleteResource, ResourceEditor } from "@/components/admin/resource-ui";

export async function generateMetadata({ params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  const r = RESOURCES[resource];
  return { title: r ? `${id === "new" ? "New" : "Edit"} ${r.singular}` : "Admin" };
}

export default async function ResourceEdit({ params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  const r = RESOURCES[resource];
  if (!r) notFound();
  await requirePermission(r.permission, `/admin/manage/${resource}/${id}`);
  const ctx = await resourceContext();
  const isNew = id === "new";
  const values = isNew ? (await r.defaults?.(ctx)) ?? {} : await r.load(id, ctx);
  if (!values) notFound();
  const fields = await r.fields(ctx);
  const href = !isNew ? r.publicHref?.(values) : null;
  return (
    <div className="max-w-4xl">
      <Link href={`/admin/manage/${resource}`} className="text-sm text-muted hover:text-foreground">← {r.title}</Link>
      <div className="mt-4">
        <PageHeader
          title={isNew ? `New ${r.singular}` : String(values.name ?? values.title ?? values.question ?? values.key ?? values.path ?? `Edit ${r.singular}`)}
          actions={
            <>
              {resource === "coaches" && !isNew && <Button asChild variant="secondary" size="sm"><Link href={`/admin/coaches/${id}/availability`}><CalendarClock />Availability</Link></Button>}
              {resource === "events" && !isNew && <Button asChild variant="secondary" size="sm"><Link href={`/admin/registrations?event=${id}`}>Registrations</Link></Button>}
              {href && <Button asChild variant="secondary" size="sm"><Link href={href} target="_blank"><ExternalLink />View</Link></Button>}
              {!isNew && r.remove && <DeleteResource resource={resource} id={id} label={r.removeLabel ?? "Delete"} />}
            </>
          }
        />
      </div>
      <div className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
        <ResourceEditor resource={resource} id={isNew ? null : id} fields={fields} values={values} />
      </div>
    </div>
  );
}

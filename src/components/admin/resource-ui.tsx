"use client";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { deleteResourceAction, moveResourceAction, saveResourceAction } from "@/actions/admin-resources";
import { ResourceForm } from "./resource-form";
import type { FieldDef, FormValues } from "@/lib/fields";

export function ResourceEditor({ resource, id, fields, values }: { resource: string; id: string | null; fields: FieldDef[]; values: FormValues }) {
  return <ResourceForm fields={fields} values={values} isNew={!id} action={(fd) => saveResourceAction(resource, id, fd)} submitLabel={id ? "Save changes" : "Create"} />;
}

export function DeleteResource({ resource, id, label }: { resource: string; id: string; label: string }) {
  return (
    <ActionForm action={() => deleteResourceAction(resource, id)} confirm={`${label}? This can't be undone.`}>
      <SubmitButton variant="danger" size="sm"><Trash2 />{label}</SubmitButton>
    </ActionForm>
  );
}

export function MoveButtons({ resource, id }: { resource: string; id: string }) {
  const router = useRouter();
  const move = async (dir: -1 | 1) => {
    const res = await moveResourceAction(resource, id, dir);
    if (res.ok) router.refresh();
    else toast.error(res.error);
  };
  return (
    <span className="inline-flex">
      <Button variant="ghost" size="icon-sm" onClick={() => move(-1)} aria-label="Move up"><ArrowUp /></Button>
      <Button variant="ghost" size="icon-sm" onClick={() => move(1)} aria-label="Move down"><ArrowDown /></Button>
    </span>
  );
}

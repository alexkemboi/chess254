"use client";
import { ResourceForm } from "./resource-form";
import { saveSettingsAction } from "@/actions/admin";
import type { FieldDef } from "@/lib/fields";

export function SettingsForm({ group, fields, values }: { group: string; fields: FieldDef[]; values: Record<string, unknown> }) {
  return <ResourceForm fields={fields} values={values} isNew={false} action={(fd) => saveSettingsAction(group, fd)} submitLabel="Save settings" />;
}

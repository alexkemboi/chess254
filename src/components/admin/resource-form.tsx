"use client";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Eye, FileUp, Loader2, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import type { FieldDef, FormValues } from "@/lib/fields";
import type { ActionResult } from "@/lib/action";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { uploadAction } from "@/actions/admin-resources";
import { cn } from "@/lib/utils";

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function ResourceForm({ fields, values, action, isNew, submitLabel = "Save" }: { fields: FieldDef[]; values: FormValues; action: (fd: FormData) => Promise<ActionResult>; isNew: boolean; submitLabel?: string }) {
  const visible = fields.filter((f) => !(f.createOnly && !isNew));
  return (
    <ActionForm action={action} className="grid gap-6">
      <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
        {visible.map((field) => (
          <React.Fragment key={field.name}>
            {field.section && <h3 className="eyebrow col-span-full mt-4 border-t border-border pt-6 text-muted">{field.section}</h3>}
            <div className={cn(field.span === 2 || ["markdown", "repeater", "image", "multiselect"].includes(field.type) ? "sm:col-span-2" : "")}>
              <FieldInput field={field} value={values[field.name]} />
            </div>
          </React.Fragment>
        ))}
      </div>
      <div className="sticky bottom-0 z-10 -mx-1 flex gap-2 border-t border-border bg-surface/95 px-1 py-4 backdrop-blur">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function FieldInput({ field, value }: { field: FieldDef; value: unknown }) {
  const common = { id: field.name, name: field.name, placeholder: field.placeholder, required: field.required, readOnly: field.readOnly };
  let control: React.ReactNode;
  switch (field.type) {
    case "textarea":
      control = <Textarea {...common} defaultValue={str(value)} />;
      break;
    case "lines":
      control = <Textarea {...common} defaultValue={Array.isArray(value) ? value.join("\n") : str(value)} className="min-h-36" />;
      break;
    case "markdown":
      control = <MarkdownInput name={field.name} defaultValue={str(value)} required={field.required} />;
      break;
    case "number":
      control = <Input {...common} type="number" defaultValue={str(value)} step="1" />;
      break;
    case "money":
      control = <Input {...common} type="number" defaultValue={str(value)} step="0.01" min="0" inputMode="decimal" />;
      break;
    case "date":
      control = <Input {...common} type="date" defaultValue={str(value)} />;
      break;
    case "datetime":
      control = <Input {...common} type="datetime-local" defaultValue={str(value)} />;
      break;
    case "time":
      control = <Input {...common} type="time" defaultValue={str(value)} />;
      break;
    case "email":
      control = <Input {...common} type="email" defaultValue={str(value)} />;
      break;
    case "password":
      control = <Input {...common} type="password" autoComplete="new-password" defaultValue="" />;
      break;
    case "color":
      control = <ColorInput name={field.name} defaultValue={str(value) || "#00D8FF"} />;
      break;
    case "switch":
      return <div className="rounded-xl border border-border bg-surface-2/40 p-4"><Switch name={field.name} defaultChecked={value === true || value === "true"} label={field.label} description={field.help} /></div>;
    case "select":
      control = (
        <Select {...common} defaultValue={str(value)}>
          {!field.required && !field.options?.some((o) => o.value === "") && <option value="">—</option>}
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      );
      break;
    case "multiselect":
      control = <MultiSelect name={field.name} options={field.options ?? []} defaultValue={Array.isArray(value) ? (value as string[]) : []} />;
      break;
    case "image":
    case "file":
      control = <UploadInput name={field.name} kind={field.type === "image" ? "image" : "document"} defaultValue={str(value)} />;
      break;
    case "repeater":
      control = <Repeater field={field} defaultValue={Array.isArray(value) ? (value as Record<string, unknown>[]) : []} />;
      break;
    default:
      control = <Input {...common} type={field.type === "url" ? "text" : "text"} defaultValue={str(value)} />;
  }
  return (
    <Field name={field.name} label={`${field.label}${field.required ? " *" : ""}`} hint={field.help}>
      {control}
    </Field>
  );
}

function MarkdownInput({ name, defaultValue, required }: { name: string; defaultValue: string; required?: boolean }) {
  const [value, setValue] = React.useState(defaultValue);
  const [preview, setPreview] = React.useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-1.5 text-xs text-muted">
        <span>Markdown</span>
        <button type="button" onClick={() => setPreview(!preview)} className="flex items-center gap-1 hover:text-foreground">{preview ? <><Pencil className="size-3" />Edit</> : <><Eye className="size-3" />Preview</>}</button>
      </div>
      <textarea name={name} value={value} onChange={(e) => setValue(e.target.value)} required={required} className={cn("min-h-64 w-full bg-surface-2/40 p-4 font-mono text-sm outline-none", preview && "hidden")} />
      {preview && <div className="prose-chess min-h-64 p-5"><ReactMarkdown remarkPlugins={[remarkGfm]}>{value || "_Nothing yet_"}</ReactMarkdown></div>}
    </div>
  );
}

function ColorInput({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [value, setValue] = React.useState(defaultValue);
  return (
    <div className="flex items-center gap-3">
      <input type="color" value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} className="h-11 w-14 cursor-pointer rounded-xl border border-border bg-transparent" aria-label="Pick colour" />
      <Input name={name} value={value} onChange={(e) => setValue(e.target.value)} className="max-w-40 font-mono" />
      <span className="h-11 flex-1 rounded-xl" style={{ background: value }} />
    </div>
  );
}

function MultiSelect({ name, options, defaultValue }: { name: string; options: { value: string; label: string }[]; defaultValue: string[] }) {
  const [selected, setSelected] = React.useState(new Set(defaultValue));
  if (!options.length) return <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted">Nothing to choose yet.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {[...selected].map((v) => <input key={v} type="hidden" name={`${name}[]`} value={v} />)}
      <input type="hidden" name={`${name}[]`} value="" />
      {options.map((o) => {
        const on = selected.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => setSelected((s) => { const n = new Set(s); if (n.has(o.value)) n.delete(o.value); else n.add(o.value); return n; })}
            className={cn("rounded-full border px-3.5 py-1.5 text-sm transition", on ? "border-brand bg-brand-soft text-brand" : "border-border text-muted hover:text-foreground")}
            aria-pressed={on}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function UploadInput({ name, kind, defaultValue }: { name: string; kind: "image" | "document"; defaultValue: string }) {
  const [url, setUrl] = React.useState(defaultValue);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);
  async function upload(file: File) {
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    const res = await uploadAction(fd);
    setBusy(false);
    if (res.ok && res.data) {
      setUrl(res.data.url);
      toast.success("Uploaded");
    } else if (!res.ok) toast.error(res.error);
  }
  return (
    <div className="grid gap-3">
      {kind === "image" && url && (
        <div className="relative h-44 w-full max-w-sm overflow-hidden rounded-xl border border-border bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="size-full object-cover" />
          <button type="button" onClick={() => setUrl("")} className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5" aria-label="Remove image"><X className="size-4" /></button>
        </div>
      )}
      <div className="flex gap-2">
        <Input name={name} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={kind === "image" ? "/gallery/photo.jpg or upload" : "Upload a PDF / PGN"} className="font-mono text-xs" />
        <input ref={ref} type="file" hidden accept={kind === "image" ? "image/jpeg,image/png,image/webp,image/gif" : ".pdf,.pgn,application/pdf"} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button type="button" variant="secondary" onClick={() => ref.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : kind === "image" ? <Upload /> : <FileUp />}Upload
        </Button>
      </div>
    </div>
  );
}

function Repeater({ field, defaultValue }: { field: FieldDef; defaultValue: Record<string, unknown>[] }) {
  const [rows, setRows] = React.useState<Record<string, unknown>[]>(defaultValue);
  const subs = field.fields ?? [];
  const blank = () => Object.fromEntries(subs.map((s) => [s.name, s.type === "switch" ? false : s.options?.[0]?.value ?? ""]));
  const set = (i: number, key: string, v: unknown) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: v } : row)));
  return (
    <div className="grid gap-2">
      <input type="hidden" name={field.name} value={JSON.stringify(rows)} />
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-2/40 p-3">
          {subs.map((s) => (
            <label key={s.name} className="grid min-w-28 flex-1 gap-1 text-xs text-muted">
              {s.label}
              {s.type === "select" ? (
                <Select value={str(row[s.name])} onChange={(e) => set(i, s.name, e.target.value)} className="h-10">
                  {s.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : s.type === "switch" ? (
                <input type="checkbox" checked={row[s.name] === true || row[s.name] === "true"} onChange={(e) => set(i, s.name, e.target.checked)} className="size-5 accent-[var(--brand)]" />
              ) : (
                <Input value={str(row[s.name])} type={s.type === "time" ? "time" : s.type === "date" ? "date" : s.type === "number" ? "number" : "text"} onChange={(e) => set(i, s.name, e.target.value)} className="h-10" />
              )}
            </label>
          ))}
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label="Remove row"><Trash2 /></Button>
        </div>
      ))}
      <div><Button type="button" variant="secondary" size="sm" onClick={() => setRows((r) => [...r, blank()])}><Plus />Add</Button></div>
    </div>
  );
}

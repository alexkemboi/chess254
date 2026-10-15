import { z } from "zod";

/**
 * Event registration forms are data: each event stores its own list of fields
 * (Event.formFields). This module is shared by the admin form builder, the
 * public form renderer and the server-side validation.
 */
export const FORM_FIELD_TYPES = ["text", "textarea", "number", "email", "phone", "select", "checkboxes", "checkbox", "date", "sessions"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Roles map an answer onto the registration record (contact details, payment notes…). */
export const FORM_FIELD_ROLES = ["", "participantName", "contactName", "contactEmail", "contactPhone", "paymentMethod", "declaredPaid", "paymentReference"] as const;
export type FormFieldRole = (typeof FORM_FIELD_ROLES)[number];

export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: "Short text",
  textarea: "Paragraph",
  number: "Number",
  email: "Email",
  phone: "Phone",
  select: "Single choice",
  checkboxes: "Multiple choice",
  checkbox: "Tick box (consent)",
  date: "Date",
  sessions: "Session & package picker",
};

export const FORM_FIELD_ROLE_LABELS: Record<FormFieldRole, string> = {
  "": "—",
  participantName: "Participant name",
  contactName: "Contact name",
  contactEmail: "Contact email",
  contactPhone: "Contact phone",
  paymentMethod: "Payment method",
  declaredPaid: "Already paid? (Yes/No)",
  paymentReference: "Payment reference",
};

export const formFieldSchema = z.object({
  key: z.string().trim().max(60).regex(/^[a-z0-9_]*$/, "Keys use lowercase letters, numbers and _").default(""),
  label: z.string().trim().min(1, "Every field needs a label").max(400),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
  options: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  section: z.string().trim().max(120).default(""),
  /** Wizard step this question appears on. Blank = same step as the question before it. */
  step: z.string().trim().max(60).default(""),
  help: z.string().trim().max(600).default(""),
  /** "key=Value" or "key=A|B": only shown (and only required) when that answer matches. */
  showIf: z.string().trim().max(200).default(""),
  sensitive: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
  role: z.enum(FORM_FIELD_ROLES).default(""),
});
export type EventFormField = z.infer<typeof formFieldSchema>;

export function slugKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
}

/** Parses stored JSON leniently (bad rows are skipped) and guarantees unique keys. */
export function parseFormFields(value: unknown): EventFormField[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: EventFormField[] = [];
  for (const row of value) {
    const parsed = formFieldSchema.safeParse(row);
    if (!parsed.success) continue;
    let key = parsed.data.key || slugKey(parsed.data.label);
    for (let i = 2; seen.has(key); i++) key = `${parsed.data.key || slugKey(parsed.data.label)}_${i}`;
    seen.add(key);
    out.push({ ...parsed.data, key });
  }
  return out;
}

export type AnswerValue = string | string[] | boolean;
export type RawAnswers = Record<string, AnswerValue | undefined>;

export function isFieldVisible(field: EventFormField, answers: RawAnswers) {
  if (!field.showIf) return true;
  const [key, expected = ""] = field.showIf.split("=");
  const actual = answers[key.trim()];
  const wanted = expected.split("|").map((v) => v.trim().toLowerCase()).filter(Boolean);
  const values = Array.isArray(actual) ? actual : actual === undefined ? [] : [String(actual)];
  return values.some((v) => wanted.includes(v.trim().toLowerCase()));
}

const PHONE = /^\+?[0-9][0-9\s-]{7,18}$/;

/** Kenyan mobile numbers in any common form (0712…, 712…, 254712…, +254 712…). */
export function kenyanPhone(input: string) {
  const digits = input.replace(/[\s()-]/g, "").replace(/^\+/, "");
  const m = /^(?:254|0)?([17]\d{8})$/.exec(digits);
  return m ? `0${m[1].slice(0, 3)} ${m[1].slice(3, 6)} ${m[1].slice(6)}` : null;
}

export function phoneError(input: string) {
  const text = input.trim();
  if (!text) return null;
  if (kenyanPhone(text)) return null;
  // Other countries: must start with + and a country code.
  if (text.startsWith("+") && !text.startsWith("+254") && PHONE.test(text)) return null;
  return "Enter a mobile number like 0712 345 678";
}

export type FormStep = { title: string; fields: EventFormField[] };

/** Groups fields into wizard steps by their Step value (or by section when no step is set). */
export function formSteps(fields: EventFormField[]): FormStep[] {
  const byStep = fields.some((f) => f.step);
  const steps: FormStep[] = [];
  for (const field of fields) {
    const title = byStep ? field.step : field.section;
    const current = steps[steps.length - 1];
    if (!current || (title && title !== current.title)) steps.push({ title: title || "Details", fields: [field] });
    else current.fields.push(field);
  }
  return steps;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type StoredAnswer = { key: string; label: string; value: string | string[]; sensitive: boolean; section: string };

/** Validates answers against the field list. Returns per-field errors keyed by field key. */
export function validateAnswers(fields: EventFormField[], raw: RawAnswers) {
  const errors: Record<string, string> = {};
  const answers: StoredAnswer[] = [];
  const roles: Partial<Record<Exclude<FormFieldRole, "">, string>> = {};
  for (const field of fields) {
    if (field.type === "sessions") continue;
    if (!isFieldVisible(field, raw)) continue;
    const input = raw[field.key];
    let value: string | string[];
    if (field.type === "checkboxes") {
      const list = (Array.isArray(input) ? input : input ? [String(input)] : []).filter((v) => field.options.includes(v));
      value = list;
      if (field.required && list.length === 0) errors[field.key] = "Choose at least one option";
    } else if (field.type === "checkbox") {
      const ticked = input === true || input === "true" || input === "on" || input === "yes";
      value = ticked ? "Yes" : "No";
      if (field.required && !ticked) errors[field.key] = "Please tick the box to confirm";
    } else {
      const text = (Array.isArray(input) ? input[0] : typeof input === "string" ? input : "")?.trim() ?? "";
      value = text.slice(0, field.type === "textarea" ? 4000 : 400);
      if (!text) {
        if (field.required) errors[field.key] = field.type === "select" ? "Choose an option" : field.type === "email" ? "Enter your email address" : field.type === "phone" ? "Enter a phone number" : "This is required";
      } else if (field.type === "email" && !EMAIL.test(text)) errors[field.key] = "Enter a valid email address";
      else if (field.type === "phone" && phoneError(text)) errors[field.key] = phoneError(text)!;
      else if (field.type === "number" && (!/^\d+(\.\d+)?$/.test(text) || Number(text) > 1_000_000)) errors[field.key] = "Enter a number, e.g. 9";
      else if (field.type === "date" && Number.isNaN(Date.parse(text))) errors[field.key] = "Enter a date";
      else if (field.type === "select" && field.options.length && !field.options.includes(text)) errors[field.key] = "Choose one of the options";
      if (field.type === "phone" && !errors[field.key]) value = kenyanPhone(text) ?? text;
    }
    const empty = Array.isArray(value) ? value.length === 0 : value === "";
    if (!empty) answers.push({ key: field.key, label: field.label, value, sensitive: field.sensitive, section: field.section });
    if (field.role && typeof value === "string" && value) roles[field.role] = value;
  }
  return { errors, answers, roles };
}

export function answerText(value: string | string[]) {
  return Array.isArray(value) ? value.join(", ") : value;
}

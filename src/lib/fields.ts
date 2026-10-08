/** Serializable field definitions shared by the admin form renderer and server resources. */
export type Option = { value: string; label: string };

export type FieldType =
  | "text"
  | "slug"
  | "textarea"
  | "markdown"
  | "number"
  | "money"
  | "url"
  | "email"
  | "image"
  | "file"
  | "date"
  | "datetime"
  | "time"
  | "switch"
  | "select"
  | "multiselect"
  | "lines"
  | "color"
  | "repeater"
  | "password";

export type FieldDef = {
  name: string;
  label: string;
  type: FieldType;
  options?: Option[];
  required?: boolean;
  help?: string;
  placeholder?: string;
  span?: 1 | 2;
  /** Only shown when creating a record. */
  createOnly?: boolean;
  /** Sub-fields for repeaters. */
  fields?: FieldDef[];
  section?: string;
  readOnly?: boolean;
};

export type FormValues = Record<string, unknown>;

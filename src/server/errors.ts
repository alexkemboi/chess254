import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";

/** Error whose message is safe to show to the user. */
export class UserError extends Error {
  constructor(message: string, public fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "UserError";
  }
}

import type { ActionResult } from "@/lib/action";
export type { ActionResult };

export function fieldErrorsFrom(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Next.js control-flow errors (redirect, notFound, dynamic bailouts) must propagate. */
function isFrameworkSignal(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && /^(NEXT_|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(digest);
}

/** Wraps a Server Action body so internal errors never leak to the client. */
export async function runAction<T>(fn: () => Promise<ActionResult<T> | void>): Promise<ActionResult<T>> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (error) {
    if (isFrameworkSignal(error)) throw error;
    if (error instanceof UserError) return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    if (error instanceof z.ZodError) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: fieldErrorsFrom(error) };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = (error.meta?.target as string[] | undefined)?.join(", ");
      return { ok: false, error: `That ${target ?? "value"} is already in use.` };
    }
    console.error("[action]", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export function parseForm<S extends z.ZodTypeAny>(schema: S, formData: FormData): z.infer<S> {
  const raw: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).filter((v) => typeof v === "string");
    raw[key] = key.endsWith("[]") ? values : values.length > 1 ? values : values[0];
  }
  const cleaned = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/\[\]$/, ""), v]));
  return schema.parse(cleaned);
}

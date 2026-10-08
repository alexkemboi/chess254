/** Result shape returned by every Server Action (safe for client components). */
export type ActionResult<T = unknown> =
  | { ok: true; message?: string; data?: T; redirect?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

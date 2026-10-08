export type TemplateVars = Record<string, string | number | null | undefined>;

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * {{var}} is replaced with the value (HTML-escaped when html=true).
 * {{{var}}} inserts system-generated HTML verbatim (email only, e.g. order tables).
 */
export function renderTemplate(template: string, vars: TemplateVars, html = false) {
  return template
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_m, key: string) => (html ? String(vars[key] ?? "") : ""))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
      const value = vars[key];
      const text = value === null || value === undefined ? "" : String(value);
      return html ? escapeHtml(text) : text;
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Converts a rendered plain-text body (already escaped) into simple paragraphs with clickable links. */
export function bodyToHtml(escaped: string) {
  return escaped
    .split(/\n{2,}/)
    .map((block) => (block.trim().startsWith("<table") ? block : `<p style="margin:0 0 16px;line-height:1.65">${block.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2bb3a4">$1</a>')}</p>`))
    .join("");
}

export function emailLayout(opts: { clubName: string; bodyHtml: string; footer: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f2f3f1;font-family:Arial,Helvetica,sans-serif;color:#15181a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f1;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e1e4e2">
<tr><td style="background:#0b0c0e;padding:22px 28px;color:#f0f1ed;font-size:15px;letter-spacing:2px;font-weight:bold">${escapeHtml(opts.clubName.toUpperCase())}</td></tr>
<tr><td style="padding:28px;font-size:15px">${opts.bodyHtml}</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #e1e4e2;color:#6b7370;font-size:12px;line-height:1.6">${escapeHtml(opts.footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

export function orderTableHtml(order: { currency: string; subtotal: number; discountTotal: number; deliveryFee: number; paymentFee: number; total: number; items: { name: string; variantName: string | null; quantity: number; lineTotal: number }[] }) {
  const fmt = (n: number) => `${order.currency} ${Math.round(n).toLocaleString("en-KE")}`;
  const row = (label: string, value: string, bold = false) => `<tr><td style="padding:6px 0;${bold ? "font-weight:bold;" : ""}">${escapeHtml(label)}</td><td align="right" style="padding:6px 0;${bold ? "font-weight:bold;" : ""}">${escapeHtml(value)}</td></tr>`;
  const items = order.items.map((i) => row(`${i.quantity} × ${i.name}${i.variantName ? ` (${i.variantName})` : ""}`, fmt(i.lineTotal))).join("");
  const extras = [
    row("Subtotal", fmt(order.subtotal)),
    order.discountTotal ? row("Discount", `− ${fmt(order.discountTotal)}`) : "",
    order.deliveryFee ? row("Delivery", fmt(order.deliveryFee)) : "",
    order.paymentFee ? row("Payment fee", fmt(order.paymentFee)) : "",
    row("Total", fmt(order.total), true),
  ].join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e1e4e2;border-bottom:1px solid #e1e4e2;margin:8px 0 16px;font-size:14px">${items}<tr><td colspan="2" style="border-top:1px solid #e1e4e2"></td></tr>${extras}</table>`;
}

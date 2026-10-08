import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { can } from "@/server/rbac";
import { getAllSettings } from "@/server/settings";
import { primaryLocation } from "@/server/content";
import { PrintButton } from "@/components/site/print-button";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata = { title: "Invoice", robots: { index: false } };

export default async function InvoicePage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const user = await requireUser(`/invoices/${number}`);
  const invoice = await prisma.invoice.findUnique({ where: { number }, include: { order: { include: { items: true, user: true } }, payment: true } });
  if (!invoice) notFound();
  // Ownership check: members only see their own invoices.
  if (invoice.order.userId !== user.id && !(await can(user.role, "payments.view"))) notFound();
  const [settings, location] = await Promise.all([getAllSettings(), primaryLocation()]);
  const tz = settings.general.timezone;
  return (
    <div className="min-h-dvh bg-white px-4 py-10 text-black">
      <div className="mx-auto max-w-3xl">
        <div className="no-print mb-6 flex justify-end"><PrintButton /></div>
        <div className="flex flex-col justify-between gap-6 border-b border-black/10 pb-8 sm:flex-row">
          <div>
            <div className="text-3xl font-black tracking-tight">{settings.brand.logoText}<span style={{ color: settings.brand.primaryColor }}>{settings.brand.logoAccent}</span>{!settings.brand.logoText && settings.general.siteName}</div>
            {location && <div className="mt-2 text-sm text-black/60">{location.name}<br />{location.address}, {location.city}</div>}
            {settings.contact.email && <div className="text-sm text-black/60">{settings.contact.email}</div>}
          </div>
          <div className="sm:text-right">
            <div className="text-xs font-bold uppercase tracking-widest text-black/50">Invoice</div>
            <div className="mt-1 font-mono text-lg font-bold">{invoice.number}</div>
            <div className="mt-2 text-sm text-black/60">Issued {formatDate(invoice.issuedAt, tz)}<br />Order {invoice.order.number}</div>
          </div>
        </div>
        <div className="py-6 text-sm">
          <div className="text-xs font-bold uppercase tracking-widest text-black/50">Billed to</div>
          <div className="mt-1 font-semibold">{invoice.order.user.name}</div>
          <div className="text-black/60">{invoice.order.user.email}</div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-black/10 text-left text-xs uppercase tracking-wider text-black/50"><th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>
            {invoice.order.items.map((i) => (
              <tr key={i.id} className="border-b border-black/5"><td className="py-3">{i.description}</td><td className="py-3 text-right">{i.quantity}</td><td className="py-3 text-right font-mono">{formatMoney(i.total, invoice.currency)}</td></tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-6 grid max-w-xs gap-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-black/60">Subtotal</dt><dd className="font-mono">{formatMoney(invoice.subtotal, invoice.currency)}</dd></div>
          {invoice.tax.greaterThan(0) && <div className="flex justify-between"><dt className="text-black/60">{settings.payments.taxLabel}</dt><dd className="font-mono">{formatMoney(invoice.tax, invoice.currency)}</dd></div>}
          <div className="flex justify-between border-t border-black/10 pt-2 text-base font-bold"><dt>Total paid</dt><dd className="font-mono">{formatMoney(invoice.total, invoice.currency)}</dd></div>
        </dl>
        {invoice.payment && (
          <div className="mt-8 rounded-xl bg-black/5 p-4 text-sm">
            Paid via M-Pesa{invoice.payment.receiptNumber ? <> · receipt <span className="font-mono font-semibold">{invoice.payment.receiptNumber}</span></> : null}{invoice.payment.completedAt ? ` · ${formatDate(invoice.payment.completedAt, tz)}` : ""}
          </div>
        )}
        {settings.payments.invoiceFooter && <p className="mt-10 text-center text-sm text-black/50">{settings.payments.invoiceFooter}</p>}
      </div>
    </div>
  );
}

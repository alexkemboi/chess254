import Link from "next/link";
import type { Role } from "@prisma/client";
import { AlertTriangle, Smartphone } from "lucide-react";
import { prisma } from "@/server/db";
import { can } from "@/server/rbac";
import { describeSecrets } from "@/server/secrets";
import { encryptionAvailable } from "@/server/crypto";
import { providerImplementation } from "@/server/payments/registry";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/admin/admin-ui";
import { MpesaAccountForm } from "@/components/admin/payment-settings-forms";
import { testPaymentConnectionAction } from "@/actions/admin";

/** M-Pesa account card shown under Settings → Payments. */
export async function MpesaAccountSection({ role }: { role: Role }) {
  if (!(await can(role, "payments.configure"))) return null;
  const [provider, secrets, canSecrets] = await Promise.all([
    prisma.paymentProvider.findUnique({ where: { key: "mpesa" }, include: { config: true } }),
    describeSecrets("mpesa"),
    can(role, "payments.secrets"),
  ]);
  if (!provider) return null;
  const readiness = await providerImplementation("mpesa")?.readiness();
  const config = provider.config;
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-2xl font-bold"><Smartphone className="size-5 text-brand-ink" />M-Pesa account</h2>
          <p className="mt-1 text-sm text-muted">Daraja credentials for STK push on the pricing buttons, status checks and the transaction pull. Saved values are encrypted and apply immediately — no restart.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={provider.enabled ? "success" : "neutral"}>{provider.enabled ? "Accepting payments" : "Off"}</Badge>
          {readiness && <Badge variant={readiness.ready ? "success" : "warning"}>{readiness.ready ? `Ready · ${readiness.environment}` : "Incomplete"}</Badge>}
          {readiness?.ready && <ActionButton action={testPaymentConnectionAction.bind(null, provider.id)}>Test connection</ActionButton>}
        </div>
      </div>
      {readiness && !readiness.ready && (
        <div className="mt-5 flex gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm"><AlertTriangle className="size-5 shrink-0 text-warning" /><span>Missing: {readiness.missing.join(", ")}.</span></div>
      )}
      {!encryptionAvailable() && <p className="mt-5 text-sm text-warning">SETTINGS_ENCRYPTION_KEY is not configured on the server, so credentials can only come from environment variables.</p>}
      <div className="mt-6">
        <MpesaAccountForm
          values={{
            enabled: provider.enabled,
            isDefault: provider.isDefault,
            environment: config?.environment,
            accountType: config?.transactionType === "CustomerBuyGoodsOnline" ? "TILL" : "PAYBILL",
            shortcode: config?.shortcode,
            tillNumber: config?.tillNumber,
            pullNominatedNumber: config?.pullNominatedNumber,
          }}
          secrets={secrets}
          canSecrets={canSecrets && encryptionAvailable()}
          environmentLocked={Boolean(process.env.MPESA_ENVIRONMENT)}
          shortcodeFromEnv={process.env.MPESA_SHORTCODE || null}
        />
      </div>
      <p className="mt-6 text-xs text-muted">Callback URL, account reference format, timeouts and transaction pull scheduling are in <Link href="/admin/payment-settings" className="text-brand-ink underline">M-Pesa advanced settings</Link>.</p>
    </section>
  );
}

import { CheckCircle2, AlertTriangle, Lock } from "lucide-react";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/rbac";
import { siteUrl } from "@/server/settings";
import { describeSecrets } from "@/server/secrets";
import { encryptionAvailable } from "@/server/crypto";
import { providerImplementation } from "@/server/payments/registry";
import { mpesaCallbackPath } from "@/server/payments/mpesa";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/admin/admin-ui";
import { PaymentConfigForm, SecretsForm } from "@/components/admin/payment-settings-forms";
import { clearSecretAction, testPaymentConnectionAction } from "@/actions/admin";

export const metadata = { title: "Payment settings" };

const ENV_LOCKS: Record<string, string> = { environment: "MPESA_ENVIRONMENT", shortcode: "MPESA_SHORTCODE", callbackUrl: "MPESA_CALLBACK_URL" };

export default async function PaymentSettings() {
  const actor = await requirePermission("payments.configure", "/admin/payment-settings");
  const [providers, canSecrets, mpesaSecrets, emailSecrets, base] = await Promise.all([
    prisma.paymentProvider.findMany({ include: { config: true }, orderBy: { name: "asc" } }),
    can(actor.role, "payments.secrets"),
    describeSecrets("mpesa"),
    describeSecrets("email"),
    siteUrl(),
  ]);
  const readinessList = await Promise.all(providers.map((p) => providerImplementation(p.key)?.readiness() ?? Promise.resolve(null)));
  const locked = Object.fromEntries(Object.entries(ENV_LOCKS).filter(([, env]) => Boolean(process.env[env])).map(([k, env]) => [k, env]));
  return (
    <div className="grid gap-6">
      <PageHeader title="Payment settings" description="M-Pesa (Daraja) STK Push configuration. Credentials are never shown again after saving and are never sent to the browser." />
      {providers.map((p, i) => {
        const readiness = readinessList[i];
        const callback = `${(process.env.MPESA_CALLBACK_URL || p.config?.callbackUrl || base).replace(/\/+$/, "")}${p.key === "mpesa" ? mpesaCallbackPath() : ""}`;
        return (
          <Card key={p.id}>
            <CardHeader>
              <div>
                <CardTitle>{p.name}</CardTitle>
                <p className="mt-1 text-xs text-muted">{p.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={p.enabled ? "success" : "neutral"}>{p.enabled ? "Enabled" : "Disabled"}</Badge>
                {p.isDefault && <Badge>Default</Badge>}
                {readiness && <Badge variant={readiness.ready ? "success" : "warning"}>{readiness.ready ? `Ready · ${readiness.environment}` : "Not ready"}</Badge>}
                {readiness?.ready && <ActionButton action={testPaymentConnectionAction.bind(null, p.id)}>Test connection</ActionButton>}
              </div>
            </CardHeader>
            <CardContent className="grid gap-6">
              {readiness && !readiness.ready && (
                <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm"><AlertTriangle className="size-5 shrink-0 text-warning" /><span>Missing: {readiness.missing.join(", ")}. Payments stay off until these are set.</span></div>
              )}
              <div className="rounded-xl bg-surface-2 p-4 text-sm">
                <div className="text-xs text-muted">Callback URL registered with each STK request (contains a secret token)</div>
                <code className="mt-1 block break-all font-mono text-xs">{callback}</code>
                {!callback.startsWith("https://") && <p className="mt-2 text-xs text-warning">Safaricom can only reach a public HTTPS URL. For local testing, use a tunnel and set the callback base URL.</p>}
              </div>
              <PaymentConfigForm providerId={p.id} locked={locked} values={{ enabled: p.enabled, isDefault: p.isDefault, ...(p.config ?? {}), allowedCallbackIps: p.config?.allowedCallbackIps.join(", ") ?? "" }} />
            </CardContent>
          </Card>
        );
      })}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="size-4 text-brand" />Credentials</CardTitle></CardHeader>
        <CardContent className="grid gap-5">
          <p className="text-sm text-muted">Environment variables always take precedence. Values saved here are encrypted with AES-256-GCM using <code>SETTINGS_ENCRYPTION_KEY</code>{encryptionAvailable() ? "" : " — which is not configured, so only environment variables can be used"}.</p>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {[...mpesaSecrets, ...emailSecrets].map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-3">
                <span className="flex items-center gap-2">{s.source === "unset" ? <AlertTriangle className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />}{s.label}</span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {s.source === "env" ? "environment" : s.source === "stored" ? "encrypted" : "not set"}{s.hint ? ` · ${s.hint}` : ""}
                  {canSecrets && s.source === "stored" && <ActionButton action={clearSecretAction.bind(null, s.key)} variant="ghost" confirm={`Remove the stored ${s.label}?`}>Remove</ActionButton>}
                </span>
              </li>
            ))}
          </ul>
          {canSecrets ? (
            encryptionAvailable() && <SecretsForm fields={[...mpesaSecrets, ...emailSecrets].filter((s) => s.source !== "env").map((s) => ({ key: s.key, label: s.label }))} />
          ) : (
            <p className="text-sm text-muted">Only super admins can replace credentials.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

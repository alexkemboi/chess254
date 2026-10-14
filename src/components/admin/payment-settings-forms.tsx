"use client";
import * as React from "react";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveMpesaAccountAction, savePaymentConfigAction, savePaymentSecretsAction } from "@/actions/admin";

type Values = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function PaymentConfigForm({ providerId, values, locked }: { providerId: string; values: Values; locked: Record<string, string> }) {
  const lockHint = (k: string) => (locked[k] ? `Locked by ${locked[k]} in the server environment.` : undefined);
  return (
    <ActionForm action={(fd) => savePaymentConfigAction(providerId, fd)} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border p-4"><Switch name="enabled" defaultChecked={values.enabled === true} label="Accept payments" description="Turn on once credentials are set and tested." /></div>
        <div className="rounded-xl border border-border p-4"><Switch name="isDefault" defaultChecked={values.isDefault === true} label="Default provider" /></div>
        <Field name="environment" label="Environment" hint={lockHint("environment")}>
          <Select name="environment" defaultValue={s(values.environment) || "sandbox"} disabled={Boolean(locked.environment)}><option value="sandbox">Sandbox</option><option value="production">Production</option></Select>
          {locked.environment && <input type="hidden" name="environment" value={s(values.environment) || "sandbox"} />}
        </Field>
        <Field name="transactionType" label="Transaction type">
          <Select name="transactionType" defaultValue={s(values.transactionType) || "CustomerPayBillOnline"}><option value="CustomerPayBillOnline">Paybill (CustomerPayBillOnline)</option><option value="CustomerBuyGoodsOnline">Till / Buy Goods (CustomerBuyGoodsOnline)</option></Select>
        </Field>
        <Field name="shortcode" label="Business shortcode" hint={lockHint("shortcode") ?? "Paybill number, or the head-office store number for a Till."}><Input name="shortcode" defaultValue={s(values.shortcode)} inputMode="numeric" readOnly={Boolean(locked.shortcode)} /></Field>
        <Field name="paybillNumber" label="Paybill number" hint="Blank = shortcode"><Input name="paybillNumber" defaultValue={s(values.paybillNumber)} inputMode="numeric" /></Field>
        <Field name="tillNumber" label="Till number" hint="Receiving till for Buy Goods"><Input name="tillNumber" defaultValue={s(values.tillNumber)} inputMode="numeric" /></Field>
        <Field name="callbackUrl" label="Public callback base URL" hint={lockHint("callbackUrl") ?? "HTTPS origin Safaricom can reach. Blank = site URL."}><Input name="callbackUrl" defaultValue={s(values.callbackUrl)} placeholder="https://minichess.co.ke" readOnly={Boolean(locked.callbackUrl)} /></Field>
        <Field name="accountReferenceFormat" label="Account reference format" hint="{order} becomes the order number. Max 12 characters after substitution."><Input name="accountReferenceFormat" defaultValue={s(values.accountReferenceFormat) || "{order}"} /></Field>
        <Field name="transactionDescription" label="Transaction description" hint="Max 13 characters"><Input name="transactionDescription" defaultValue={s(values.transactionDescription)} maxLength={13} /></Field>
        <Field name="currency" label="Currency"><Input name="currency" defaultValue={s(values.currency) || "KES"} maxLength={3} /></Field>
        <Field name="timeoutMinutes" label="Prompt timeout (minutes)"><Input name="timeoutMinutes" type="number" min={1} max={30} defaultValue={s(values.timeoutMinutes) || "5"} /></Field>
        <Field name="allowedCallbackIps" label="Allowed callback IPs" hint="Optional, comma separated. Leave empty behind proxies that hide caller IPs." className="sm:col-span-2"><Input name="allowedCallbackIps" defaultValue={s(values.allowedCallbackIps)} /></Field>
        <div className="rounded-xl border border-border p-4 sm:col-span-2"><Switch name="verifyWithQuery" defaultChecked={values.verifyWithQuery !== false} label="Confirm every success callback with an STK status query" description="Recommended. A forged callback can never activate a membership." /></div>
      </div>
      <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="font-semibold">Transaction pull</div>
          <p className="mt-1 text-xs text-muted">Daraja Pull Transactions API: reads payments received on the shortcode every few minutes and settles matching orders, including paybill payments made without the prompt. Safaricom must enable the API on your app.</p>
        </div>
        <div className="rounded-xl border border-border p-4 sm:col-span-2"><Switch name="pullEnabled" defaultChecked={values.pullEnabled === true} label="Pull received transactions automatically" description="Runs with the scheduled reconciliation once the shortcode is registered." /></div>
        <Field name="pullShortcode" label="Pull shortcode" hint="Blank = business shortcode"><Input name="pullShortcode" defaultValue={s(values.pullShortcode)} inputMode="numeric" /></Field>
        <Field name="pullNominatedNumber" label="Nominated M-Pesa number" hint="The organisation's nominated Safaricom number, required for registration"><Input name="pullNominatedNumber" defaultValue={s(values.pullNominatedNumber)} inputMode="tel" placeholder="0712 345 678" /></Field>
      </div>
      <div><SubmitButton>Save payment settings</SubmitButton></div>
    </ActionForm>
  );
}

export function SecretsForm({ fields }: { fields: { key: string; label: string }[] }) {
  if (!fields.length) return null;
  return (
    <ActionForm action={savePaymentSecretsAction} resetOnSuccess className="grid gap-4 rounded-xl border border-border p-4">
      <p className="text-sm text-muted">Enter only the values you want to replace. Blank fields keep their current value.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.key} name={f.key} label={f.label}><Input name={f.key} type="password" autoComplete="off" spellCheck={false} /></Field>
        ))}
      </div>
      <div><SubmitButton>Save credentials</SubmitButton></div>
    </ActionForm>
  );
}

type SecretInfo = { key: string; label: string; source: "env" | "stored" | "unset"; hint: string | null };

/** Settings → Payments: the whole M-Pesa account in one form. Credentials are write-only. */
export function MpesaAccountForm({ values, secrets, canSecrets, environmentLocked, shortcodeFromEnv }: { values: Values; secrets: SecretInfo[]; canSecrets: boolean; environmentLocked: boolean; shortcodeFromEnv: string | null }) {
  const [accountType, setAccountType] = React.useState(s(values.accountType) || "PAYBILL");
  const secret = (key: string, name: string, label: string) => {
    const info = secrets.find((x) => x.key === key);
    const fromEnv = info?.source === "env";
    const hint = fromEnv ? "Set in the server environment" : info?.source === "stored" ? `Saved (${info.hint ?? "••••"}). Leave blank to keep it.` : "Not set";
    return (
      <Field name={name} label={label} hint={hint}>
        <Input name={name} type="password" autoComplete="new-password" spellCheck={false} placeholder={info?.source === "unset" ? "" : "••••••••"} disabled={fromEnv || !canSecrets} />
      </Field>
    );
  };
  return (
    <ActionForm action={saveMpesaAccountAction} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="accountType" label="Account type">
          <Select name="accountType" value={accountType} onChange={(e) => setAccountType(e.target.value)}>
            <option value="PAYBILL">Paybill</option>
            <option value="TILL">Till (Buy Goods)</option>
          </Select>
        </Field>
        <Field name="environment" label="Environment" hint={environmentLocked ? "Locked by MPESA_ENVIRONMENT on the server." : "Use sandbox until the go-live credentials arrive."}>
          <Select name="environment" defaultValue={s(values.environment) || "sandbox"} disabled={environmentLocked}><option value="sandbox">Sandbox (testing)</option><option value="production">Production (live)</option></Select>
          {environmentLocked && <input type="hidden" name="environment" value={s(values.environment) || "sandbox"} />}
        </Field>
        <Field name="shortcode" label={accountType === "TILL" ? "Store / head-office number" : "Paybill number (shortcode)"} hint={shortcodeFromEnv ? "Locked by MPESA_SHORTCODE on the server." : accountType === "TILL" ? "The shortcode the passkey was issued for." : "Customers pay to this number."}>
          <Input name="shortcode" defaultValue={shortcodeFromEnv ?? s(values.shortcode)} readOnly={Boolean(shortcodeFromEnv)} inputMode="numeric" required placeholder="e.g. 174379" />
        </Field>
        {accountType === "TILL" ? (
          <Field name="tillNumber" label="Till number" hint="The till customers pay to.">
            <Input name="tillNumber" defaultValue={s(values.tillNumber)} inputMode="numeric" required />
          </Field>
        ) : <div className="hidden sm:block" />}
        {secret("mpesa.consumerKey", "consumerKey", "Consumer key")}
        {secret("mpesa.consumerSecret", "consumerSecret", "Consumer secret")}
        <div className="sm:col-span-2">{secret("mpesa.passkey", "passkey", "Passkey (Lipa na M-Pesa Online)")}</div>
        <Field name="pullNominatedNumber" label="Nominated Safaricom number" hint="The organisation's nominated number, needed to register the transaction pull." className="sm:col-span-2">
          <Input name="pullNominatedNumber" defaultValue={s(values.pullNominatedNumber)} inputMode="tel" placeholder="e.g. 0722000000" />
        </Field>
        <div className="rounded-xl border border-border p-4"><Switch name="enabled" defaultChecked={values.enabled === true} label="Accept M-Pesa payments" description="Pricing buttons send an STK push once this is on." /></div>
        <div className="rounded-xl border border-border p-4"><Switch name="isDefault" defaultChecked={values.isDefault === true} label="Set as default account" /></div>
      </div>
      {!canSecrets && <p className="text-xs text-muted">Only super admins can change credentials.</p>}
      <div><SubmitButton>Save M-Pesa account</SubmitButton></div>
    </ActionForm>
  );
}

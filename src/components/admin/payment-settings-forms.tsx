"use client";
import { ActionForm, Field, SubmitButton } from "@/components/forms/action-form";
import { Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { savePaymentConfigAction, savePaymentSecretsAction } from "@/actions/admin";

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
        <Field name="callbackUrl" label="Public callback base URL" hint={lockHint("callbackUrl") ?? "HTTPS origin Safaricom can reach. Blank = site URL."}><Input name="callbackUrl" defaultValue={s(values.callbackUrl)} placeholder="https://chess254.co.ke" readOnly={Boolean(locked.callbackUrl)} /></Field>
        <Field name="accountReferenceFormat" label="Account reference format" hint="{order} becomes the order number. Max 12 characters after substitution."><Input name="accountReferenceFormat" defaultValue={s(values.accountReferenceFormat) || "{order}"} /></Field>
        <Field name="transactionDescription" label="Transaction description" hint="Max 13 characters"><Input name="transactionDescription" defaultValue={s(values.transactionDescription)} maxLength={13} /></Field>
        <Field name="currency" label="Currency"><Input name="currency" defaultValue={s(values.currency) || "KES"} maxLength={3} /></Field>
        <Field name="timeoutMinutes" label="Prompt timeout (minutes)"><Input name="timeoutMinutes" type="number" min={1} max={30} defaultValue={s(values.timeoutMinutes) || "5"} /></Field>
        <Field name="allowedCallbackIps" label="Allowed callback IPs" hint="Optional, comma separated. Leave empty behind proxies that hide caller IPs." className="sm:col-span-2"><Input name="allowedCallbackIps" defaultValue={s(values.allowedCallbackIps)} /></Field>
        <div className="rounded-xl border border-border p-4 sm:col-span-2"><Switch name="verifyWithQuery" defaultChecked={values.verifyWithQuery !== false} label="Confirm every success callback with an STK status query" description="Recommended. A forged callback can never activate a membership." /></div>
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

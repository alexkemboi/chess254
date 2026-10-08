import "server-only";

/**
 * Provider-neutral payment contract. Membership, booking and event logic only
 * ever talk to this interface, so card, bank or other mobile-money providers can
 * be added by implementing it and registering the class in ./registry.ts.
 */
export type ProviderStatus = "SUCCESS" | "FAILED" | "CANCELLED" | "PENDING";

export type ProviderOutcome = {
  status: ProviderStatus;
  resultCode?: string;
  message?: string;
  receiptNumber?: string;
  amount?: number;
  phone?: string;
  transactionDate?: string;
  raw: unknown;
};

export type InitiateInput = {
  paymentId: string;
  amount: number;
  currency: string;
  phone: string;
  accountReference: string;
  description: string;
};

export type InitiateResult =
  | { ok: true; checkoutRequestId: string; merchantRequestId?: string; customerMessage?: string; raw: unknown }
  | { ok: false; message: string; raw: unknown };

export type ParsedCallback = {
  eventKey: string;
  checkoutRequestId: string;
  merchantRequestId?: string;
  outcome: ProviderOutcome;
};

export type ProviderReadiness = { ready: boolean; missing: string[]; environment: string };

export interface PaymentProvider {
  readonly key: string;
  readonly displayName: string;
  readiness(): Promise<ProviderReadiness>;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  query(checkoutRequestId: string): Promise<ProviderOutcome>;
  parseCallback(body: unknown): ParsedCallback | null;
  /** Normalises a customer-entered phone number, or returns null if invalid. */
  normalizePhone(input: string): string | null;
  formatAccountReference(orderNumber: string): Promise<string>;
}

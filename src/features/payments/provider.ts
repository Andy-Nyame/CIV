import "server-only";

export type InitializeProviderPaymentInput = {
  amountMinor: number;
  callbackUrl: string;
  channels?: readonly ("card" | "mobile_money")[];
  currency: "GHS";
  email: string;
  metadata: Record<string, string>;
  planCode?: string;
  reference: string;
};

export type InitializedProviderPayment = {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
};

export type VerifiedProviderPayment = {
  transactionId: string;
  domain: string;
  status: string;
  reference: string;
  amountMinor: number;
  currency: string;
  customerEmail: string | null;
  channel: string | null;
  gatewayResponse: string | null;
  paidAt: string | null;
  planCode?: string | null;
  customerCode?: string | null;
};

export type ParsedProviderEvent = {
  eventType: string;
  eventIdentifier: string | null;
  providerReference: string | null;
  safeData: Record<string, string | number | boolean | null>;
};

export type DisableProviderSubscriptionInput = {
  subscriptionCode: string;
};

export type ProviderRefundStatus =
  | "pending"
  | "processing"
  | "needs-attention"
  | "failed"
  | "processed";

export type CreateProviderRefundInput = {
  transactionReference: string;
  amountMinor: number;
  currency: "GHS";
  customerNote: string;
  merchantNote: string;
};

export type ProviderRefund = {
  providerRefundId: string;
  providerRefundReference: string | null;
  transactionReference: string | null;
  transactionIdentifier: string;
  domain: string;
  status: ProviderRefundStatus;
  amountMinor: number;
  currency: string;
  expectedAt: string | null;
  refundedAt: string | null;
};

export interface PaymentProviderClient {
  readonly provider: "PAYSTACK";
  initializePayment(
    input: InitializeProviderPaymentInput,
  ): Promise<InitializedProviderPayment>;
  verifyPayment(reference: string): Promise<VerifiedProviderPayment>;
  createRefund?(
    input: CreateProviderRefundInput,
  ): Promise<ProviderRefund>;
  fetchRefund?(providerRefundId: string): Promise<ProviderRefund>;
  disableSubscription?(input: DisableProviderSubscriptionInput): Promise<void>;
  validateWebhook(rawBody: Uint8Array, signature: string | null): boolean;
  parseWebhookEvent(rawBody: Uint8Array): ParsedProviderEvent;
}

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { readPaystackConfig } from "./config";
import { PaymentProviderError, PaymentValidationError } from "./errors";
import type {
  CreateProviderRefundInput,
  InitializeProviderPaymentInput,
  ParsedProviderEvent,
  PaymentProviderClient,
  ProviderRefund,
  VerifiedProviderPayment,
} from "./provider";

type Fetcher = typeof fetch;

const initializeResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({
    authorization_url: z.string().url(),
    access_code: z.string().min(1).max(255),
    reference: z.string().min(1).max(100),
  }),
});

const verifyResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({
    id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    domain: z.string().min(1).max(20),
    status: z.string().min(1).max(50),
    reference: z.string().min(1).max(100),
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
    channel: z.string().max(50).nullable().optional(),
    gateway_response: z.string().max(255).nullable().optional(),
    paid_at: z.string().nullable().optional(),
    customer: z.object({
      email: z.string().email().max(320),
      customer_code: z.string().max(100).nullable().optional(),
    }).nullable().optional(),
    plan: z.union([
      z.string().max(100),
      z.object({ plan_code: z.string().max(100).optional() }),
    ]).nullable().optional(),
    plan_object: z.object({ plan_code: z.string().max(100).optional() }).nullable().optional(),
  }),
});

const eventEnvelopeSchema = z.object({
  event: z.string().min(1).max(100),
  data: z.unknown(),
});

const chargeEventDataSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
  status: z.string().min(1).max(50),
  reference: z.string().min(1).max(100),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

const customerEventSchema = z.object({
  customer_code: z.string().min(1).max(100).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
});

const subscriptionEventDataSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
  status: z.string().min(1).max(50),
  subscription_code: z.string().min(1).max(100),
  email_token: z.string().min(1).max(255).nullable().optional(),
  next_payment_date: z.string().nullable().optional(),
  plan: z.object({ plan_code: z.string().min(1).max(100) }),
  customer: customerEventSchema,
});

const invoiceEventDataSchema = z.object({
  invoice_code: z.string().min(1).max(100),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3).optional().default("GHS"),
  period_start: z.string(),
  period_end: z.string(),
  status: z.string().min(1).max(50),
  paid: z.boolean().optional().default(false),
  paid_at: z.string().nullable().optional(),
  subscription: z.object({
    subscription_code: z.string().min(1).max(100),
    next_payment_date: z.string().nullable().optional(),
  }),
  transaction: z.object({
    reference: z.string().min(1).max(100),
    status: z.string().min(1).max(50).optional(),
    amount: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
  }).nullable().optional(),
});

const refundStatusSchema = z.enum([
  "pending",
  "processing",
  "needs-attention",
  "failed",
  "processed",
]);

const refundResponseDataSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
  status: refundStatusSchema,
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  domain: z.string().min(1).max(20),
  expected_at: z.string().nullable().optional(),
  refunded_at: z.string().nullable().optional(),
  refund_reference: z.string().min(1).max(100).nullable().optional(),
  transaction: z.union([
    z.string().min(1).max(100),
    z.number().int().nonnegative(),
    z.object({
      id: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
      reference: z.string().min(1).max(100),
    }),
  ]),
});

const refundResponseSchema = z.object({
  status: z.literal(true),
  data: refundResponseDataSchema,
});

const refundEventDataSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional(),
  status: refundStatusSchema,
  amount: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  currency: z.string().length(3),
  transaction_reference: z.string().min(1).max(100),
  refund_reference: z.string().min(1).max(100).nullable().optional(),
  domain: z.string().min(1).max(20).nullable().optional(),
});

function providerRefundFromResponse(
  data: z.infer<typeof refundResponseDataSchema>,
  expectedTransactionReference?: string,
): ProviderRefund {
  const transactionReference =
    typeof data.transaction === "object" ? data.transaction.reference : null;
  const transactionIdentifier =
    typeof data.transaction === "object"
      ? String(data.transaction.id ?? data.transaction.reference)
      : String(data.transaction);
  if (
    expectedTransactionReference &&
    transactionReference !== null &&
    transactionReference !== expectedTransactionReference
  ) {
    throw new PaymentProviderError();
  }
  return {
    providerRefundId: String(data.id),
    providerRefundReference: data.refund_reference ?? null,
    transactionReference,
    transactionIdentifier,
    domain: data.domain,
    status: data.status,
    amountMinor: data.amount,
    currency: data.currency,
    expectedAt: data.expected_at ?? null,
    refundedAt: data.refunded_at ?? null,
  };
}

function checkoutUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "checkout.paystack.com") {
    throw new PaymentProviderError();
  }
  return url.toString();
}

export class PaystackPaymentProvider implements PaymentProviderClient {
  readonly provider = "PAYSTACK" as const;
  private readonly config;

  constructor(
    private readonly fetcher: Fetcher = fetch,
    environment: Record<string, string | undefined> = process.env,
  ) {
    this.config = readPaystackConfig(environment);
  }

  private async request(path: string, init: RequestInit) {
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new PaymentProviderError();
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PaymentProviderError();
    }
    if (!response.ok) throw new PaymentProviderError();
    return payload;
  }

  async initializePayment(input: InitializeProviderPaymentInput) {
    const payload = await this.request("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        amount: String(input.amountMinor),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        ...(input.planCode ? { plan: input.planCode } : {}),
        ...(input.channels ? { channels: input.channels } : {}),
        metadata: JSON.stringify(input.metadata),
      }),
    });
    const parsed = initializeResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.data.reference !== input.reference) {
      throw new PaymentProviderError();
    }
    return {
      authorizationUrl: checkoutUrl(parsed.data.data.authorization_url),
      accessCode: parsed.data.data.access_code,
      reference: parsed.data.data.reference,
    };
  }

  async verifyPayment(reference: string): Promise<VerifiedProviderPayment> {
    if (!/^CIV-PAY-[A-F0-9]{32}$/.test(reference)) {
      throw new PaymentValidationError();
    }
    const payload = await this.request(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      { method: "GET" },
    );
    const parsed = verifyResponseSchema.safeParse(payload);
    if (!parsed.success) throw new PaymentProviderError();
    const data = parsed.data.data;
    const directPlanCode =
      typeof data.plan === "string" ? data.plan : data.plan?.plan_code;
    const planObjectCode = data.plan_object?.plan_code;
    const planCode =
      [directPlanCode, planObjectCode].find(
        (value): value is string =>
          typeof value === "string" && /^PLN_[A-Za-z0-9]+$/.test(value),
      ) ?? planObjectCode ?? directPlanCode ?? null;
    return {
      transactionId: String(data.id),
      domain: data.domain,
      status: data.status,
      reference: data.reference,
      amountMinor: data.amount,
      currency: data.currency,
      customerEmail: data.customer?.email?.trim().toLowerCase() ?? null,
      channel: data.channel ?? null,
      gatewayResponse: data.gateway_response ?? null,
      paidAt: data.paid_at ?? null,
      planCode,
      customerCode: data.customer?.customer_code ?? null,
    };
  }

  async createRefund(input: CreateProviderRefundInput) {
    if (!/^CIV-PAY-[A-F0-9]{32}$/.test(input.transactionReference)) {
      throw new PaymentValidationError();
    }
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new PaymentValidationError();
    }
    const payload = await this.request("/refund", {
      method: "POST",
      body: JSON.stringify({
        transaction: input.transactionReference,
        amount: input.amountMinor,
        currency: input.currency,
        customer_note: input.customerNote,
        merchant_note: input.merchantNote,
      }),
    });
    const parsed = refundResponseSchema.safeParse(payload);
    if (!parsed.success) throw new PaymentProviderError();
    return providerRefundFromResponse(
      parsed.data.data,
      input.transactionReference,
    );
  }

  async fetchRefund(providerRefundId: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(providerRefundId)) {
      throw new PaymentValidationError();
    }
    const payload = await this.request(
      `/refund/${encodeURIComponent(providerRefundId)}`,
      { method: "GET" },
    );
    const parsed = refundResponseSchema.safeParse(payload);
    if (!parsed.success) throw new PaymentProviderError();
    return providerRefundFromResponse(parsed.data.data);
  }

  async disableSubscription(input: {
    subscriptionCode: string;
  }) {
    if (!/^SUB_[A-Za-z0-9]+$/.test(input.subscriptionCode)) {
      throw new PaymentValidationError();
    }
    const subscription = z.object({
      status: z.literal(true),
      data: z.object({
        subscription_code: z.literal(input.subscriptionCode),
        email_token: z.string().min(1).max(255),
      }),
    }).safeParse(await this.request(
      `/subscription/${encodeURIComponent(input.subscriptionCode)}`,
      { method: "GET" },
    ));
    if (!subscription.success) throw new PaymentProviderError();
    const response = await this.request("/subscription/disable", {
      method: "POST",
      body: JSON.stringify({
        code: input.subscriptionCode,
        token: subscription.data.data.email_token,
      }),
    });
    const parsed = z.object({ status: z.literal(true) }).safeParse(response);
    if (!parsed.success) throw new PaymentProviderError();
  }

  validateWebhook(rawBody: Uint8Array, signature: string | null) {
    if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
    const expected = createHmac("sha512", this.config.secretKey)
      .update(rawBody)
      .digest();
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  parseWebhookEvent(rawBody: Uint8Array): ParsedProviderEvent {
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    } catch {
      throw new PaymentValidationError();
    }
    const envelope = eventEnvelopeSchema.safeParse(payload);
    if (!envelope.success) throw new PaymentValidationError();
    if (envelope.data.event === "charge.success") {
      const data = chargeEventDataSchema.safeParse(envelope.data.data);
      if (!data.success) throw new PaymentValidationError();
      return {
        eventType: envelope.data.event,
        eventIdentifier: String(data.data.id),
        providerReference: data.data.reference,
        safeData: {
          transactionId: String(data.data.id),
          status: data.data.status,
          amountMinor: data.data.amount,
          currency: data.data.currency,
        },
      };
    }

    if (["subscription.create", "subscription.not_renew", "subscription.disable"].includes(envelope.data.event)) {
      const data = subscriptionEventDataSchema.safeParse(envelope.data.data);
      if (!data.success) throw new PaymentValidationError();
      return {
        eventType: envelope.data.event,
        eventIdentifier: `${envelope.data.event}:${data.data.subscription_code}`,
        providerReference: null,
        safeData: {
          subscriptionCode: data.data.subscription_code,
          planCode: data.data.plan.plan_code,
          customerCode: data.data.customer.customer_code ?? null,
          customerEmail: data.data.customer.email?.trim().toLowerCase() ?? null,
          subscriptionStatus: data.data.status,
          nextPaymentDate: data.data.next_payment_date ?? null,
        },
      };
    }

    if (["invoice.create", "invoice.update", "invoice.payment_failed"].includes(envelope.data.event)) {
      const data = invoiceEventDataSchema.safeParse(envelope.data.data);
      if (!data.success) throw new PaymentValidationError();
      return {
        eventType: envelope.data.event,
        eventIdentifier: [
          envelope.data.event,
          data.data.invoice_code,
          data.data.status,
          data.data.paid ? "paid" : "unpaid",
          data.data.transaction?.reference ?? "none",
        ].join(":"),
        providerReference: data.data.transaction?.reference ?? null,
        safeData: {
          invoiceCode: data.data.invoice_code,
          subscriptionCode: data.data.subscription.subscription_code,
          amountMinor: data.data.amount,
          currency: data.data.currency,
          periodStart: data.data.period_start,
          periodEnd: data.data.period_end,
          invoiceStatus: data.data.status,
          paid: data.data.paid,
          paidAt: data.data.paid_at ?? null,
          nextPaymentDate: data.data.subscription.next_payment_date ?? null,
          transactionReference: data.data.transaction?.reference ?? null,
        },
      };
    }

    if (["refund.pending", "refund.processing", "refund.needs-attention", "refund.failed", "refund.processed"].includes(envelope.data.event)) {
      const data = refundEventDataSchema.safeParse(envelope.data.data);
      if (!data.success) throw new PaymentValidationError();
      const providerRefundId = data.data.refund_reference ??
        (data.data.id === undefined ? null : String(data.data.id));
      return {
        eventType: envelope.data.event,
        eventIdentifier: [
          envelope.data.event,
          providerRefundId ?? "unknown",
          data.data.transaction_reference,
          String(data.data.amount),
          data.data.status,
        ].join(":"),
        providerReference: data.data.transaction_reference,
        safeData: {
          providerRefundId,
          refundStatus: data.data.status,
          transactionReference: data.data.transaction_reference,
          amountMinor: Number(data.data.amount),
          currency: data.data.currency,
          domain: data.data.domain ?? null,
        },
      };
    }

    return {
      eventType: envelope.data.event,
      eventIdentifier: null,
      providerReference: null,
      safeData: {},
    };
  }
}

export function getPaystackPaymentProvider() {
  return new PaystackPaymentProvider();
}

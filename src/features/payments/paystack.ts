import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { readPaystackConfig } from "./config";
import { PaymentProviderError, PaymentValidationError } from "./errors";
import type {
  InitializeProviderPaymentInput,
  ParsedProviderEvent,
  PaymentProviderClient,
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
    customer: z.object({ email: z.string().email().max(320) }).nullable().optional(),
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
    };
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
    if (envelope.data.event !== "charge.success") {
      return {
        eventType: envelope.data.event,
        eventIdentifier: null,
        providerReference: null,
        safeData: {},
      };
    }
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
}

export function getPaystackPaymentProvider() {
  return new PaystackPaymentProvider();
}

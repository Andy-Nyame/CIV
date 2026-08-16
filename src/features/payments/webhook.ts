import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { PaymentNotFoundError } from "./errors";
import { getPaystackPaymentProvider } from "./paystack";
import type { PaymentProviderClient } from "./provider";
import { verifyPaymentByReference } from "./service";

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function processPaystackWebhook(
  rawBody: Uint8Array,
  signature: string | null,
  provider: PaymentProviderClient = getPaystackPaymentProvider(),
) {
  if (!provider.validateWebhook(rawBody, signature)) {
    return { accepted: false as const, status: 401 as const };
  }

  const event = provider.parseWebhookEvent(rawBody);
  const payloadHash = sha256(rawBody);
  const eventKey = sha256(
    [
      provider.provider,
      event.eventType,
      event.eventIdentifier ?? event.providerReference ?? payloadHash,
    ].join(":"),
  );
  let record;
  try {
    record = await db.paymentProviderEvent.create({
      data: {
        provider: provider.provider,
        eventKey,
        payloadHash,
        eventType: event.eventType,
        providerReference: event.providerReference,
        safeData: event.safeData,
      },
      select: { id: true, status: true },
    });
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
    record = await db.paymentProviderEvent.findUniqueOrThrow({
      where: { eventKey },
      select: { id: true, status: true },
    });
  }
  const claimed = await db.paymentProviderEvent.updateMany({
    where: { id: record.id, status: { in: ["RECEIVED", "FAILED"] } },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) {
    return { accepted: true as const, duplicate: true };
  }

  const recurringEvents = new Set([
    "subscription.create",
    "subscription.not_renew",
    "subscription.disable",
    "invoice.create",
    "invoice.update",
    "invoice.payment_failed",
  ]);
  if (recurringEvents.has(event.eventType)) {
    try {
      const recurring = await import("./recurring-subscriptions");
      const result = await recurring.processRecurringSubscriptionEvent(event);
      await db.paymentProviderEvent.update({
        where: { id: record.id },
        data: {
          status: result.handled ? "PROCESSED" : "IGNORED",
          processedAt: new Date(),
          safeData: {
            ...event.safeData,
            outcome: result.handled
              ? result.idempotent
                ? "IDEMPOTENT"
                : "PROCESSED"
              : "UNKNOWN_SUBSCRIPTION",
          },
        },
      });
      return {
        accepted: true as const,
        duplicate: result.idempotent,
        ignored: !result.handled,
      };
    } catch (error) {
      await db.paymentProviderEvent.update({
        where: { id: record.id },
        data: { status: "FAILED", processedAt: new Date() },
      });
      throw error;
    }
  }

  if (event.eventType !== "charge.success" || !event.providerReference) {
    await db.paymentProviderEvent.update({
      where: { id: record.id },
      data: { status: "IGNORED", processedAt: new Date() },
    });
    return { accepted: true as const, ignored: true };
  }

  const knownAttempt = await db.paymentAttempt.findUnique({
    where: { providerReference: event.providerReference },
    select: { id: true },
  });
  if (!knownAttempt) {
    await db.paymentProviderEvent.update({
      where: { id: record.id },
      data: {
        status: "IGNORED",
        processedAt: new Date(),
        safeData: { ...event.safeData, outcome: "UNKNOWN_REFERENCE" },
      },
    });
    return { accepted: true as const, ignored: true };
  }

  try {
    const verification = await verifyPaymentByReference(
      event.providerReference,
      { provider },
    );
    await db.paymentProviderEvent.update({
      where: { id: record.id },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
        safeData: { ...event.safeData, outcome: verification.status },
      },
    });
    return { accepted: true as const, duplicate: false };
  } catch (error) {
    await db.paymentProviderEvent.update({
      where: { id: record.id },
      data: {
        status: error instanceof PaymentNotFoundError ? "IGNORED" : "FAILED",
        processedAt: new Date(),
      },
    });
    throw error;
  }
}

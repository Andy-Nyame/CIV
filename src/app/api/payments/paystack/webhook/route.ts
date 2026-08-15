import { NextResponse } from "next/server";

import { PaymentValidationError } from "@/features/payments/errors";
import { processPaystackWebhook } from "@/features/payments/webhook";

export async function POST(request: Request) {
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const signature = request.headers.get("x-paystack-signature");
  try {
    const result = await processPaystackWebhook(rawBody, signature);
    if (!result.accepted) {
      return NextResponse.json({ received: false }, { status: result.status });
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    if (error instanceof PaymentValidationError) {
      return NextResponse.json({ received: false }, { status: 400 });
    }
    return NextResponse.json({ received: false }, { status: 500 });
  }
}

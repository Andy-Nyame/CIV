export class PaymentConfigurationError extends Error {
  constructor() {
    super("Payment services are not configured safely.");
    this.name = "PaymentConfigurationError";
  }
}

export class PaymentProviderError extends Error {
  constructor(message = "The payment provider could not complete the request.") {
    super(message);
    this.name = "PaymentProviderError";
  }
}

export class PaymentValidationError extends Error {
  constructor(message = "Payment information is invalid.") {
    super(message);
    this.name = "PaymentValidationError";
  }
}

export class PaymentAuthorizationError extends Error {
  constructor() {
    super("You are not authorized to access this payment.");
    this.name = "PaymentAuthorizationError";
  }
}

export class PaymentNotFoundError extends Error {
  constructor() {
    super("Payment could not be found.");
    this.name = "PaymentNotFoundError";
  }
}

export class PaymentVerificationError extends Error {
  constructor(message = "Payment verification did not match CIV's records.") {
    super(message);
    this.name = "PaymentVerificationError";
  }
}

export class DocumentCreditPaymentError extends Error {
  constructor(
    public readonly reason:
      | "PACK_UNAVAILABLE"
      | "FREE_PACK"
      | "INITIALIZATION_IN_PROGRESS"
      | "PURCHASE_UNAVAILABLE"
      | "FULFILLMENT_MISMATCH",
  ) {
    super("The document credit purchase could not be completed.");
    this.name = "DocumentCreditPaymentError";
  }
}

export class SubscriptionPaymentError extends Error {
  constructor(
    public readonly reason:
      | "PLAN_UNAVAILABLE"
      | "PLAN_NOT_RECURRING"
      | "PLAN_MAPPING_MISSING"
      | "ACTIVE_SUBSCRIPTION"
      | "CHANGE_IN_PROGRESS"
      | "FULFILLMENT_MISMATCH"
      | "SUBSCRIPTION_UNAVAILABLE"
      | "CANCELLATION_UNAVAILABLE"
      | "DOWNGRADE_BLOCKED",
  ) {
    super("The recurring subscription request could not be completed.");
    this.name = "SubscriptionPaymentError";
  }
}

export type PaymentRefundErrorReason =
  | "PAYMENT_UNAVAILABLE"
  | "PAYMENT_NOT_SUCCEEDED"
  | "PURPOSE_UNSUPPORTED"
  | "AMOUNT_INVALID"
  | "AMOUNT_EXCEEDS_REMAINING"
  | "CURRENCY_MISMATCH"
  | "REFUND_IN_PROGRESS"
  | "CREDIT_PARTIAL_UNSUPPORTED"
  | "CREDITS_ALREADY_USED"
  | "REFUND_UNAVAILABLE"
  | "PROVIDER_MISMATCH"
  | "RECONCILIATION_REVIEW_REQUIRED";

export class PaymentRefundError extends Error {
  constructor(public readonly reason: PaymentRefundErrorReason) {
    super("The refund operation could not be completed.");
    this.name = "PaymentRefundError";
  }
}

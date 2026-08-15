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

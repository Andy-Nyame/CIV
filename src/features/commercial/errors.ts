export class CommercialValidationError extends Error {
  constructor(
    public readonly fieldErrors: Record<string, string[] | undefined> = {},
  ) {
    super("Commercial input is invalid.");
    this.name = "CommercialValidationError";
  }
}

export class CommercialConfigurationError extends Error {
  constructor() {
    super("Commercial configuration is unavailable.");
    this.name = "CommercialConfigurationError";
  }
}

export class CreditAcquisitionUnavailableError extends Error {
  constructor(public readonly reason: "PACK" | "PAID" | "ALREADY_ACQUIRED") {
    super("This document credit pack cannot be acquired.");
    this.name = "CreditAcquisitionUnavailableError";
  }
}

export class InsufficientDocumentCapacityError extends Error {
  constructor() {
    super("This workspace does not have enough document capacity.");
    this.name = "InsufficientDocumentCapacityError";
  }
}

export class DocumentCapacityConsumptionConflictError extends Error {
  constructor() {
    super("This document-capacity operation conflicts with an existing record.");
    this.name = "DocumentCapacityConsumptionConflictError";
  }
}

export class CommercialAuthorizationError extends Error {
  constructor() {
    super("This commercial action is not authorized.");
    this.name = "CommercialAuthorizationError";
  }
}

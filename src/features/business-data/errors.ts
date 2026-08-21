export class BusinessDataValidationError extends Error {
  constructor(public readonly fields: Record<string, string[] | undefined>) {
    super("Business data is invalid.");
    this.name = "BusinessDataValidationError";
  }
}

export class BusinessDataConflictError extends Error {
  constructor(message = "This record changed while you were editing it. Refresh and try again.") {
    super(message);
    this.name = "BusinessDataConflictError";
  }
}

export class PlanValidationError extends Error {
  constructor() {
    super("The requested beta plan is invalid.");
    this.name = "PlanValidationError";
  }
}

export class PlanConfigurationError extends Error {
  constructor() {
    super("The requested beta plan is unavailable.");
    this.name = "PlanConfigurationError";
  }
}

export class PlanDowngradeError extends Error {
  constructor(
    readonly reason: "MEMBERS" | "DOCUMENTS",
    readonly usage: number,
    readonly limit: number,
    readonly planName: string,
  ) {
    super("Current workspace usage exceeds the requested plan limit.");
    this.name = "PlanDowngradeError";
  }
}

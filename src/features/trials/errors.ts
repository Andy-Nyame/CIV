export type TrialEligibilityReason =
  | "DISABLED"
  | "WORKSPACE_ARCHIVED"
  | "ALREADY_ACTIVE"
  | "ALREADY_USED"
  | "NOT_NEW_WORKSPACE"
  | "PAYMENT_METHOD_REQUIRED"
  | "MANUAL_GRANTS_DISABLED"
  | "PLAN_UNAVAILABLE";

export class TrialValidationError extends Error {
  constructor(
    readonly fieldErrors: Record<string, string[] | undefined> = {},
  ) {
    super("Trial input is invalid.");
    this.name = "TrialValidationError";
  }
}

export class TrialConfigurationError extends Error {
  constructor() {
    super("Trial configuration is unavailable.");
    this.name = "TrialConfigurationError";
  }
}

export class TrialIneligibleError extends Error {
  constructor(readonly reason: TrialEligibilityReason) {
    super("This workspace is not eligible for a trial.");
    this.name = "TrialIneligibleError";
  }
}

export class TrialAuthorizationError extends Error {
  constructor() {
    super("This trial action is not authorized.");
    this.name = "TrialAuthorizationError";
  }
}

export class TrialUnavailableError extends Error {
  constructor() {
    super("The active workspace trial is unavailable.");
    this.name = "TrialUnavailableError";
  }
}

export class TeamValidationError extends Error {
  constructor(
    readonly fieldErrors: {
      email?: string[];
      role?: string[];
    },
  ) {
    super("Team input is invalid.");
    this.name = "TeamValidationError";
  }
}

export class InvitationConflictError extends Error {
  constructor(readonly reason: "PENDING" | "MEMBER" | "INACTIVE_MEMBER") {
    super("The invitation conflicts with an existing workspace record.");
    this.name = "InvitationConflictError";
  }
}

export class InvitationUnavailableError extends Error {
  constructor(
    readonly reason:
      | "INVALID"
      | "EXPIRED"
      | "CANCELLED"
      | "ACCEPTED"
      | "EMAIL_MISMATCH",
  ) {
    super("This invitation cannot be used.");
    this.name = "InvitationUnavailableError";
  }
}

export class MemberLimitError extends Error {
  constructor() {
    super("The workspace plan member limit has been reached.");
    this.name = "MemberLimitError";
  }
}

export class SubscriptionConfigurationError extends Error {
  constructor() {
    super("The workspace subscription is unavailable.");
    this.name = "SubscriptionConfigurationError";
  }
}

export class PlatformTeamValidationError extends Error {
  constructor(
    public readonly fieldErrors: Record<string, string[] | undefined>,
  ) {
    super("Platform team input is invalid.");
    this.name = "PlatformTeamValidationError";
  }
}

export class PlatformTeamAuthorizationError extends Error {
  constructor() {
    super("Platform team action is not authorized.");
    this.name = "PlatformTeamAuthorizationError";
  }
}

export class PlatformOwnerProtectionError extends Error {
  constructor() {
    super("The Platform Owner is protected.");
    this.name = "PlatformOwnerProtectionError";
  }
}

export class PlatformInvitationConflictError extends Error {
  constructor(public readonly reason: "MEMBER" | "INACTIVE_MEMBER" | "PENDING") {
    super("Platform invitation conflicts with an existing record.");
    this.name = "PlatformInvitationConflictError";
  }
}

export class PlatformInvitationUnavailableError extends Error {
  constructor(
    public readonly reason:
      | "INVALID"
      | "EXPIRED"
      | "CANCELLED"
      | "ACCEPTED"
      | "EMAIL_MISMATCH",
  ) {
    super("Platform invitation is unavailable.");
    this.name = "PlatformInvitationUnavailableError";
  }
}

export class PlatformAuditValidationError extends Error {
  constructor() {
    super("Platform audit data is invalid.");
    this.name = "PlatformAuditValidationError";
  }
}

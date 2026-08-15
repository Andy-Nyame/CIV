export class PlatformAuthorizationError extends Error {
  constructor() {
    super("Platform access is unavailable.");
    this.name = "PlatformAuthorizationError";
  }
}

export class PlatformOwnerProtectionError extends Error {
  constructor() {
    super("Platform Owner protection prevented this operation.");
    this.name = "PlatformOwnerProtectionError";
  }
}

export class PlatformBootstrapError extends Error {
  constructor(
    readonly reason:
      | "INVALID_ENVIRONMENT"
      | "EMAIL_REQUIRED"
      | "INVALID_EMAIL"
      | "USER_NOT_FOUND"
      | "OWNER_ALREADY_EXISTS"
      | "INCONSISTENT_OWNERS",
  ) {
    super("Platform Owner bootstrap could not be completed.");
    this.name = "PlatformBootstrapError";
  }
}

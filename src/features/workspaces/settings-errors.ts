export class WorkspaceSettingsValidationError extends Error {
  constructor(
    readonly fieldErrors: Record<string, string[] | undefined>,
  ) {
    super("Workspace settings are invalid.");
    this.name = "WorkspaceSettingsValidationError";
  }
}

export class WorkspaceLifecycleError extends Error {
  constructor(
    readonly reason:
      | "OWNER_REQUIRED"
      | "OWNER_CANNOT_LEAVE"
      | "INVALID_TARGET"
      | "ALREADY_ARCHIVED"
      | "NOT_ARCHIVED"
      | "CONFIRMATION_REQUIRED",
  ) {
    super("Workspace lifecycle action is unavailable.");
    this.name = "WorkspaceLifecycleError";
  }
}

export class WorkspaceAssetCleanupError extends Error {
  constructor(readonly objectRestoreFailed = false) {
    super("Workspace asset cleanup could not be completed safely.");
    this.name = "WorkspaceAssetCleanupError";
  }
}

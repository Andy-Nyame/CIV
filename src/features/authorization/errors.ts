export class WorkspaceAuthorizationError extends Error {
  constructor() {
    super("You do not have access to this workspace action.");
    this.name = "WorkspaceAuthorizationError";
  }
}

export class OwnerProtectionError extends Error {
  constructor() {
    super("This change would violate workspace Owner protections.");
    this.name = "OwnerProtectionError";
  }
}

import type { ProfileFieldErrors } from "./types";

export class ProfileValidationError extends Error {
  constructor(readonly fieldErrors: ProfileFieldErrors) {
    super("Profile input is invalid.");
    this.name = "ProfileValidationError";
  }
}

export class IncorrectCurrentPasswordError extends Error {
  constructor() {
    super("Current password verification failed.");
    this.name = "IncorrectCurrentPasswordError";
  }
}

export class StalePasswordUpdateError extends Error {
  constructor() {
    super("Password state changed during the update.");
    this.name = "StalePasswordUpdateError";
  }
}

import { randomBytes } from "node:crypto";

export function createInternalPaymentReference() {
  return `CIV-PAY-${randomBytes(16).toString("hex").toUpperCase()}`;
}

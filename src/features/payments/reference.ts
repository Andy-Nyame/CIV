import { randomBytes } from "node:crypto";

export function createInternalPaymentReference() {
  return `CIV-PAY-${randomBytes(16).toString("hex").toUpperCase()}`;
}

export function createInternalRefundReference() {
  return `CIV-REF-${randomBytes(16).toString("hex").toUpperCase()}`;
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { issuedDocumentSnapshotSchema, type IssuedDocumentSnapshot } from "./snapshots";
import { validateAdjustmentIntegrity } from "./adjustment-integrity";

const taxVersionId = randomUUID();
const statutoryComponents = [
  { code: "NHIL", name: "NHIL", rate: "2.5", order: 1, baseStrategy: "ORIGINAL_BASE" as const },
  { code: "GETFUND", name: "GETFund Levy", rate: "2.5", order: 2, baseStrategy: "ORIGINAL_BASE" as const },
  { code: "VAT", name: "VAT", rate: "15", order: 3, baseStrategy: "ORIGINAL_BASE" as const },
];

type LineInput = {
  subtotal: number;
  treatment?: "STANDARD_RATED" | "ZERO_RATED" | "EXEMPT";
  relieved?: boolean;
  customRate?: { name: string; value: string; amount: number } | null;
};

function line(input: LineInput, order: number) {
  const treatment = input.treatment ?? "STANDARD_RATED";
  const relieved = input.relieved ?? false;
  const taxed = treatment === "STANDARD_RATED" && !relieved;
  const tax = taxed ? Number((input.subtotal * 0.2).toFixed(2)) : 0;
  const customRate = input.customRate ?? null;
  const customAmount = customRate?.amount ?? 0;
  return {
    order,
    description: `Supply ${order}`,
    quantity: "1",
    unitPrice: input.subtotal.toFixed(2),
    subtotal: input.subtotal.toFixed(2),
    unitOfMeasure: "Each",
    originalAmount: input.subtotal.toFixed(2),
    discount: "0.00",
    taxTreatment: treatment,
    taxTreatmentReason: treatment === "STANDARD_RATED" ? null : `${treatment} reason`,
    taxTreatmentReference: treatment === "STANDARD_RATED" ? null : `${treatment}-REF`,
    relief: relieved ? { reason: "Approved transaction relief", reference: "RELIEF-REF" } : null,
    taxableBase: taxed ? input.subtotal.toFixed(2) : "0.00",
    tax: taxed ? {
      amount: tax.toFixed(2),
      components: statutoryComponents.map((component) => ({
        ...component,
        calculationBase: input.subtotal.toFixed(2),
        amount: (input.subtotal * Number(component.rate) / 100).toFixed(2),
      })),
    } : null,
    customRate: customRate ? {
      name: customRate.name,
      type: "PERCENTAGE" as const,
      value: customRate.value,
      amount: customAmount.toFixed(2),
    } : null,
    total: (input.subtotal + tax + customAmount).toFixed(2),
  };
}

function snapshot(input: {
  type?: "VAT_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
  originalId?: string;
  lines: LineInput[];
  id?: string;
}): IssuedDocumentSnapshot {
  const id = input.id ?? randomUUID();
  const lines = input.lines.map((item, index) => line(item, index + 1));
  const subtotal = lines.reduce((sum, item) => sum + Number(item.subtotal), 0);
  const tax = lines.reduce((sum, item) => sum + Number(item.tax?.amount ?? 0), 0);
  const customRates = lines.reduce((sum, item) => sum + Number(item.customRate?.amount ?? 0), 0);
  const grandTotal = subtotal + tax + customRates;
  const type = input.type ?? "VAT_INVOICE";
  return issuedDocumentSnapshotSchema.parse({
    snapshotVersion: 3,
    document: {
      id,
      draftReference: `DRF-${id.slice(0, 12)}`,
      documentNumber: `${type === "CREDIT_NOTE" ? "CRN" : type === "DEBIT_NOTE" ? "DBN" : "VAT"}-000001`,
      type,
      status: "ISSUED",
      currency: "GHS",
      issueDate: "2026-09-12",
      issuedAt: "2026-09-12T12:00:00.000Z",
      dueDate: null,
      notes: null,
      isTestDocument: false,
      supplyDate: "2026-09-12",
      taxPointDate: "2026-09-12",
      supplyDateTime: "2026-09-12T12:00:00.000Z",
      taxPointDateTime: "2026-09-12T12:00:00.000Z",
      transactionType: "SALE",
      receiptType: "COMMERCIAL",
      servicePeriod: null,
      priceMode: "TAX_EXCLUSIVE",
      adjustment: input.originalId ? {
        originalDocumentId: input.originalId,
        originalDocumentNumber: "VAT-000001",
        originalIssueDate: "2026-09-12",
        reason: "Correct the frozen original supply",
        direction: type === "CREDIT_NOTE" ? "REDUCE" : "INCREASE",
        originalSupplyValue: "1000.00",
        adjustedSupplyValue: "900.00",
        difference: subtotal.toFixed(2),
        taxAttributable: tax.toFixed(2),
      } : null,
      fiscalization: null,
    },
    issuer: {
      workspaceId: randomUUID(), displayName: "Issuer", issuerType: "ORGANIZATION", country: "GH", currency: "GHS",
      legalName: "Issuer Ltd", tradingName: null, email: null, phone: null, address: "Accra", registrationNumber: null,
      businessTin: null, taxpayerIdType: "GRA_TIN", taxpayerId: "TIN-TEST", taxpayerVerificationStatus: "UNVERIFIED",
      vatRegistered: true, businessActivity: "BOTH", vatRegistrationStatus: "REGISTERED",
      vatRegistrationEffectiveDate: "2026-01-01", vatDeregistrationEffectiveDate: null, logo: null,
    },
    customer: null,
    lines,
    tax: {
      profile: { jurisdiction: "GH", code: "GH_STANDARD_VAT", name: "Ghana VAT" },
      version: { id: taxVersionId, code: "GH-2026", effectiveFrom: "2026-01-01", effectiveTo: null },
      base: lines.filter((item) => item.tax).reduce((sum, item) => sum + Number(item.subtotal), 0).toFixed(2),
      taxableValue: lines.filter((item) => item.tax).reduce((sum, item) => sum + Number(item.subtotal), 0).toFixed(2),
      taxTotal: tax.toFixed(2),
      grossTotal: (subtotal + tax).toFixed(2),
      components: statutoryComponents.map((component) => ({
        ...component,
        calculationBase: lines.filter((item) => item.tax).reduce((sum, item) => sum + Number(item.subtotal), 0).toFixed(2),
        amount: lines.reduce((sum, item) => sum + Number(item.tax?.components.find(({ code }) => code === component.code)?.amount ?? 0), 0).toFixed(2),
      })),
    },
    totals: {
      subtotal: subtotal.toFixed(2), discount: "0.00", customRates: customRates.toFixed(2),
      taxableValue: lines.filter((item) => item.tax).reduce((sum, item) => sum + Number(item.subtotal), 0).toFixed(2),
      trustedTax: tax.toFixed(2), grandTotal: grandTotal.toFixed(2), originalAmount: subtotal.toFixed(2),
      standardRatedValue: lines.filter((item) => item.taxTreatment === "STANDARD_RATED" && !item.relief).reduce((sum, item) => sum + Number(item.subtotal), 0).toFixed(2),
      zeroRatedValue: lines.filter((item) => item.taxTreatment === "ZERO_RATED").reduce((sum, item) => sum + Number(item.subtotal), 0).toFixed(2),
      exemptValue: lines.filter((item) => item.taxTreatment === "EXEMPT").reduce((sum, item) => sum + Number(item.subtotal), 0).toFixed(2),
      relievedValue: lines.filter((item) => item.relief).reduce((sum, item) => sum + Number(item.subtotal), 0).toFixed(2),
      totalTaxInclusiveValue: (subtotal + tax).toFixed(2), withholding: null, netPayable: grandTotal.toFixed(2),
    },
    payments: [],
    issuedBy: { userId: randomUUID(), displayName: "Issuer" },
    presentation: { template: null, signature: null },
    verification: { code: `CIV-${id.slice(0, 4).toUpperCase()}-AAAA-BBBB` },
  });
}

test("multiple partial credit notes are limited by cumulative frozen subtotal, tax, charge, and total values", () => {
  const original = snapshot({ lines: [{ subtotal: 1000, customRate: { name: "Service Levy", value: "3", amount: 30 } }] });
  const first = snapshot({ type: "CREDIT_NOTE", originalId: original.document.id, lines: [{ subtotal: 300, customRate: { name: "Service Levy", value: "3", amount: 9 } }] });
  const withinRemaining = snapshot({ type: "CREDIT_NOTE", originalId: original.document.id, lines: [{ subtotal: 700, customRate: { name: "Service Levy", value: "3", amount: 21 } }] });
  const overRemaining = snapshot({ type: "CREDIT_NOTE", originalId: original.document.id, lines: [{ subtotal: 700.01, customRate: { name: "Service Levy", value: "3", amount: 21 } }] });

  assert.deepEqual(validateAdjustmentIntegrity({ original, adjustment: withinRemaining, priorIssuedCredits: [first] }), []);
  assert.equal(validateAdjustmentIntegrity({ original, adjustment: overRemaining, priorIssuedCredits: [first] })[0]?.code, "CREDIT_LIMIT_EXCEEDED");
  assert.deepEqual(validateAdjustmentIntegrity({ original, adjustment: withinRemaining, priorIssuedCredits: [] }), [], "a voided prior credit is excluded by omitting it from the issued/non-voided set");
});

test("adjustments retain frozen tax contexts while mixed partial credits and debits remain valid", () => {
  const original = snapshot({ lines: [
    { subtotal: 500 },
    { subtotal: 200, treatment: "ZERO_RATED" },
    { subtotal: 100, treatment: "EXEMPT" },
  ] });
  const mixedCredit = snapshot({ type: "CREDIT_NOTE", originalId: original.document.id, lines: [
    { subtotal: 100 },
    { subtotal: 50, treatment: "ZERO_RATED" },
    { subtotal: 25, treatment: "EXEMPT" },
  ] });
  const debit = snapshot({ type: "DEBIT_NOTE", originalId: original.document.id, lines: [{ subtotal: 600 }] });
  const manufacturedRelief = snapshot({ type: "CREDIT_NOTE", originalId: original.document.id, lines: [{ subtotal: 10, relieved: true }] });
  const standardOnlyOriginal = snapshot({ lines: [{ subtotal: 100 }] });
  const manufacturedTreatment = snapshot({ type: "CREDIT_NOTE", originalId: standardOnlyOriginal.document.id, lines: [{ subtotal: 10, treatment: "ZERO_RATED" }] });
  const originalWithRate = snapshot({ lines: [{ subtotal: 100, customRate: { name: "Service Levy", value: "3", amount: 3 } }] });
  const changedRate = snapshot({ type: "DEBIT_NOTE", originalId: originalWithRate.document.id, lines: [{ subtotal: 10, customRate: { name: "Service Levy", value: "4", amount: 0.4 } }] });

  assert.deepEqual(validateAdjustmentIntegrity({ original, adjustment: mixedCredit }), []);
  assert.deepEqual(validateAdjustmentIntegrity({ original, adjustment: debit }), []);
  assert.equal(validateAdjustmentIntegrity({ original, adjustment: manufacturedRelief })[0]?.code, "ADJUSTMENT_TAX_CONTEXT_INVALID");
  assert.equal(validateAdjustmentIntegrity({ original: standardOnlyOriginal, adjustment: manufacturedTreatment })[0]?.code, "ADJUSTMENT_TAX_CONTEXT_INVALID");
  assert.equal(validateAdjustmentIntegrity({ original: originalWithRate, adjustment: changedRate })[0]?.code, "ADJUSTMENT_TAX_CONTEXT_INVALID");
});

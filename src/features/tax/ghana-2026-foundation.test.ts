import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@/generated/prisma/client";
import { adjustmentEffect, calculateDocumentLine, calculateDraftTotals, calculateNetPayable } from "@/features/documents/calculations";
import { draftInputSchema } from "@/features/documents/validation";
import { workspaceSettingsSchema } from "@/features/workspaces/validation";
import { determineTaxPoint, isVatEligibleAtTaxPoint } from "./eligibility";
import type { TrustedTaxComponent } from "./types";

const components: TrustedTaxComponent[] = [
  { code: "NHIL", name: "NHIL", rate: "2.5", calculationOrder: 1, baseStrategy: "ORIGINAL_BASE", contributesToTaxableValue: false, contributesToTotal: true },
  { code: "GETFUND", name: "GETFund Levy", rate: "2.5", calculationOrder: 2, baseStrategy: "ORIGINAL_BASE", contributesToTaxableValue: false, contributesToTotal: true },
  { code: "VAT", name: "VAT", rate: "15", calculationOrder: 3, baseStrategy: "ORIGINAL_BASE", contributesToTaxableValue: false, contributesToTotal: true },
];

const standard = (overrides: Partial<Parameters<typeof calculateDocumentLine>[0]> = {}) => calculateDocumentLine({
  description: "Supply", quantity: "1", unitPrice: "1000", taxTreatment: "STANDARD_RATED",
  supplierVatEligible: true, statutoryComponents: components, priceMode: "TAX_EXCLUSIVE", ...overrides,
});

test("Ghana 2026 standard-rated exclusive calculation uses one non-cascading base", () => {
  const line = standard();
  assert.equal(line.lineSubtotal.toFixed(2), "1000.00");
  assert.deepEqual(line.taxComponents.map(({ code, calculationBase, amount }) => [code, calculationBase, amount]), [
    ["NHIL", "1000.00", "25.00"], ["GETFUND", "1000.00", "25.00"], ["VAT", "1000.00", "150.00"],
  ]);
  assert.equal(line.taxTotal.toFixed(2), "200.00");
  assert.equal(line.lineTotal.toFixed(2), "1200.00");
});

test("supplier VAT eligibility respects status and registration/deregistration boundaries", () => {
  const registered = { vatRegistrationStatus: "REGISTERED" as const, vatRegistrationEffectiveDate: "2026-06-01", vatDeregistrationEffectiveDate: null };
  assert.equal(isVatEligibleAtTaxPoint(registered, "2026-05-31"), false);
  assert.equal(isVatEligibleAtTaxPoint(registered, "2026-06-01"), true);
  assert.equal(isVatEligibleAtTaxPoint({ ...registered, vatRegistrationStatus: "PENDING" }, "2026-06-01"), false);
  assert.equal(isVatEligibleAtTaxPoint({ ...registered, vatRegistrationStatus: "NOT_REGISTERED" }, "2026-06-01"), false);
  const deregistered = { vatRegistrationStatus: "DEREGISTERED" as const, vatRegistrationEffectiveDate: "2026-01-01", vatDeregistrationEffectiveDate: "2026-07-01" };
  assert.equal(isVatEligibleAtTaxPoint(deregistered, "2026-06-30"), true);
  assert.equal(isVatEligibleAtTaxPoint(deregistered, "2026-07-01"), false);
  assert.equal(determineTaxPoint({ supplyDate: "2026-06-02", documentDate: "2026-06-05" }), "2026-06-02");
});

test("non-registered and pending suppliers never collect VAT-family tax", () => {
  for (const supplierVatEligible of [false]) {
    const line = standard({ supplierVatEligible });
    assert.equal(line.taxTotal.toFixed(2), "0.00");
    assert.equal(line.lineTotal.toFixed(2), "1000.00");
  }
});

test("zero-rated, exempt, and deliberately relieved lines carry no VAT-family tax", () => {
  const cases = [
    standard({ taxTreatment: "ZERO_RATED" }),
    standard({ taxTreatment: "EXEMPT" }),
    standard({ reliefApplied: true }),
  ];
  for (const line of cases) {
    assert.equal(line.taxTotal.toFixed(2), "0.00");
    assert.equal(line.taxableBase.toFixed(2), "0.00");
  }
});

test("mixed documents aggregate only eligible line bases and preserve category values", () => {
  const totals = calculateDraftTotals([
    standard(),
    standard({ unitPrice: "200", taxTreatment: "ZERO_RATED" }),
    standard({ unitPrice: "300", taxTreatment: "EXEMPT" }),
    standard({ unitPrice: "400", reliefApplied: true }),
  ]);
  assert.equal(totals.standardRatedValue.toFixed(2), "1000.00");
  assert.equal(totals.zeroRatedValue.toFixed(2), "200.00");
  assert.equal(totals.exemptValue.toFixed(2), "300.00");
  assert.equal(totals.relievedValue.toFixed(2), "400.00");
  assert.equal(totals.taxTotal.toFixed(2), "200.00");
  assert.equal(totals.grandTotal.toFixed(2), "2100.00");
});

test("tax-inclusive prices extract instead of adding the combined tax", () => {
  const line = standard({ unitPrice: "1200", priceMode: "TAX_INCLUSIVE" });
  assert.equal(line.lineSubtotal.toFixed(2), "1000.00");
  assert.deepEqual(line.taxComponents.map(({ amount }) => amount), ["25.00", "25.00", "150.00"]);
  assert.equal(line.lineTotal.toFixed(2), "1200.00");
});

test("discounts reduce the base before exclusive and inclusive tax", () => {
  const exclusive = standard({ discountAmount: "100" });
  assert.equal(exclusive.lineSubtotal.toFixed(2), "900.00");
  assert.equal(exclusive.taxTotal.toFixed(2), "180.00");
  assert.equal(exclusive.lineTotal.toFixed(2), "1080.00");
  const inclusive = standard({ unitPrice: "1200", discountAmount: "120", priceMode: "TAX_INCLUSIVE" });
  assert.equal(inclusive.lineSubtotal.toFixed(2), "900.00");
  assert.equal(inclusive.taxTotal.toFixed(2), "180.00");
  assert.equal(inclusive.lineTotal.toFixed(2), "1080.00");
});

test("quantities, fractional values, rounding, and reconciliation are deterministic", () => {
  const line = standard({ quantity: "2.5", unitPrice: "19.99" });
  assert.equal(line.originalAmount.toFixed(2), "49.98");
  assert.equal(line.lineTotal.eq(line.lineSubtotal.add(line.taxTotal).add(line.rateTotal)), true);
  const inclusiveCent = standard({ unitPrice: "100", priceMode: "TAX_INCLUSIVE" });
  assert.equal(inclusiveCent.lineTotal.toFixed(2), "100.00");
  assert.equal(inclusiveCent.lineSubtotal.add(inclusiveCent.taxTotal).toFixed(2), "100.00");
});

test("custom rates remain explicit non-VAT charges regardless of supplier VAT state", () => {
  const eligible = standard({ rate: { type: "PERCENTAGE", value: "3" } });
  const notRegistered = standard({ supplierVatEligible: false, rate: { type: "PERCENTAGE", value: "3" } });
  assert.equal(eligible.rateTotal.toFixed(2), "30.00");
  assert.equal(eligible.taxTotal.toFixed(2), "200.00");
  assert.equal(notRegistered.rateTotal.toFixed(2), "30.00");
  assert.equal(notRegistered.taxTotal.toFixed(2), "0.00");
});

test("Invoice, Receipt, VAT Invoice, and TEST simulations share the same money engine", () => {
  const results = ["INVOICE", "RECEIPT", "VAT_INVOICE", "TEST"].map(() => standard().lineTotal.toFixed(2));
  assert.deepEqual(results, ["1200.00", "1200.00", "1200.00", "1200.00"]);
});

test("withholding is a settlement credit and adjustment direction never changes output tax", () => {
  const line = standard();
  const settlement = calculateNetPayable(line.lineTotal, true, "50");
  assert.equal(line.taxTotal.toFixed(2), "200.00");
  assert.equal(settlement.netPayable.toFixed(2), "1150.00");
  assert.equal(adjustmentEffect("CREDIT_NOTE", new Prisma.Decimal("1200")).toFixed(2), "-1200.00");
  assert.equal(adjustmentEffect("DEBIT_NOTE", new Prisma.Decimal("1200")).toFixed(2), "1200.00");
});

test("document total invariant is base plus statutory tax plus explicit custom charges", () => {
  const totals = calculateDraftTotals([standard({ discountAmount: "100", rate: { type: "FIXED", value: "7.50" } })]);
  assert.equal(totals.grandTotal.eq(totals.subtotal.add(totals.taxTotal).add(totals.rateTotal)), true);
  assert.throws(() => standard({ discountAmount: "1000.01" }));
});

test("VAT registration dates and deliberate non-standard classification evidence are validated", () => {
  const workspaceBase = { name: "Compliant workspace", country: "GH", currency: "GHS", email: null, phone: null, address: null, registrationNumber: null };
  assert.equal(workspaceSettingsSchema.safeParse({ ...workspaceBase, vatRegistrationStatus: "REGISTERED" }).success, false);
  assert.equal(workspaceSettingsSchema.safeParse({ ...workspaceBase, vatRegistrationStatus: "REGISTERED", vatRegistrationEffectiveDate: "2026-06-01", businessActivity: "SERVICES" }).success, true);
  assert.equal(workspaceSettingsSchema.safeParse({ ...workspaceBase, vatRegistrationStatus: "DEREGISTERED", vatRegistrationEffectiveDate: "2026-06-01", vatDeregistrationEffectiveDate: "2026-05-31" }).success, false);

  const documentBase = {
    type: "INVOICE",
    customerId: null,
    customerName: "Kwame Mensah",
    currency: "GHS",
    draftDate: "2026-07-10",
    supplyDate: "2026-07-10",
    dueDate: null,
    notes: "",
  };
  assert.equal(draftInputSchema.safeParse({ ...documentBase, lines: [{ catalogItemId: null, customRateId: null, description: "Export", quantity: "1", unitPrice: "100", taxTreatment: "ZERO_RATED", taxTreatmentReason: "Export" }] }).success, false);
  assert.equal(draftInputSchema.safeParse({ ...documentBase, lines: [{ catalogItemId: null, customRateId: null, description: "Export", quantity: "1", unitPrice: "100", taxTreatment: "ZERO_RATED", taxTreatmentReason: "Export", taxTreatmentReference: "EXPORT-001" }] }).success, true);
  assert.equal(draftInputSchema.safeParse({ ...documentBase, lines: [{ catalogItemId: null, customRateId: null, description: "Relieved", quantity: "1", unitPrice: "100", reliefApplied: true, reliefReason: "Relief" }] }).success, false);
});

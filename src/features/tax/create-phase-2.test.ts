import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";

import { BusinessDataValidationError } from "@/features/business-data/errors";
import { createCustomer } from "@/features/customers/service";
import { allocateOfficialDocumentNumber } from "@/features/documents/numbering";
import { validateIssueReadiness } from "@/features/documents/readiness";
import { buildFutureDocumentSnapshot } from "@/features/documents/snapshots";
import { createDraft, updateDraft } from "@/features/documents/service";
import { buildIssueIdempotencyReference, ISSUE_TRANSACTION_STEPS } from "@/features/documents/issue-preparation";
import { createCustomRate, updateCustomRate } from "@/features/rates/service";
import { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { assertGhanaVatStructure, calculateTrustedTax } from "./calculation";
import { calculateDraftLine, calculateDraftTotals } from "@/features/documents/calculations";
import { draftInputSchema } from "@/features/documents/validation";
import { resolveDocumentTaxVersion, resolveGhanaVatVersion } from "./resolver";
import type { TrustedTaxComponent } from "./types";

const components: TrustedTaxComponent[] = [
  { code: "NHIL", name: "National Health Insurance Levy", rate: "2.5", calculationOrder: 10, baseStrategy: "ORIGINAL_BASE", contributesToTaxableValue: false, contributesToTotal: true },
  { code: "GETFUND", name: "GETFund Levy", rate: "2.5", calculationOrder: 20, baseStrategy: "ORIGINAL_BASE", contributesToTaxableValue: false, contributesToTotal: true },
  { code: "VAT", name: "Value Added Tax", rate: "15", calculationOrder: 30, baseStrategy: "ORIGINAL_BASE", contributesToTaxableValue: false, contributesToTotal: true },
];

test("approved Ghana 2026 VAT structure and GHS rounding are exact", () => {
  assert.equal(assertGhanaVatStructure(components), components);
  for (const [base, expected] of [
    ["100.00", { nhil: "2.50", getfund: "2.50", taxable: "100.00", vat: "15.00", gross: "120.00" }],
    ["1000.00", { nhil: "25.00", getfund: "25.00", taxable: "1000.00", vat: "150.00", gross: "1200.00" }],
  ] as const) {
    const result = calculateTrustedTax(base, components);
    assert.equal(result.components.find(({ code }) => code === "NHIL")?.amount, expected.nhil);
    assert.equal(result.components.find(({ code }) => code === "GETFUND")?.amount, expected.getfund);
    assert.equal(result.taxableValue, expected.taxable);
    assert.equal(result.components.find(({ code }) => code === "VAT")?.amount, expected.vat);
    assert.equal(result.grossTotal, expected.gross);
  }
  const pesewa = calculateTrustedTax("99.99", components);
  assert.deepEqual(pesewa.components.map(({ amount }) => amount), ["2.50", "2.50", "15.00"]);
  assert.equal(pesewa.grossTotal, "119.99");
  const fractional = calculateTrustedTax("12.34", components);
  assert.deepEqual(fractional.components.map(({ amount }) => amount), ["0.31", "0.31", "1.85"]);
  assert.equal(fractional.grossTotal, "14.81");
  assert.equal(calculateTrustedTax("0.01", components).grossTotal, "0.01");
  assert.throws(() => calculateTrustedTax("-0.01", components));
  assert.throws(() => calculateTrustedTax("100", [...components, components[0]!]));
  assert.throws(() => assertGhanaVatStructure([...components, { code: "COVID", name: "COVID-19 Health Recovery Levy", rate: "0", calculationOrder: 40, baseStrategy: "ORIGINAL_BASE", contributesToTaxableValue: false, contributesToTotal: true }]));

  const custom = calculateDraftLine({ description: "Custom", quantity: "1", unitPrice: "100", rate: { type: "PERCENTAGE", value: "5" } });
  assert.equal(custom.rateTotal.toFixed(2), "5.00");
  assert.equal(calculateDraftLine({ description: "Rounded", quantity: "1", unitPrice: "99.99", rate: { type: "PERCENTAGE", value: "2.5" } }).rateTotal.toFixed(2), "2.50");
  assert.equal(calculateDraftLine({ description: "Fixed", quantity: "3", unitPrice: "1", rate: { type: "FIXED", value: "0.10" } }).rateTotal.toFixed(2), "0.10");

  const multipleLines = calculateDraftTotals([
    calculateDraftLine({ description: "First", quantity: "2", unitPrice: "19.99", rate: null }),
    calculateDraftLine({ description: "Second", quantity: "1", unitPrice: "10.01", rate: null }),
  ]);
  assert.equal(multipleLines.subtotal.toFixed(2), "49.99");
  assert.equal(multipleLines.discountTotal.toFixed(2), "0.00");
  assert.equal(calculateTrustedTax(multipleLines.subtotal, components).grossTotal, "59.99");

  const vatWithCustomRate = draftInputSchema.safeParse({
    type: "VAT_INVOICE",
    customerId: null,
    customerName: "VAT Test Customer",
    currency: "GHS",
    draftDate: "2026-08-21",
    dueDate: null,
    notes: "",
    lines: [{ catalogItemId: null, customRateId: "00000000-0000-4000-8000-000000000001", description: "Invalid combination", quantity: "1", unitPrice: "100.00" }],
  });
  assert.equal(vatWithCustomRate.success, false);
});

test("non-VAT document types do not resolve Ghana VAT reference data", async () => {
  const unavailableClient = new Proxy({}, {
    get() { throw new Error("Tax data must not be queried."); },
  });
  assert.equal(await resolveDocumentTaxVersion("INVOICE", "2026-08-21", unavailableClient as never), null);
  assert.equal(await resolveDocumentTaxVersion("RECEIPT", "2026-08-21", unavailableClient as never), null);
  await assert.rejects(resolveDocumentTaxVersion("VAT_INVOICE", "2026-08-21", unavailableClient as never));
});

test("effective trusted tax, custom snapshots, readiness, snapshots, numbering, isolation, and zero consumption hold in development Neon", async () => {
  const suffix = randomUUID();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  async function user(label: string) {
    const created = await db.user.create({ data: { name: `Phase 2 ${label}`, email: `phase2-${label}-${suffix}@example.invalid` }, select: { id: true } });
    userIds.push(created.id); return created;
  }
  try {
    const [owner, outsider] = await Promise.all([user("owner"), user("outsider")]);
    const workspace = await db.workspace.create({ data: { name: `Phase 2 ${suffix.slice(0,8)}`, type: "BUSINESS", legalName: `Phase 2 ${suffix.slice(0,8)}`, address: "Accra", taxpayerIdType: "GRA_TIN", taxpayerId: "CIV-TIN-001", businessTin: "CIV-TIN-001", vatRegistered: true, vatRegistrationStatus: "REGISTERED", vatRegistrationEffectiveDate: new Date("2026-01-01T00:00:00.000Z"), memberships: { create: { userId: owner.id, role: "OWNER", status: "ACTIVE" } } }, select: { id: true } });
    const other = await db.workspace.create({ data: { name: `Other ${suffix.slice(0,8)}`, type: "BUSINESS", memberships: { create: { userId: outsider.id, role: "OWNER", status: "ACTIVE" } } }, select: { id: true } });
    workspaceIds.push(workspace.id, other.id);
    const customer = await createCustomer({ actorUserId: owner.id, workspaceId: workspace.id, data: { name: "Tax Customer", email: "tax@example.invalid", phone: "+233200000000", address: "Accra", businessTin: "CUSTOMER-TIN", notes: "" } });
    const rate = await createCustomRate({ actorUserId: owner.id, workspaceId: workspace.id, data: { name: "Service levy", type: "PERCENTAGE", value: "5", description: "Workspace custom rate" } });
    const otherRate = await createCustomRate({ actorUserId: outsider.id, workspaceId: other.id, data: { name: "Other rate", type: "PERCENTAGE", value: "9", description: "" } });
    const capacityBefore = await db.documentCapacityConsumption.count({ where: { workspaceId: workspace.id } });
    const ledgerBefore = await db.documentCreditTransaction.aggregate({ where: { workspaceId: workspace.id }, _sum: { amount: true } });

    const taxVersion = await resolveGhanaVatVersion("2026-08-21");
    assert.equal(taxVersion.profile.code, "STANDARD_VAT");
    assert.deepEqual(taxVersion.components.map(({ code }) => code), ["NHIL", "GETFUND", "VAT"]);
    await assert.rejects(resolveGhanaVatVersion("2025-12-31"));
    const profile = await db.taxProfile.findUniqueOrThrow({ where: { jurisdiction_code: { jurisdiction: "GH", code: "STANDARD_VAT" } } });
    await assert.rejects(db.taxVersion.create({ data: { taxProfileId: profile.id, version: `OVERLAP-${suffix}`, effectiveFrom: new Date("2026-06-01"), effectiveTo: new Date("2026-12-31"), isActive: true } }));

    const ordinary = await createDraft({ actorUserId: owner.id, workspaceId: workspace.id, data: { type: "INVOICE", customerId: customer.id, customerName: customer.name, currency: "GHS", draftDate: "2026-08-21", dueDate: "2026-09-01", notes: "Custom rate", lines: [{ catalogItemId: null, customRateId: rate.id, description: "Service", quantity: "1", unitPrice: "100.00" }] } });
    assert.equal(ordinary.rateTotal.toFixed(2), "5.00");
    assert.equal(ordinary.grandTotal.toFixed(2), "105.00");
    assert.equal(ordinary.taxVersionId, null);
    await updateCustomRate({ actorUserId: owner.id, workspaceId: workspace.id, rateId: rate.id, data: { name: rate.name, type: rate.type, value: "7", description: rate.description ?? "" } });
    const preserved = await updateDraft({ actorUserId: owner.id, workspaceId: workspace.id, documentId: ordinary.id, data: { type: "INVOICE", customerId: customer.id, customerName: customer.name, currency: "GHS", draftDate: "2026-08-21", dueDate: "2026-09-01", notes: "Preserve", lines: [{ id: ordinary.lines[0]!.id, catalogItemId: null, customRateId: rate.id, description: "Service", quantity: "1", unitPrice: "100.00" }] } });
    assert.equal(preserved.rateTotal.toFixed(2), "5.00");
    const noRate = await updateDraft({ actorUserId: owner.id, workspaceId: workspace.id, documentId: ordinary.id, data: { type: "INVOICE", customerId: customer.id, customerName: customer.name, currency: "GHS", draftDate: "2026-08-21", dueDate: "2026-09-01", notes: "Remove", lines: [{ id: preserved.lines[0]!.id, catalogItemId: null, customRateId: null, description: "Service", quantity: "1", unitPrice: "100.00" }] } });
    const reselected = await updateDraft({ actorUserId: owner.id, workspaceId: workspace.id, documentId: ordinary.id, data: { type: "INVOICE", customerId: customer.id, customerName: customer.name, currency: "GHS", draftDate: "2026-08-21", dueDate: "2026-09-01", notes: "Reselect", lines: [{ id: noRate.lines[0]!.id, catalogItemId: null, customRateId: rate.id, description: "Service", quantity: "1", unitPrice: "100.00" }] } });
    assert.equal(reselected.rateTotal.toFixed(2), "7.00");
    await assert.rejects(createDraft({ actorUserId: owner.id, workspaceId: workspace.id, data: { type: "INVOICE", customerId: null, customerName: "Forged Customer", currency: "GHS", draftDate: "2026-08-21", dueDate: null, notes: "", lines: [{ catalogItemId: null, customRateId: otherRate.id, description: "Forged", quantity: "1", unitPrice: "100" }] } }), BusinessDataValidationError);

    const vat = await createDraft({ actorUserId: owner.id, workspaceId: workspace.id, data: { type: "VAT_INVOICE", customerId: customer.id, customerName: customer.name, currency: "GHS", draftDate: "2026-08-21", dueDate: "2026-09-01", notes: "Trusted tax", forgedTaxRate: "1", lines: [{ catalogItemId: null, customRateId: null, description: "Taxable service", quantity: "1", unitPrice: "100.00" }] } });
    assert.equal(vat.taxVersionId, taxVersion.id);
    assert.equal(vat.taxableValue.toFixed(2), "100.00");
    assert.equal(vat.taxTotal.toFixed(2), "20.00");
    assert.equal(vat.grandTotal.toFixed(2), "120.00");
    assert.equal(vat.documentNumber, null);
    await assert.rejects(createDraft({ actorUserId: owner.id, workspaceId: workspace.id, data: { type: "VAT_INVOICE", customerId: customer.id, customerName: customer.name, currency: "USD", draftDate: "2026-08-21", dueDate: null, notes: "", lines: [{ catalogItemId: null, customRateId: null, description: "Invalid currency", quantity: "1", unitPrice: "100" }] } }), BusinessDataValidationError);

    await db.workspace.update({ where: { id: workspace.id }, data: { taxpayerId: null, businessTin: null } });
    const missingTin = await validateIssueReadiness({ actorUserId: owner.id, workspaceId: workspace.id, documentId: vat.id });
    assert.equal(missingTin.ready, false);
    assert.ok(missingTin.errors.some(({ code }) => code === "WORKSPACE_SETUP_INCOMPLETE"));
    await db.workspace.update({ where: { id: workspace.id }, data: { taxpayerId: "CIV-TIN-001", businessTin: "CIV-TIN-001" } });
    const readiness = await validateIssueReadiness({ actorUserId: owner.id, workspaceId: workspace.id, documentId: vat.id });
    assert.equal(readiness.ready, true);
    const snapshot = await buildFutureDocumentSnapshot({ actorUserId: owner.id, workspaceId: workspace.id, documentId: vat.id });
    assert.equal(snapshot.issuer.businessTin, "CIV-TIN-001");
    assert.equal(snapshot.customer?.businessTin, "CUSTOMER-TIN");
    assert.equal(snapshot.lines[0]?.total, "120.00");
    assert.equal(snapshot.totals.grandTotal, "120.00");
    assert.equal(await db.documentSnapshot.count({ where: { documentId: vat.id } }), 0);
    assert.equal(buildIssueIdempotencyReference(vat.id), `civ:document:${vat.id}:issue:v1`);
    assert.deepEqual(ISSUE_TRANSACTION_STEPS, ["VALIDATE_READINESS", "FREEZE_TRUSTED_CALCULATION", "ALLOCATE_OFFICIAL_NUMBER", "CONSUME_DOCUMENT_CAPACITY", "PERSIST_IMMUTABLE_SNAPSHOT", "TRANSITION_TO_ISSUED", "RECORD_ISSUANCE_AUDIT"]);

    // Independent direct connections exercise true PostgreSQL concurrency; the
    // pooled runtime URL is still used by the application itself.
    const connectionString = process.env.DIRECT_URL;
    assert.ok(connectionString);
    const concurrentClients = Array.from({ length: 4 }, () => new PrismaClient({ adapter: new PrismaPg({ connectionString }), transactionOptions: { maxWait: 15_000, timeout: 30_000 } }));
    await Promise.all(concurrentClients.map((client) => client.$connect()));
    let allocated: Awaited<ReturnType<typeof allocateOfficialDocumentNumber>>[];
    try {
      allocated = await Promise.all(concurrentClients.map((client) => client.$transaction((transaction) => allocateOfficialDocumentNumber(transaction, workspace.id, "INVOICE"))));
    } finally {
      await Promise.all(concurrentClients.map((client) => client.$disconnect()));
    }
    assert.equal(new Set(allocated.map(({ documentNumber }) => documentNumber)).size, 4);
    assert.deepEqual(allocated.map(({ sequence }) => Number(sequence)).sort((a,b)=>a-b), Array.from({ length: 4 }, (_, index) => index + 1));
    const receiptNumber = await db.$transaction((transaction) => allocateOfficialDocumentNumber(transaction, workspace.id, "RECEIPT"));
    const vatNumber = await db.$transaction((transaction) => allocateOfficialDocumentNumber(transaction, workspace.id, "VAT_INVOICE"));
    assert.equal(receiptNumber.documentNumber, "REC-000001");
    assert.equal(vatNumber.documentNumber, "VAT-000001");
    const beforeRollback = await db.documentNumberSequence.findUniqueOrThrow({ where: { workspaceId_documentType: { workspaceId: workspace.id, documentType: "INVOICE" } } });
    await assert.rejects(db.$transaction(async (transaction) => { await allocateOfficialDocumentNumber(transaction, workspace.id, "INVOICE"); throw new Error("rollback"); }));
    const afterRollback = await db.documentNumberSequence.findUniqueOrThrow({ where: { workspaceId_documentType: { workspaceId: workspace.id, documentType: "INVOICE" } } });
    assert.equal(afterRollback.currentValue, beforeRollback.currentValue);

    assert.equal(await db.documentCapacityConsumption.count({ where: { workspaceId: workspace.id } }), capacityBefore);
    const ledgerAfter = await db.documentCreditTransaction.aggregate({ where: { workspaceId: workspace.id }, _sum: { amount: true } });
    assert.equal(ledgerAfter._sum.amount ?? 0, ledgerBefore._sum.amount ?? 0);
    assert.equal(await db.document.count({ where: { workspaceId: workspace.id, status: { not: "DRAFT" } } }), 0);
  } finally {
    if (workspaceIds.length) {
      await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentNumberSequence.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.customRate.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.customer.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    assert.equal(await db.platformMembership.count({ where: { role: "PLATFORM_OWNER", status: "ACTIVE" } }), 1);
  }
});

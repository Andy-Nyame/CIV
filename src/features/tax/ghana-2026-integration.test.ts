import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { addUtcMonth } from "@/features/commercial/periods";
import { createCatalogueItem, updateCatalogueItem } from "@/features/catalog/service";
import { createCustomRate } from "@/features/rates/service";
import { createDraft } from "@/features/documents/service";
import { issueDocument } from "@/features/documents/issuance";
import { DocumentIssueReadinessError } from "@/features/documents/issuance";
import { issuedDocumentSnapshotSchema } from "@/features/documents/snapshots";
import { validateIssueReadiness } from "@/features/documents/readiness";
import { voidIssuedDocument } from "@/features/documents/lifecycle";
import { loadDocumentPdfSource } from "@/features/documents/pdf/service";
import { buildPdfPageWarnings } from "@/features/documents/pdf/render";
import { lookupPublicDocumentVerification } from "@/features/documents/verification/service";
import { WorkspaceDocumentReadinessError } from "@/features/workspaces/document-readiness";
import { db } from "@/lib/db";

test("Ghana 2026 mixed supplies, adjustments, withholding, and snapshots persist safely", async () => {
  const suffix = randomUUID();
  const user = await db.user.create({
    data: { name: "Ghana 2026 integration owner", email: `ghana-2026-${suffix}@example.invalid` },
    select: { id: true },
  });
  let workspaceId: string | null = null;

  try {
    const free = await db.plan.findUniqueOrThrow({ where: { code: "FREE" } });
    const periodStart = new Date(Date.now() - 60_000);
    const workspace = await db.workspace.create({
      data: {
        name: `Ghana 2026 ${suffix.slice(0, 8)}`,
        type: "ORGANIZATION",
        businessActivity: "BOTH",
        country: "GH",
        currency: "GHS",
        legalName: "Ghana 2026 Integration Ltd",
        address: "Accra, Ghana",
        taxpayerIdType: "GRA_TIN",
        taxpayerId: `TIN-${suffix.slice(0, 8)}`,
        vatRegistered: true,
        vatRegistrationStatus: "REGISTERED",
        vatRegistrationEffectiveDate: new Date("2026-01-01T00:00:00.000Z"),
        memberships: { create: { userId: user.id, role: "OWNER", status: "ACTIVE" } },
        subscription: { create: { planId: free.id, status: "BETA" } },
        documentAllowancePeriods: { create: { planId: free.id, periodStart, periodEnd: addUtcMonth(periodStart), allowance: free.documentLimit, used: 0 } },
      },
      select: { id: true },
    });
    workspaceId = workspace.id;

    const zeroRatedItem = await createCatalogueItem({
      actorUserId: user.id,
      workspaceId: workspace.id,
      data: {
        name: "Supported export",
        description: "Export supply",
        type: "ITEM",
        unitPrice: "200.00",
        currency: "GHS",
        unitLabel: "Box",
        defaultTaxTreatment: "ZERO_RATED",
        taxTreatmentReason: "Qualifying export supply",
        taxTreatmentReference: "EXPORT-EVIDENCE-001",
        sku: `EXP-${suffix.slice(0, 8)}`,
      },
    });
    const customRate = await createCustomRate({
      actorUserId: user.id,
      workspaceId: workspace.id,
      data: { name: "Service Levy", type: "PERCENTAGE", value: "3", description: "Explicit non-VAT charge" },
    });

    const common = {
      customerId: null,
      customerName: "Kwame Mensah",
      currency: "GHS",
      draftDate: "2026-07-10",
      supplyDate: "2026-07-09",
      dueDate: "2026-08-10",
      transactionType: "SALE",
      priceMode: "TAX_EXCLUSIVE",
      notes: "Ghana 2026 integration fixture",
    } as const;
    const mixed = await createDraft({
      actorUserId: user.id,
      workspaceId: workspace.id,
      data: {
        ...common,
        type: "VAT_INVOICE",
        withholdingApplied: true,
        withholdingAgent: true,
        withholdingAmount: "50.00",
        withholdingReference: "WH-CERT-001",
        withholdingEvidence: "WH-CERT-PDF-001",
        withholdingDate: "2026-07-11",
        paymentEvents: [{ occurredAt: "2026-07-08T15:30", amount: "100.00", method: "Bank transfer", reference: "PAY-001" }],
        lines: [
          { catalogItemId: null, customRateId: customRate.id, description: "Standard service", quantity: "1", unitPrice: "1000.00", unitOfMeasure: "Service", discountAmount: "100.00", taxTreatment: "STANDARD_RATED" },
          // Omit the line override deliberately: the saved item's ZERO_RATED default must be copied to the document line.
          { catalogItemId: zeroRatedItem.id, customRateId: null, description: "Supported export", quantity: "1", unitPrice: "200.00", discountAmount: "0.00" },
          { catalogItemId: null, customRateId: null, description: "Exempt supply", quantity: "1", unitPrice: "100.00", unitOfMeasure: "Each", discountAmount: "0.00", taxTreatment: "EXEMPT", taxTreatmentReason: "Statutory exempt category", taxTreatmentReference: "EXEMPT-CATEGORY-001" },
          { catalogItemId: null, customRateId: null, description: "Relieved supply", quantity: "1", unitPrice: "50.00", unitOfMeasure: "Each", discountAmount: "0.00", taxTreatment: "STANDARD_RATED", reliefApplied: true, reliefReason: "Deliberate transaction relief", reliefReference: "RELIEF-SUPPORT-001" },
        ],
      },
    });

    assert.equal(mixed.subtotal.toFixed(2), "1250.00");
    assert.equal(mixed.standardRatedValue.toFixed(2), "900.00");
    assert.equal(mixed.zeroRatedValue.toFixed(2), "200.00");
    assert.equal(mixed.exemptValue.toFixed(2), "100.00");
    assert.equal(mixed.relievedValue.toFixed(2), "50.00");
    assert.equal(mixed.taxTotal.toFixed(2), "180.00");
    assert.equal(mixed.rateTotal.toFixed(2), "27.00");
    assert.equal(mixed.grandTotal.toFixed(2), "1457.00");
    assert.equal(mixed.netPayable.toFixed(2), "1407.00");
    assert.equal(mixed.lines[1]?.taxTreatment, "ZERO_RATED");
    assert.equal(mixed.lines[1]?.taxTreatmentReference, "EXPORT-EVIDENCE-001");
    assert.equal(mixed.lines[1]?.unitOfMeasure, "Box");

    await assert.rejects(
      issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: mixed.id }),
      (error) => error instanceof DocumentIssueReadinessError && error.errors.some(({ code }) => code === "GRA_FISCALIZATION_ACKNOWLEDGEMENT_REQUIRED"),
    );
    const mixedIssue = await issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: mixed.id, acknowledgeGraRequirement: true });
    const originalPayload = (await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: mixed.id } })).payload;
    const originalSnapshot = structuredClone(issuedDocumentSnapshotSchema.parse(originalPayload));
    assert.equal(originalSnapshot.snapshotVersion, 3);
    assert.equal(originalSnapshot.document.supplyDate, "2026-07-09");
    assert.equal(originalSnapshot.document.taxPointDate, "2026-07-08");
    assert.equal(originalSnapshot.document.taxPointDateTime, "2026-07-08T15:30:00.000Z");
    assert.equal(originalSnapshot.document.fiscalization?.status, "REQUIRES_GRA");
    assert.equal(originalSnapshot.issuer.vatRegistrationStatus, "REGISTERED");
    assert.equal(originalSnapshot.issuer.businessActivity, "BOTH");
    assert.equal(originalSnapshot.customer?.taxStatus, "ORDINARY_CONSUMER");
    assert.equal(originalSnapshot.customer?.taxpayerId, null, "ordinary consumers do not need a taxpayer identity");
    assert.equal(originalSnapshot.lines[0]?.discount, "100.00");
    assert.equal(originalSnapshot.lines[1]?.taxTreatment, "ZERO_RATED");
    assert.equal(originalSnapshot.lines[3]?.relief?.reference, "RELIEF-SUPPORT-001");
    assert.equal(originalSnapshot.totals.withholding?.amount, "50.00");
    assert.equal(originalSnapshot.totals.withholding?.withholdingAgent, true);
    assert.equal(originalSnapshot.totals.withholding?.evidence, "WH-CERT-PDF-001");
    assert.equal(originalSnapshot.payments[0]?.isPartial, true);
    assert.equal(originalSnapshot.totals.trustedTax, "180.00");
    assert.equal(originalSnapshot.totals.netPayable, "1407.00");
    assert.equal(originalSnapshot.verification?.code, mixedIssue.verificationCode);

    const pdfBefore = await loadDocumentPdfSource({ actorUserId: user.id, workspaceId: workspace.id, documentId: mixed.id });
    const pdfAgain = await loadDocumentPdfSource({ actorUserId: user.id, workspaceId: workspace.id, documentId: mixed.id });
    assert.deepEqual(pdfAgain.snapshot, pdfBefore.snapshot);
    assert.equal(await db.documentSnapshot.count({ where: { documentId: mixed.id } }), 1);
    assert.equal((await db.document.findUniqueOrThrow({ where: { id: mixed.id } })).verificationCode, mixedIssue.verificationCode);

    const missingTaxIdentity = await createDraft({
      actorUserId: user.id,
      workspaceId: workspace.id,
      data: {
        ...common,
        type: "VAT_INVOICE",
        customerName: "Taxable Recipient Ltd",
        customerTaxStatus: "TAXABLE_PERSON",
        lines: [{ catalogItemId: null, customRateId: null, description: "Taxable service", quantity: "1", unitPrice: "100.00", taxTreatment: "STANDARD_RATED" }],
      },
    });
    const taxableReadiness = await validateIssueReadiness({ actorUserId: user.id, workspaceId: workspace.id, documentId: missingTaxIdentity.id });
    assert.equal(taxableReadiness.errors.some(({ code }) => code === "CUSTOMER_TAX_IDENTITY_REQUIRED"), true);

    const exemptVatDraft = await createDraft({
      actorUserId: user.id,
      workspaceId: workspace.id,
      data: {
        ...common,
        type: "VAT_INVOICE",
        lines: [{ catalogItemId: null, customRateId: null, description: "Exempt only", quantity: "1", unitPrice: "100.00", discountAmount: "0.00", taxTreatment: "EXEMPT", taxTreatmentReason: "Statutory exempt category", taxTreatmentReference: "EXEMPT-CATEGORY-001" }],
      },
    });
    await assert.rejects(
      issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: exemptVatDraft.id, acknowledgeGraRequirement: true }),
      (error) => error instanceof DocumentIssueReadinessError && error.errors.some(({ code }) => code === "VAT_INVOICE_EXEMPT_ONLY"),
    );

    const unauthorizedVatSalesReceipt = await createDraft({
      actorUserId: user.id,
      workspaceId: workspace.id,
      data: {
        ...common,
        type: "RECEIPT",
        receiptType: "VAT_SALES_RECEIPT",
        lines: [{ catalogItemId: null, customRateId: null, description: "Authorized-receipt path check", quantity: "1", unitPrice: "100.00", taxTreatment: "STANDARD_RATED" }],
      },
    });
    await assert.rejects(
      issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: unauthorizedVatSalesReceipt.id, acknowledgeGraRequirement: true }),
      (error) => error instanceof DocumentIssueReadinessError && error.errors.some(({ code }) => code === "VAT_SALES_RECEIPT_NOT_AUTHORIZED"),
    );

    await db.workspace.update({
      where: { id: workspace.id },
      data: { vatRegistered: false, vatRegistrationStatus: "NOT_REGISTERED", vatSalesReceiptAuthorization: "AUTHORIZED" },
    });
    await updateCatalogueItem({
      actorUserId: user.id,
      workspaceId: workspace.id,
      itemId: zeroRatedItem.id,
      data: { name: zeroRatedItem.name, description: zeroRatedItem.description ?? "", type: zeroRatedItem.type, unitPrice: zeroRatedItem.unitPrice.toString(), currency: zeroRatedItem.currency, unitLabel: zeroRatedItem.unitLabel ?? "", defaultTaxTreatment: "EXEMPT", taxTreatmentReason: "Later mutable classification", taxTreatmentReference: "LATER-REF", sku: zeroRatedItem.sku ?? "" },
    });
    assert.deepEqual(issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: mixed.id } })).payload), originalSnapshot);

    const nonRegisteredReceipt = await createDraft({
      actorUserId: user.id,
      workspaceId: workspace.id,
      data: { ...common, type: "RECEIPT", withholdingApplied: false, withholdingAmount: "0", withholdingReference: "", lines: [{ catalogItemId: null, customRateId: null, description: "Standard classification without VAT collection", quantity: "1", unitPrice: "100.00", discountAmount: "0.00", taxTreatment: "STANDARD_RATED" }] },
    });
    assert.equal(nonRegisteredReceipt.taxTotal.toFixed(2), "0.00");
    assert.equal(nonRegisteredReceipt.grandTotal.toFixed(2), "100.00");
    const ineligibleVatSalesReceipt = await createDraft({
      actorUserId: user.id,
      workspaceId: workspace.id,
      data: { ...common, type: "RECEIPT", receiptType: "VAT_SALES_RECEIPT", lines: [{ catalogItemId: null, customRateId: null, description: "Ineligible VAT sales receipt", quantity: "1", unitPrice: "100.00", taxTreatment: "STANDARD_RATED" }] },
    });
    await assert.rejects(
      issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: ineligibleVatSalesReceipt.id, acknowledgeGraRequirement: true }),
      (error) => error instanceof DocumentIssueReadinessError && error.errors.some(({ code }) => code === "VAT_REGISTRATION_REQUIRED"),
    );
    await assert.rejects(
      createDraft({ actorUserId: user.id, workspaceId: workspace.id, data: { ...common, type: "VAT_INVOICE", lines: [{ catalogItemId: null, customRateId: null, description: "Blocked VAT invoice", quantity: "1", unitPrice: "100.00", discountAmount: "0.00", taxTreatment: "STANDARD_RATED" }] } }),
      WorkspaceDocumentReadinessError,
    );

    const adjustmentBase = {
      ...common,
      originalDocumentId: mixed.id,
      adjustmentReason: "Correct the original supply value",
      withholdingApplied: false,
      withholdingAmount: "0",
      withholdingReference: "",
      lines: [{ catalogItemId: null, customRateId: null, description: "Original standard supply adjustment", quantity: "1", unitPrice: "100.00", unitOfMeasure: "Service", discountAmount: "0.00", taxTreatment: "STANDARD_RATED" }],
    } as const;
    const credit = await createDraft({ actorUserId: user.id, workspaceId: workspace.id, data: { ...adjustmentBase, type: "CREDIT_NOTE" } });
    const debit = await createDraft({ actorUserId: user.id, workspaceId: workspace.id, data: { ...adjustmentBase, type: "DEBIT_NOTE" } });
    assert.equal(credit.taxTotal.toFixed(2), "20.00");
    assert.equal(debit.taxTotal.toFixed(2), "20.00");
    const creditIssue = await issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: credit.id, acknowledgeGraRequirement: true });
    const debitIssue = await issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: debit.id, acknowledgeGraRequirement: true });
    assert.match(creditIssue.documentNumber, /^CRN-\d{6}$/);
    assert.match(debitIssue.documentNumber, /^DBN-\d{6}$/);
    const creditSnapshot = issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: credit.id } })).payload);
    const debitSnapshot = issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: debit.id } })).payload);
    assert.equal(creditSnapshot.document.adjustment?.originalDocumentNumber, mixedIssue.documentNumber);
    assert.equal(creditSnapshot.document.adjustment?.direction, "REDUCE");
    assert.equal(creditSnapshot.document.adjustment?.originalSupplyValue, "1250.00");
    assert.equal(creditSnapshot.document.adjustment?.adjustedSupplyValue, "1150.00");
    assert.equal(creditSnapshot.document.adjustment?.difference, "100.00");
    assert.equal(creditSnapshot.document.adjustment?.taxAttributable, "20.00");
    assert.equal(debitSnapshot.document.adjustment?.direction, "INCREASE");
    assert.equal(creditSnapshot.tax?.components.find(({ code }) => code === "VAT")?.rate, "15");
    assert.deepEqual(issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: mixed.id } })).payload), originalSnapshot);

    const voided = await voidIssuedDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: mixed.id, reason: "Original issued in error; retained for audit." });
    assert.equal(voided.idempotent, false);
    const voidRetry = await voidIssuedDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: mixed.id, reason: "Original issued in error; retained for audit." });
    assert.equal(voidRetry.idempotent, true);
    assert.deepEqual(issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: mixed.id } })).payload), originalSnapshot);
    assert.equal((await lookupPublicDocumentVerification(mixedIssue.verificationCode)).status, "VOID");
    const voidPdf = await loadDocumentPdfSource({ actorUserId: user.id, workspaceId: workspace.id, documentId: mixed.id });
    assert.deepEqual(buildPdfPageWarnings(voidPdf.model), ["VOID — NOT VALID"]);
    assert.equal(voidPdf.model.verificationCode, mixedIssue.verificationCode);
  } finally {
    if (workspaceId) {
      await db.auditEvent.deleteMany({ where: { workspaceId } });
      await db.documentCreditTransaction.deleteMany({ where: { workspaceId } });
      await db.documentCapacityConsumption.deleteMany({ where: { workspaceId } });
      await db.workspaceDocumentAllowancePeriod.deleteMany({ where: { workspaceId } });
      await db.documentSnapshot.deleteMany({ where: { document: { workspaceId } } });
      await db.documentLine.deleteMany({ where: { document: { workspaceId } } });
      await db.document.deleteMany({ where: { workspaceId, originalDocumentId: { not: null } } });
      await db.document.deleteMany({ where: { workspaceId } });
      await db.documentNumberSequence.deleteMany({ where: { workspaceId } });
      await db.workspaceTrial.deleteMany({ where: { workspaceId } });
      await db.customRate.deleteMany({ where: { workspaceId } });
      await db.itemService.deleteMany({ where: { workspaceId } });
      await db.customer.deleteMany({ where: { workspaceId } });
      await db.subscription.deleteMany({ where: { workspaceId } });
      await db.membership.deleteMany({ where: { workspaceId } });
      await db.workspace.deleteMany({ where: { id: workspaceId } });
    }
    await db.user.deleteMany({ where: { id: user.id } });
  }
});

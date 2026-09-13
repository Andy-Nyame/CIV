import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";

import { addUtcMonth } from "@/features/commercial/periods";
import { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { DocumentIssueReadinessError, issueDocument } from "./issuance";
import { voidIssuedDocument } from "./lifecycle";
import { createDraft } from "./service";

test("credit and debit note issuance preserves frozen contexts and cumulative credit capacity under concurrency", async () => {
  const suffix = randomUUID();
  const user = await db.user.create({
    data: { name: "Adjustment integrity owner", email: `adjustment-${suffix}@example.invalid` },
    select: { id: true },
  });
  let workspaceId: string | null = null;
  const raceClients: PrismaClient[] = [];

  try {
    const free = await db.plan.findUniqueOrThrow({ where: { code: "FREE" } });
    const periodStart = new Date(Date.now() - 60_000);
    const workspace = await db.workspace.create({
      data: {
        name: `Adjustment integrity ${suffix.slice(0, 8)}`,
        type: "ORGANIZATION",
        businessActivity: "BOTH",
        country: "GH",
        currency: "GHS",
        legalName: "Adjustment Integrity Ltd",
        address: "Accra, Ghana",
        taxpayerIdType: "GRA_TIN",
        taxpayerId: `TIN-${suffix.slice(0, 8)}`,
        vatRegistered: true,
        vatRegistrationStatus: "REGISTERED",
        vatRegistrationEffectiveDate: new Date("2026-01-01T00:00:00.000Z"),
        memberships: { create: { userId: user.id, role: "OWNER", status: "ACTIVE" } },
        subscription: { create: { planId: free.id, status: "BETA" } },
        documentAllowancePeriods: {
          create: {
            planId: free.id,
            periodStart,
            periodEnd: addUtcMonth(periodStart),
            allowance: free.documentLimit,
            used: 0,
          },
        },
      },
      select: { id: true },
    });
    workspaceId = workspace.id;

    const common = {
      customerId: null,
      customerName: "Adjustment Customer",
      currency: "GHS",
      draftDate: "2026-09-12",
      supplyDate: "2026-09-12T10:00",
      dueDate: "2026-10-12",
      transactionType: "SALE",
      priceMode: "TAX_EXCLUSIVE",
      notes: "Adjustment integrity fixture",
    } as const;
    const standardLine = (amount: string) => ({
      catalogItemId: null,
      customRateId: null,
      description: "Standard-rated original supply",
      quantity: "1",
      unitPrice: amount,
      unitOfMeasure: "Each",
      discountAmount: "0.00",
      taxTreatment: "STANDARD_RATED" as const,
    });
    const zeroRatedLine = (amount: string) => ({
      catalogItemId: null,
      customRateId: null,
      description: "Zero-rated original supply",
      quantity: "1",
      unitPrice: amount,
      unitOfMeasure: "Each",
      discountAmount: "0.00",
      taxTreatment: "ZERO_RATED" as const,
      taxTreatmentReason: "Qualifying zero-rated supply",
      taxTreatmentReference: "ZERO-REF-001",
    });
    const exemptLine = (amount: string) => ({
      catalogItemId: null,
      customRateId: null,
      description: "Exempt original supply",
      quantity: "1",
      unitPrice: amount,
      unitOfMeasure: "Each",
      discountAmount: "0.00",
      taxTreatment: "EXEMPT" as const,
      taxTreatmentReason: "Statutory exempt category",
      taxTreatmentReference: "EXEMPT-REF-001",
    });
    const adjustmentData = (
      originalDocumentId: string,
      type: "CREDIT_NOTE" | "DEBIT_NOTE",
      lines: Array<ReturnType<typeof standardLine> | ReturnType<typeof zeroRatedLine> | ReturnType<typeof exemptLine> | ReturnType<typeof relievedLine>>,
    ) => ({
      ...common,
      type,
      originalDocumentId,
      adjustmentReason: "Correct the affected original supply",
      lines,
    });
    function relievedLine(amount: string) {
      return {
        ...standardLine(amount),
        description: "Manufactured relief context",
        reliefApplied: true,
        reliefReason: "Relief not present on original",
        reliefReference: "RELIEF-INVALID-001",
      };
    }

    const original = await createDraft({
      actorUserId: user.id,
      workspaceId: workspace.id,
      data: {
        ...common,
        type: "VAT_INVOICE",
        lines: [standardLine("500.00"), zeroRatedLine("200.00"), exemptLine("100.00")],
      },
    });
    await issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: original.id, acknowledgeGraRequirement: true });

    const first = await createDraft({ actorUserId: user.id, workspaceId: workspace.id, data: adjustmentData(original.id, "CREDIT_NOTE", [standardLine("200.00")]) });
    const second = await createDraft({ actorUserId: user.id, workspaceId: workspace.id, data: adjustmentData(original.id, "CREDIT_NOTE", [standardLine("200.00")]) });
    await issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: first.id, acknowledgeGraRequirement: true });
    await issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: second.id, acknowledgeGraRequirement: true });

    const overRemaining = await createDraft({ actorUserId: user.id, workspaceId: workspace.id, data: adjustmentData(original.id, "CREDIT_NOTE", [standardLine("150.00")]) });
    await assert.rejects(
      issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: overRemaining.id, acknowledgeGraRequirement: true }),
      (error) => error instanceof DocumentIssueReadinessError && error.errors.some(({ code }) => code === "CREDIT_LIMIT_EXCEEDED"),
    );

    await voidIssuedDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: second.id, reason: "This prior credit was recorded in error." });
    await issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: overRemaining.id, acknowledgeGraRequirement: true });

    const mixedPartial = await createDraft({
      actorUserId: user.id,
      workspaceId: workspace.id,
      data: adjustmentData(original.id, "CREDIT_NOTE", [standardLine("150.00"), zeroRatedLine("50.00"), exemptLine("25.00")]),
    });
    await issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: mixedPartial.id, acknowledgeGraRequirement: true });

    const mismatchedContext = await createDraft({ actorUserId: user.id, workspaceId: workspace.id, data: adjustmentData(original.id, "CREDIT_NOTE", [relievedLine("10.00")]) });
    await assert.rejects(
      issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: mismatchedContext.id, acknowledgeGraRequirement: true }),
      (error) => error instanceof DocumentIssueReadinessError && error.errors.some(({ code }) => code === "ADJUSTMENT_TAX_CONTEXT_INVALID"),
    );

    const debit = await createDraft({ actorUserId: user.id, workspaceId: workspace.id, data: adjustmentData(original.id, "DEBIT_NOTE", [standardLine("600.00")]) });
    const debitIssue = await issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: debit.id, acknowledgeGraRequirement: true });
    assert.match(debitIssue.documentNumber, /^DBN-\d{6}$/);

    const raceOriginal = await createDraft({
      actorUserId: user.id,
      workspaceId: workspace.id,
      data: { ...common, type: "VAT_INVOICE", lines: [standardLine("100.00")] },
    });
    await issueDocument({ actorUserId: user.id, workspaceId: workspace.id, documentId: raceOriginal.id, acknowledgeGraRequirement: true });
    const raceDrafts = [
      await createDraft({ actorUserId: user.id, workspaceId: workspace.id, data: adjustmentData(raceOriginal.id, "CREDIT_NOTE", [standardLine("60.00")]) }),
      await createDraft({ actorUserId: user.id, workspaceId: workspace.id, data: adjustmentData(raceOriginal.id, "CREDIT_NOTE", [standardLine("60.00")]) }),
    ];
    const directUrl = process.env.DIRECT_URL;
    assert.ok(directUrl, "DIRECT_URL is required for adjustment concurrency tests.");
    for (let index = 0; index < 2; index += 1) {
      const client = new PrismaClient({
        adapter: new PrismaPg({ connectionString: directUrl, max: 1, keepAlive: true, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000 }),
        transactionOptions: { maxWait: 15_000, timeout: 45_000 },
      });
      await client.$connect();
      raceClients.push(client);
    }
    const race = await Promise.allSettled(raceDrafts.map((document, index) => issueDocument(
      { actorUserId: user.id, workspaceId: workspace.id, documentId: document.id, acknowledgeGraRequirement: true },
      raceClients[index]!,
    )));
    assert.equal(race.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(race.filter((result) => result.status === "rejected" && result.reason instanceof DocumentIssueReadinessError && result.reason.errors.some(({ code }) => code === "CREDIT_LIMIT_EXCEEDED")).length, 1);
    assert.equal(await db.document.count({ where: { id: { in: raceDrafts.map(({ id }) => id) }, status: "ISSUED" } }), 1);
  } finally {
    for (const client of raceClients) await client.$disconnect();
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
      await db.customer.deleteMany({ where: { workspaceId } });
      await db.subscription.deleteMany({ where: { workspaceId } });
      await db.membership.deleteMany({ where: { workspaceId } });
      await db.workspace.deleteMany({ where: { id: workspaceId } });
    }
    await db.user.deleteMany({ where: { id: user.id } });
  }
});

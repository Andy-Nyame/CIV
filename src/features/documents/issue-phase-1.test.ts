import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";

import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { InsufficientDocumentCapacityError } from "@/features/commercial/errors";
import { addUtcMonth } from "@/features/commercial/periods";
import { createCatalogueItem, updateCatalogueItem } from "@/features/catalog/service";
import { createCustomer, updateCustomer } from "@/features/customers/service";
import { createCustomRate, updateCustomRate } from "@/features/rates/service";
import { db } from "@/lib/db";
import { PrismaClient } from "@/generated/prisma/client";

import { issueDocument } from "./issuance";
import { archiveDraft, createDraft, updateDraft } from "./service";
import { issuedDocumentSnapshotSchema } from "./snapshots";

type FixtureWorkspace = { id: string; ownerId: string; staffId: string };

test("ISSUE Phase 1 is atomic, immutable, authorized, and exactly once under concurrency", async () => {
  const suffix = randomUUID();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const plans = Object.fromEntries((await db.plan.findMany({
    where: { code: { in: ["FREE", "BUSINESS", "ENTERPRISE"] } },
    select: { id: true, code: true, name: true, documentLimit: true, memberLimit: true, features: true },
  })).map((plan) => [plan.code, plan]));
  const free = plans.FREE!;
  const business = plans.BUSINESS!;
  const enterprise = plans.ENTERPRISE!;
  const periodStart = new Date(Date.now() - 60_000);
  const directUrl = process.env.DIRECT_URL;
  assert.ok(directUrl, "DIRECT_URL is required for Neon concurrency tests.");
  const createRaceClients = async (count: number) => {
    const clients = Array.from({ length: count }, () => new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, keepAlive: true, idleTimeoutMillis: 60_000 }), transactionOptions: { maxWait: 15_000, timeout: 45_000 } }));
    await Promise.all(clients.map((client) => client.$connect()));
    return clients;
  };
  const issueWithDirectClient = async (input: Parameters<typeof issueDocument>[0]) => {
    const [client] = await createRaceClients(1);
    try { return await issueDocument(input, client); } finally { await client.$disconnect(); }
  };

  async function user(label: string) {
    const created = await db.user.create({ data: { name: `ISSUE ${label}`, email: `issue-${label}-${suffix}@example.invalid` }, select: { id: true } });
    userIds.push(created.id);
    return created.id;
  }

  async function workspace(label: string, plan = free): Promise<FixtureWorkspace> {
    const ownerId = await user(`${label}-owner`);
    const staffId = await user(`${label}-staff`);
    const created = await db.workspace.create({
      data: {
        name: `ISSUE ${label} ${suffix.slice(0, 8)}`,
        type: "BUSINESS",
        country: "GH",
        currency: "GHS",
        address: "Accra",
        businessTin: `TIN-${suffix.slice(0, 8)}`,
        memberships: { create: [{ userId: ownerId, role: "OWNER", status: "ACTIVE" }, { userId: staffId, role: "STAFF", status: "ACTIVE" }] },
        subscription: { create: { planId: plan.id, status: "BETA" } },
        documentAllowancePeriods: { create: { planId: plan.id, periodStart, periodEnd: addUtcMonth(periodStart), allowance: plan.documentLimit, used: 0 } },
      },
      select: { id: true },
    });
    workspaceIds.push(created.id);
    return { id: created.id, ownerId, staffId };
  }

  function draftData(overrides: Record<string, unknown> = {}) {
    return {
      type: "INVOICE",
      customerId: null,
      currency: "GHS",
      draftDate: "2026-08-21",
      dueDate: "2026-09-21",
      notes: "ISSUE Phase 1 fixture",
      lines: [{ catalogItemId: null, customRateId: null, description: "Professional service", quantity: "1", unitPrice: "100.00" }],
      ...overrides,
    };
  }

  try {
    const monthly = await workspace("monthly");
    const customer = await createCustomer({ actorUserId: monthly.ownerId, workspaceId: monthly.id, data: { name: "Ama Customer", email: "ama@example.invalid", phone: "+233200000000", address: "Osu, Accra", businessTin: "C-TIN-1", notes: "" } });
    const item = await createCatalogueItem({ actorUserId: monthly.ownerId, workspaceId: monthly.id, data: { name: "Consulting", description: "Live catalogue description", type: "SERVICE", unitPrice: "100.00", currency: "GHS", unitLabel: "service", sku: `ISSUE-${suffix.slice(0, 8)}` } });
    const rate = await createCustomRate({ actorUserId: monthly.ownerId, workspaceId: monthly.id, data: { name: "Service fee", type: "PERCENTAGE", value: "5", description: "" } });
    const invoice = await createDraft({ actorUserId: monthly.ownerId, workspaceId: monthly.id, data: draftData({ customerId: customer.id, lines: [{ catalogItemId: item.id, customRateId: rate.id, description: "Consulting", quantity: "1", unitPrice: "100.00" }] }) });

    const first = await issueWithDirectClient({ actorUserId: monthly.ownerId, workspaceId: monthly.id, documentId: invoice.id });
    assert.match(first.documentNumber, /^INV-\d{6}$/);
    assert.equal(first.idempotent, false);
    const retry = await issueWithDirectClient({ actorUserId: monthly.ownerId, workspaceId: monthly.id, documentId: invoice.id });
    assert.equal(retry.documentNumber, first.documentNumber);
    assert.equal(retry.snapshotId, first.snapshotId);
    assert.equal(retry.capacityConsumptionId, first.capacityConsumptionId);
    assert.equal(retry.idempotent, true);
    const issued = await db.document.findUniqueOrThrow({ where: { id: invoice.id }, include: { snapshot: true, capacityConsumption: true } });
    assert.equal(issued.status, "ISSUED");
    assert.equal(issued.issuedByUserId, monthly.ownerId);
    assert.equal(issued.issueDate?.toISOString().slice(0, 10), "2026-08-21");
    assert.equal(issued.documentNumber, first.documentNumber);
    assert.ok(issued.issuedAt && issued.snapshot && issued.capacityConsumption);
    const originalSnapshot = structuredClone(issuedDocumentSnapshotSchema.parse(issued.snapshot.payload));
    assert.equal(originalSnapshot.customer?.name, "Ama Customer");
    assert.equal(originalSnapshot.issuer.displayName.startsWith("ISSUE monthly"), true);
    assert.equal(originalSnapshot.lines[0]?.customRate?.name, "Service fee");
    assert.equal(await db.documentSnapshot.count({ where: { documentId: invoice.id } }), 1);
    assert.equal(await db.documentCapacityConsumption.count({ where: { documentId: invoice.id } }), 1);
    assert.equal(await db.auditEvent.count({ where: { workspaceId: monthly.id, action: "DOCUMENT_ISSUED", resourceId: invoice.id } }), 1);
    assert.equal((await db.workspaceDocumentAllowancePeriod.findFirstOrThrow({ where: { workspaceId: monthly.id } })).used, 1);

    await updateCustomer({ actorUserId: monthly.ownerId, workspaceId: monthly.id, customerId: customer.id, data: { name: "Changed Customer", email: "changed@example.invalid", phone: "", address: "Changed address", businessTin: "CHANGED", notes: "" } });
    await updateCatalogueItem({ actorUserId: monthly.ownerId, workspaceId: monthly.id, itemId: item.id, data: { name: "Changed catalogue", description: "Changed", type: "SERVICE", unitPrice: "999.00", currency: "GHS", unitLabel: "service", sku: item.sku ?? "" } });
    await updateCustomRate({ actorUserId: monthly.ownerId, workspaceId: monthly.id, rateId: rate.id, data: { name: "Changed rate", type: "PERCENTAGE", value: "20", description: "" } });
    await db.workspace.update({ where: { id: monthly.id }, data: { name: "Changed workspace", address: "Changed workspace address", businessTin: "CHANGED-TIN" } });
    assert.deepEqual(issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: invoice.id } })).payload), originalSnapshot);
    await assert.rejects(updateDraft({ actorUserId: monthly.ownerId, workspaceId: monthly.id, documentId: invoice.id, data: draftData() }), WorkspaceAuthorizationError);
    await assert.rejects(archiveDraft({ actorUserId: monthly.ownerId, workspaceId: monthly.id, documentId: invoice.id }), WorkspaceAuthorizationError);

    const staffDraft = await createDraft({ actorUserId: monthly.staffId, workspaceId: monthly.id, data: draftData({ type: "RECEIPT" }) });
    await assert.rejects(issueWithDirectClient({ actorUserId: monthly.staffId, workspaceId: monthly.id, documentId: staffDraft.id }), WorkspaceAuthorizationError);
    const outsider = await workspace("outsider");
    await assert.rejects(issueWithDirectClient({ actorUserId: outsider.ownerId, workspaceId: outsider.id, documentId: staffDraft.id }));

    const sameDraft = await createDraft({ actorUserId: monthly.ownerId, workspaceId: monthly.id, data: draftData({ type: "RECEIPT" }) });
    const sameClients = await createRaceClients(4);
    const sameRace = await Promise.all(sameClients.map((client) => issueDocument({ actorUserId: monthly.ownerId, workspaceId: monthly.id, documentId: sameDraft.id }, client)));
    await Promise.all(sameClients.map((client) => client.$disconnect()));
    assert.equal(new Set(sameRace.map((result) => result.documentNumber)).size, 1);
    assert.equal(new Set(sameRace.map((result) => result.snapshotId)).size, 1);
    assert.equal(new Set(sameRace.map((result) => result.capacityConsumptionId)).size, 1);
    assert.equal(await db.auditEvent.count({ where: { action: "DOCUMENT_ISSUED", resourceId: sameDraft.id } }), 1);

    const numberedDrafts = [];
    for (let index = 0; index < 4; index++) numberedDrafts.push(await createDraft({ actorUserId: monthly.ownerId, workspaceId: monthly.id, data: draftData({ notes: `number ${index}` }) }));
    const numberClients = await createRaceClients(4);
    const numbered = await Promise.all(numberedDrafts.map((document, index) => issueDocument({ actorUserId: monthly.ownerId, workspaceId: monthly.id, documentId: document.id }, numberClients[index]!)));
    await Promise.all(numberClients.map((client) => client.$disconnect()));
    const values = numbered.map(({ documentNumber }) => Number(documentNumber.split("-")[1])).sort((a, b) => a - b);
    assert.equal(new Set(values).size, 4);
    assert.deepEqual(values, Array.from({ length: 4 }, (_, index) => values[0]! + index));

    const credit = await workspace("credit");
    await db.workspaceDocumentAllowancePeriod.updateMany({ where: { workspaceId: credit.id }, data: { used: free.documentLimit! } });
    await db.documentCreditTransaction.create({ data: { workspaceId: credit.id, type: "BONUS", amount: 2, source: "ISSUE_TEST", sourceReference: `issue-credit-${suffix}` } });
    const creditDraft = await createDraft({ actorUserId: credit.ownerId, workspaceId: credit.id, data: draftData() });
    const creditIssued = await issueWithDirectClient({ actorUserId: credit.ownerId, workspaceId: credit.id, documentId: creditDraft.id });
    assert.equal(creditIssued.documentNumber, "INV-000001");
    const creditReceipt = await db.documentCapacityConsumption.findUniqueOrThrow({ where: { documentId: creditDraft.id } });
    assert.equal(creditReceipt.monthlyUsed, 0);
    assert.equal(creditReceipt.purchasedUsed, 1);
    assert.equal((await db.documentCreditTransaction.aggregate({ where: { workspaceId: credit.id }, _sum: { amount: true } }))._sum.amount, 1);

    const unlimited = await workspace("unlimited", enterprise);
    await db.documentCreditTransaction.create({ data: { workspaceId: unlimited.id, type: "BONUS", amount: 7, source: "ISSUE_TEST", sourceReference: `issue-unlimited-${suffix}` } });
    const unlimitedDraft = await createDraft({ actorUserId: unlimited.ownerId, workspaceId: unlimited.id, data: draftData() });
    const unlimitedIssued = await issueWithDirectClient({ actorUserId: unlimited.ownerId, workspaceId: unlimited.id, documentId: unlimitedDraft.id });
    assert.equal(unlimitedIssued.documentNumber, "INV-000001");
    const unlimitedReceipt = await db.documentCapacityConsumption.findUniqueOrThrow({ where: { documentId: unlimitedDraft.id } });
    assert.equal(unlimitedReceipt.monthlyUsed, 1);
    assert.equal(unlimitedReceipt.purchasedUsed, 0);
    assert.equal(unlimitedReceipt.purchasedBalanceAfter, 7);
    assert.equal((await db.workspaceDocumentAllowancePeriod.findFirstOrThrow({ where: { workspaceId: unlimited.id } })).allowance, null);

    const trial = await workspace("trial");
    await db.workspaceTrial.create({ data: { workspaceId: trial.id, trialPlanId: business.id, fallbackPlanId: free.id, status: "ACTIVE", startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 86400000), grantSource: "PLATFORM_MANUAL", trialPlanCodeSnapshot: business.code, trialPlanNameSnapshot: business.name, trialMemberLimitSnapshot: business.memberLimit, trialDocumentLimitSnapshot: business.documentLimit, trialFeaturesSnapshot: JSON.parse(JSON.stringify(business.features ?? {})), fallbackPlanCodeSnapshot: free.code, fallbackPlanNameSnapshot: free.name } });
    const trialDraft = await createDraft({ actorUserId: trial.ownerId, workspaceId: trial.id, data: draftData() });
    await issueWithDirectClient({ actorUserId: trial.ownerId, workspaceId: trial.id, documentId: trialDraft.id });
    const trialPeriod = await db.workspaceDocumentAllowancePeriod.findFirstOrThrow({ where: { workspaceId: trial.id } });
    assert.equal(trialPeriod.planId, business.id);
    assert.equal(trialPeriod.allowance, business.documentLimit);
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { workspaceId: trial.id } })).planId, free.id);
    assert.equal((await db.workspaceTrial.findFirstOrThrow({ where: { workspaceId: trial.id } })).status, "ACTIVE");
    const trialIssuedSnapshot = structuredClone((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: trialDraft.id } })).payload);
    await db.workspaceTrial.updateMany({ where: { workspaceId: trial.id, status: "ACTIVE" }, data: { endsAt: new Date(Date.now() - 1_000) } });
    const fallbackDraft = await createDraft({ actorUserId: trial.ownerId, workspaceId: trial.id, data: draftData({ notes: "Post-trial fallback issue" }) });
    await issueWithDirectClient({ actorUserId: trial.ownerId, workspaceId: trial.id, documentId: fallbackDraft.id });
    const fallbackPeriod = await db.workspaceDocumentAllowancePeriod.findFirstOrThrow({ where: { workspaceId: trial.id } });
    assert.equal(fallbackPeriod.planId, free.id);
    assert.equal(fallbackPeriod.allowance, free.documentLimit);
    assert.equal((await db.workspaceTrial.findFirstOrThrow({ where: { workspaceId: trial.id } })).status, "EXPIRED");
    assert.deepEqual((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: trialDraft.id } })).payload, trialIssuedSnapshot);
    assert.equal(await db.auditEvent.count({ where: { workspaceId: trial.id, action: "TRIAL_EXPIRED" } }), 1);

    const exact = await workspace("exact");
    await db.workspaceDocumentAllowancePeriod.updateMany({ where: { workspaceId: exact.id }, data: { used: free.documentLimit! - 1 } });
    const exactDrafts = [await createDraft({ actorUserId: exact.ownerId, workspaceId: exact.id, data: draftData({ notes: "exact 0" }) }), await createDraft({ actorUserId: exact.ownerId, workspaceId: exact.id, data: draftData({ notes: "exact 1" }) })];
    const exactClients = await createRaceClients(2);
    const exactRace = await Promise.allSettled(exactDrafts.map((document, index) => issueDocument({ actorUserId: exact.ownerId, workspaceId: exact.id, documentId: document.id }, exactClients[index]!)));
    await Promise.all(exactClients.map((client) => client.$disconnect()));
    assert.equal(exactRace.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(exactRace.filter((result) => result.status === "rejected" && result.reason instanceof InsufficientDocumentCapacityError).length, 1);
    assert.equal(await db.document.count({ where: { id: { in: exactDrafts.map(({ id }) => id) }, status: "ISSUED" } }), 1);
    assert.equal(await db.documentSnapshot.count({ where: { documentId: { in: exactDrafts.map(({ id }) => id) } } }), 1);
    assert.equal(await db.documentCapacityConsumption.count({ where: { documentId: { in: exactDrafts.map(({ id }) => id) } } }), 1);
    const failed = await db.document.findFirstOrThrow({ where: { id: { in: exactDrafts.map(({ id }) => id) }, status: "DRAFT" } });
    assert.equal(failed.documentNumber, null);

    const vat = await createDraft({ actorUserId: monthly.ownerId, workspaceId: monthly.id, data: draftData({ type: "VAT_INVOICE", customerId: customer.id, lines: [{ catalogItemId: null, customRateId: null, description: "VAT base", quantity: "1", unitPrice: "100.00" }] }) });
    const vatIssued = await issueWithDirectClient({ actorUserId: monthly.ownerId, workspaceId: monthly.id, documentId: vat.id });
    assert.match(vatIssued.documentNumber, /^VAT-\d{6}$/);
    const vatSnapshot = issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: vat.id } })).payload);
    assert.equal(vatSnapshot.tax?.components.find(({ code }) => code === "NHIL")?.amount, "2.50");
    assert.equal(vatSnapshot.tax?.components.find(({ code }) => code === "GETFUND")?.amount, "2.50");
    assert.equal(vatSnapshot.tax?.components.find(({ code }) => code === "VAT")?.amount, "15.75");
    assert.equal(vatSnapshot.tax?.components.find(({ code }) => code === "COVID")?.amount, "0.00");
    assert.equal(vatSnapshot.totals.taxableValue, "105.00");
    assert.equal(vatSnapshot.totals.grandTotal, "120.75");
    const rollbackTaxMutation = new Error("ROLLBACK_TAX_MUTATION");
    await assert.rejects(db.$transaction(async (transaction) => {
      await transaction.taxComponent.updateMany({ where: { taxVersionId: vat.taxVersionId!, code: "VAT" }, data: { rate: "1" } });
      assert.deepEqual(issuedDocumentSnapshotSchema.parse((await transaction.documentSnapshot.findUniqueOrThrow({ where: { documentId: vat.id } })).payload), vatSnapshot);
      throw rollbackTaxMutation;
    }, { maxWait: 10_000, timeout: 30_000 }), (error) => error === rollbackTaxMutation);
    assert.equal((await db.taxComponent.findFirstOrThrow({ where: { taxVersionId: vat.taxVersionId!, code: "VAT" } })).rate.toString(), "15");
    await updateCustomer({ actorUserId: monthly.ownerId, workspaceId: monthly.id, customerId: customer.id, archived: true, data: { name: "Changed Customer", email: "changed@example.invalid", phone: "", address: "Changed address", businessTin: "CHANGED", notes: "" } });
    await updateCatalogueItem({ actorUserId: monthly.ownerId, workspaceId: monthly.id, itemId: item.id, active: false, data: { name: "Changed catalogue", description: "Changed", type: "SERVICE", unitPrice: "999.00", currency: "GHS", unitLabel: "service", sku: item.sku ?? "" } });
    await updateCustomRate({ actorUserId: monthly.ownerId, workspaceId: monthly.id, rateId: rate.id, active: false, data: { name: "Changed rate", type: "PERCENTAGE", value: "20", description: "" } });
    assert.deepEqual(issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: invoice.id } })).payload), originalSnapshot);
  } finally {
    if (workspaceIds.length) {
      await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentCreditTransaction.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentCapacityConsumption.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspaceDocumentAllowancePeriod.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentSnapshot.deleteMany({ where: { document: { workspaceId: { in: workspaceIds } } } });
      await db.documentLine.deleteMany({ where: { document: { workspaceId: { in: workspaceIds } } } });
      await db.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.documentNumberSequence.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspaceTrial.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.customRate.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.itemService.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.customer.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    assert.equal(await db.platformMembership.count({ where: { role: "PLATFORM_OWNER", status: "ACTIVE" } }), 1);
  }
});

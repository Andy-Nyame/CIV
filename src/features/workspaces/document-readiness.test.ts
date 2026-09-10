import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { addUtcMonth } from "@/features/commercial/periods";
import { createDraft } from "@/features/documents/service";
import { issueDocument } from "@/features/documents/issuance";
import { issuedDocumentSnapshotSchema } from "@/features/documents/snapshots";
import { isSuperAdminEmail, SuperAdminAuthorizationError } from "@/features/platform-admin/super-admin";
import { db } from "@/lib/db";

import { createWorkspace } from "./service";
import {
  evaluateWorkspaceDocumentReadiness,
  WorkspaceDocumentReadinessError,
} from "./document-readiness";
import { enableWorkspaceTestMode, updateWorkspaceSettings } from "./settings-service";
import { WorkspaceTestModeError } from "./settings-errors";
import { requireWorkspaceMembership } from "./access";

const baseWorkspace = {
  name: "Readiness workspace",
  type: "INDIVIDUAL" as const,
  environment: "NORMAL" as const,
  legalName: null,
  address: null,
  taxpayerIdType: null,
  taxpayerId: null,
  vatRegistered: false,
};

test("SUPER_ADMIN configuration and Ghana taxpayer readiness policy are explicit", () => {
  assert.equal(isSuperAdminEmail("nyameandy8@gmail.com", ""), true);
  assert.equal(isSuperAdminEmail("NYAMEANDY8@GMAIL.COM", ""), true);
  assert.equal(isSuperAdminEmail("ordinary@example.invalid", ""), false);

  const incomplete = evaluateWorkspaceDocumentReadiness({ workspace: baseWorkspace, isSuperAdmin: false });
  assert.equal(incomplete.ready, false);
  assert.deepEqual(incomplete.issues.map(({ code }) => code), ["LEGAL_NAME_REQUIRED", "ADDRESS_REQUIRED", "TAXPAYER_ID_TYPE_INVALID", "TAXPAYER_ID_REQUIRED"]);
  assert.equal(evaluateWorkspaceDocumentReadiness({ workspace: baseWorkspace, isSuperAdmin: true }).ready, false, "Super Admin must not bypass a NORMAL workspace.");

  const individual = { ...baseWorkspace, legalName: "Ama Mensah", address: "Accra", taxpayerIdType: "GHANA_CARD_PIN" as const, taxpayerId: "GHA-000000000-0" };
  assert.equal(evaluateWorkspaceDocumentReadiness({ workspace: individual, isSuperAdmin: false }).ready, true);
  const organization = { ...individual, type: "ORGANIZATION" as const, taxpayerIdType: "GHANA_CARD_PIN" as const };
  assert.equal(evaluateWorkspaceDocumentReadiness({ workspace: organization, isSuperAdmin: false }).issues.some(({ code }) => code === "TAXPAYER_ID_TYPE_INVALID"), true);
  const readyOrganization = { ...organization, taxpayerIdType: "GRA_TIN" as const };
  assert.equal(evaluateWorkspaceDocumentReadiness({ workspace: readyOrganization, isSuperAdmin: false }).ready, true);
  assert.equal(evaluateWorkspaceDocumentReadiness({ workspace: readyOrganization, documentType: "VAT_INVOICE", isSuperAdmin: false }).issues.some(({ code }) => code === "VAT_REGISTRATION_REQUIRED"), true);

  const testWorkspace = { ...baseWorkspace, environment: "TEST" as const };
  assert.equal(evaluateWorkspaceDocumentReadiness({ workspace: testWorkspace, documentType: "VAT_INVOICE", isSuperAdmin: true }).ready, true);
  assert.equal(evaluateWorkspaceDocumentReadiness({ workspace: testWorkspace, isSuperAdmin: false }).issues[0]?.code, "TEST_WORKSPACE_ACCESS_REQUIRED");
});

test("server guards enforce TEST access, taxpayer setup, VAT eligibility, and immutable test marking", async () => {
  const suffix = randomUUID();
  const previousEmails = process.env.SUPER_ADMIN_EMAILS;
  const superEmail = `civ-super-${suffix}@example.invalid`;
  process.env.SUPER_ADMIN_EMAILS = superEmail;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  const draftData = (type: "INVOICE" | "VAT_INVOICE" = "INVOICE") => ({
    type,
    customerId: null,
    customerName: "Kwame Mensah",
    currency: "GHS",
    draftDate: "2026-09-10",
    dueDate: null,
    notes: "Readiness test",
    lines: [{ catalogItemId: null, customRateId: null, description: "Service", quantity: "1", unitPrice: "100.00" }],
  });

  try {
    const free = await db.plan.findUniqueOrThrow({ where: { code: "FREE" } });
    const superAdmin = await db.user.create({ data: { name: "CIV test super admin", email: superEmail }, select: { id: true } });
    const ordinary = await db.user.create({ data: { name: "CIV ordinary user", email: `ordinary-${suffix}@example.invalid` }, select: { id: true } });
    userIds.push(superAdmin.id, ordinary.id);

    await assert.rejects(
      createWorkspace({ userId: ordinary.id, input: { name: "Forbidden TEST", type: "INDIVIDUAL", environment: "TEST" } }),
      SuperAdminAuthorizationError,
    );

    const periodStart = new Date(Date.now() - 60_000);
    const testWorkspace = await db.workspace.create({
      data: {
        name: `Test workspace ${suffix.slice(0, 8)}`,
        type: "INDIVIDUAL",
        memberships: { create: [
          { userId: superAdmin.id, role: "OWNER", status: "ACTIVE" },
          { userId: ordinary.id, role: "ADMIN", status: "ACTIVE" },
        ] },
        subscription: { create: { planId: free.id, status: "BETA" } },
        documentAllowancePeriods: { create: { planId: free.id, periodStart, periodEnd: addUtcMonth(periodStart), allowance: free.documentLimit, used: 0 } },
      },
      select: { id: true },
    });
    workspaceIds.push(testWorkspace.id);
    await assert.rejects(enableWorkspaceTestMode({ actorUserId: ordinary.id, workspaceId: testWorkspace.id }), WorkspaceTestModeError);
    await enableWorkspaceTestMode({ actorUserId: superAdmin.id, workspaceId: testWorkspace.id });
    const ordinaryMembership = await requireWorkspaceMembership(ordinary.id, testWorkspace.id);
    assert.equal(ordinaryMembership, null);
    const superMembership = await requireWorkspaceMembership(superAdmin.id, testWorkspace.id);
    assert.ok(superMembership);
    const testDraft = await createDraft({ actorUserId: superAdmin.id, workspaceId: testWorkspace.id, data: draftData() }, { autoSaveCustomer: async () => null });
    assert.equal(testDraft.isTestDocument, true);
    await issueDocument({ actorUserId: superAdmin.id, workspaceId: testWorkspace.id, documentId: testDraft.id });
    const testPayload = (await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: testDraft.id } })).payload;
    const testSnapshot = issuedDocumentSnapshotSchema.parse(testPayload);
    assert.equal(testSnapshot.document.isTestDocument, true);
    const historicalPayload = structuredClone(testPayload) as Record<string, unknown>;
    delete (historicalPayload.document as Record<string, unknown>).isTestDocument;
    assert.equal(issuedDocumentSnapshotSchema.parse(historicalPayload).document.isTestDocument, false, "Historical V1 snapshots remain readable without rewriting stored JSON.");

    const normalWorkspace = await db.workspace.create({
      data: {
        name: `Normal workspace ${suffix.slice(0, 8)}`,
        type: "INDIVIDUAL",
        memberships: { create: { userId: superAdmin.id, role: "OWNER", status: "ACTIVE" } },
      },
      select: { id: true, name: true },
    });
    workspaceIds.push(normalWorkspace.id);
    await assert.rejects(
      createDraft({ actorUserId: superAdmin.id, workspaceId: normalWorkspace.id, data: draftData() }),
      WorkspaceDocumentReadinessError,
    );
    const completed = await updateWorkspaceSettings({
      actorUserId: superAdmin.id,
      workspaceId: normalWorkspace.id,
      values: {
        type: "INDIVIDUAL",
        name: normalWorkspace.name,
        country: "GH",
        currency: "GHS",
        email: null,
        phone: null,
        address: "Accra, Ghana",
        legalName: "Kwame Mensah",
        tradingName: null,
        taxpayerId: "GHA-000000000-0",
        vatRegistered: "false",
        registrationNumber: null,
      },
    });
    assert.equal(completed.workspace.taxpayerIdType, "GHANA_CARD_PIN");
    assert.equal(completed.workspace.taxpayerVerificationStatus, "UNVERIFIED");
    const normalDraft = await createDraft({ actorUserId: superAdmin.id, workspaceId: normalWorkspace.id, data: draftData() }, { autoSaveCustomer: async () => null });
    assert.equal(normalDraft.isTestDocument, false);
    await assert.rejects(
      createDraft({ actorUserId: superAdmin.id, workspaceId: normalWorkspace.id, data: draftData("VAT_INVOICE") }),
      (error) => error instanceof WorkspaceDocumentReadinessError && error.issues.some(({ code }) => code === "VAT_REGISTRATION_REQUIRED"),
    );
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
      await db.customer.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (previousEmails === undefined) delete process.env.SUPER_ADMIN_EMAILS;
    else process.env.SUPER_ADMIN_EMAILS = previousEmails;
  }
});

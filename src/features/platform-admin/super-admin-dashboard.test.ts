import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { evaluateWorkspaceDocumentReadiness } from "@/features/workspaces/document-readiness";
import { requireWorkspaceMembership } from "@/features/workspaces/access";
import { createWorkspace } from "@/features/workspaces/service";
import { db } from "@/lib/db";

import { getSuperAdminDashboard, getSuperAdminWorkspaceDetail, maskTaxpayerId } from "./super-admin-dashboard";
import { isSuperAdminEmail, SuperAdminAuthorizationError } from "./super-admin";

test("Super Admin email resolution and taxpayer masking remain explicit", () => {
  assert.equal(isSuperAdminEmail("nyameandy8@gmail.com", ""), true);
  assert.equal(isSuperAdminEmail("NYAMEANDY8@GMAIL.COM", ""), true);
  assert.equal(isSuperAdminEmail("ordinary@example.invalid", ""), false);
  assert.equal(maskTaxpayerId("P0000000123"), "•••••••0123");
  assert.equal(maskTaxpayerId("123"), "••••");
  assert.equal(maskTaxpayerId(null), null);
});

test("Super Admin dashboard services are protected, bounded, safe, and TEST-aware", async (t) => {
  const suffix = randomUUID();
  const previousSuperAdmins = process.env.SUPER_ADMIN_EMAILS;
  const superAdminEmail = `dashboard-super-${suffix}@example.invalid`;
  const taxpayerId = `GRA-${suffix}`;
  process.env.SUPER_ADMIN_EMAILS = superAdminEmail;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  try {
    const superAdmin = await db.user.create({ data: { name: "Dashboard Super Admin", email: superAdminEmail }, select: { id: true } });
    const ordinary = await db.user.create({ data: { name: "Dashboard Ordinary User", email: `dashboard-ordinary-${suffix}@example.invalid` }, select: { id: true } });
    userIds.push(superAdmin.id, ordinary.id);

    const normalWorkspace = await db.workspace.create({
      data: {
        name: `Dashboard Normal ${suffix.slice(0, 8)}`,
        type: "ORGANIZATION",
        environment: "NORMAL",
        legalName: "Dashboard Legal Organization",
        tradingName: "Dashboard Trading Name",
        address: "Accra, Ghana",
        taxpayerIdType: "GRA_TIN",
        taxpayerId,
        taxpayerVerificationStatus: "UNVERIFIED",
        vatRegistered: true,
        memberships: { create: { userId: superAdmin.id, role: "OWNER", status: "ACTIVE" } },
      },
      select: { id: true },
    });
    const testWorkspace = await db.workspace.create({
      data: {
        name: `Dashboard TEST ${suffix.slice(0, 8)}`,
        type: "INDIVIDUAL",
        environment: "TEST",
        memberships: { create: [
          { userId: superAdmin.id, role: "OWNER", status: "ACTIVE" },
          { userId: ordinary.id, role: "ADMIN", status: "ACTIVE" },
        ] },
      },
      select: { id: true },
    });
    workspaceIds.push(normalWorkspace.id, testWorkspace.id);

    await db.document.createMany({ data: [
      {
        workspaceId: normalWorkspace.id,
        createdByUserId: superAdmin.id,
        type: "INVOICE",
        status: "DRAFT",
        draftReference: `ADMIN-DRAFT-${suffix.slice(0, 8)}`,
        customerName: "Dashboard Customer",
        currency: "GHS",
      },
      {
        workspaceId: testWorkspace.id,
        createdByUserId: superAdmin.id,
        issuedByUserId: superAdmin.id,
        type: "VAT_INVOICE",
        status: "ISSUED",
        isTestDocument: true,
        draftReference: `ADMIN-TEST-${suffix.slice(0, 8)}`,
        documentNumber: `VAT-${suffix.slice(0, 8)}`,
        customerName: "TEST Customer",
        currency: "GHS",
        issueDate: new Date("2026-09-10T00:00:00.000Z"),
        issuedAt: new Date("2026-09-10T10:00:00.000Z"),
      },
    ] });

    await t.test("an unauthenticated caller cannot access admin data services", async () => {
      await assert.rejects(getSuperAdminDashboard({ actorUserId: null }), SuperAdminAuthorizationError);
      await assert.rejects(getSuperAdminWorkspaceDetail({ actorUserId: undefined, workspaceId: normalWorkspace.id }), SuperAdminAuthorizationError);
    });

    await t.test("a normal authenticated user cannot access admin data services", async () => {
      await assert.rejects(getSuperAdminDashboard({ actorUserId: ordinary.id }), SuperAdminAuthorizationError);
      await assert.rejects(getSuperAdminWorkspaceDetail({ actorUserId: ordinary.id, workspaceId: normalWorkspace.id }), SuperAdminAuthorizationError);
    });

    await t.test("Super Admin sees real NORMAL, TEST, issued, and test-document information", async () => {
      const dashboard = await getSuperAdminDashboard({ actorUserId: superAdmin.id, page: 1 });
      const normal = dashboard.workspaces.find(({ id }) => id === normalWorkspace.id);
      const testRecord = dashboard.workspaces.find(({ id }) => id === testWorkspace.id);
      assert.ok(normal);
      assert.ok(testRecord);
      assert.equal(normal.environment, "NORMAL");
      assert.equal(normal.taxpayerReady, true);
      assert.equal(testRecord.environment, "TEST");
      assert.equal(testRecord.taxpayerReady, true);
      assert.ok(dashboard.metrics.normalWorkspaces >= 1);
      assert.ok(dashboard.metrics.testWorkspaces >= 1);
      assert.ok(dashboard.metrics.issuedDocuments >= 1);
      assert.ok(dashboard.metrics.testDocuments >= 1);
      assert.equal(dashboard.workspaces.length <= dashboard.pagination.pageSize, true);
      assert.deepEqual(dashboard.system.documentTypes, ["INVOICE", "RECEIPT", "VAT_INVOICE"]);
      assert.match(dashboard.system.applicationEnvironment, /^(Development|Production)$/);
    });

    await t.test("workspace list and detail responses omit secrets and mask taxpayer identifiers", async () => {
      const dashboard = await getSuperAdminDashboard({ actorUserId: superAdmin.id });
      const listPayload = JSON.stringify(dashboard);
      assert.equal(listPayload.includes(taxpayerId), false);
      assert.equal(listPayload.includes("passwordHash"), false);
      assert.equal(listPayload.includes("SUPER_ADMIN_EMAILS"), false);
      assert.equal(listPayload.includes("DATABASE_URL"), false);

      const detail = await getSuperAdminWorkspaceDetail({ actorUserId: superAdmin.id, workspaceId: normalWorkspace.id });
      const detailPayload = JSON.stringify(detail);
      assert.equal(detailPayload.includes(taxpayerId), false);
      assert.equal(detail.workspace.maskedTaxpayerId?.endsWith(taxpayerId.slice(-4)), true);
      assert.equal(detail.workspace.taxpayerIdPresent, true);
      assert.equal(detail.workspace.viewerCanOpen, true);
      assert.equal(detail.workspace.memberships.some(({ user }) => user.id === superAdmin.id), true);
      assert.equal(detail.documentSummary.drafts, 1);
    });

    await t.test("ordinary users cannot use TEST workspace controls or access TEST workspaces", async () => {
      await assert.rejects(
        createWorkspace({ userId: ordinary.id, input: { name: "Forbidden Admin TEST", type: "INDIVIDUAL", environment: "TEST" } }),
        SuperAdminAuthorizationError,
      );
      assert.equal(await requireWorkspaceMembership(ordinary.id, testWorkspace.id), null);
      assert.ok(await requireWorkspaceMembership(superAdmin.id, testWorkspace.id));
    });

    await t.test("Super Admin does not bypass readiness in NORMAL workspaces", () => {
      const incompleteNormal = evaluateWorkspaceDocumentReadiness({
        workspace: {
          name: "Incomplete Normal",
          type: "INDIVIDUAL",
          environment: "NORMAL",
          legalName: null,
          address: null,
          taxpayerIdType: null,
          taxpayerId: null,
          vatRegistered: false,
        },
        documentType: "VAT_INVOICE",
        isSuperAdmin: true,
      });
      assert.equal(incompleteNormal.ready, false);
      assert.equal(incompleteNormal.issues.some(({ code }) => code === "VAT_REGISTRATION_REQUIRED"), true);
      const testReadiness = evaluateWorkspaceDocumentReadiness({
        workspace: {
          name: "Deliberate TEST",
          type: "INDIVIDUAL",
          environment: "TEST",
          legalName: null,
          address: null,
          taxpayerIdType: null,
          taxpayerId: null,
          vatRegistered: false,
        },
        documentType: "VAT_INVOICE",
        isSuperAdmin: true,
      });
      assert.equal(testReadiness.ready, true);
    });
  } finally {
    if (workspaceIds.length) {
      await db.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (previousSuperAdmins === undefined) delete process.env.SUPER_ADMIN_EMAILS;
    else process.env.SUPER_ADMIN_EMAILS = previousSuperAdmins;
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { PDFDocument } from "pdf-lib";

import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { issuedDocumentSnapshotSchema, type IssuedDocumentSnapshot } from "../snapshots";
import { buildDocumentPdfFilename, buildIssuedDocumentPdfModel } from "./model";
import { renderIssuedDocumentPdf, TEST_WARNING } from "./render";
import { DocumentPdfUnavailableError, generateIssuedDocumentPdf, loadIssuedDocumentPdfSource } from "./service";

function snapshotFixture(overrides: {
  documentId?: string;
  type?: "INVOICE" | "RECEIPT" | "VAT_INVOICE";
  isTestDocument?: boolean;
  customerId?: string | null;
  lineCount?: number;
  workspaceId?: string;
} = {}): IssuedDocumentSnapshot {
  const documentId = overrides.documentId ?? randomUUID();
  const type = overrides.type ?? "INVOICE";
  const tax = type === "VAT_INVOICE" ? {
    profile: { jurisdiction: "GH", code: "GH-VAT", name: "Ghana VAT" },
    version: { id: randomUUID(), code: "GH-VAT-2026", effectiveFrom: "2026-01-01", effectiveTo: null },
    base: "100.00",
    taxableValue: "100.00",
    taxTotal: "20.00",
    grossTotal: "120.00",
    components: [
      { code: "NHIL", name: "NHIL", rate: "2.5", order: 1, baseStrategy: "ORIGINAL_BASE" as const, calculationBase: "100.00", amount: "2.50" },
      { code: "GETFUND", name: "GETFund Levy", rate: "2.5", order: 2, baseStrategy: "ORIGINAL_BASE" as const, calculationBase: "100.00", amount: "2.50" },
      { code: "VAT", name: "VAT", rate: "15", order: 3, baseStrategy: "ORIGINAL_BASE" as const, calculationBase: "100.00", amount: "15.00" },
    ],
  } : null;
  const lineCount = overrides.lineCount ?? 1;
  return issuedDocumentSnapshotSchema.parse({
    snapshotVersion: 1,
    document: {
      id: documentId,
      draftReference: `DRAFT-${documentId.slice(0, 8)}`,
      documentNumber: type === "VAT_INVOICE" ? "VAT-000001" : type === "RECEIPT" ? "RCT-000001" : "INV-000001",
      type,
      status: "ISSUED",
      currency: "GHS",
      issueDate: "2026-09-10",
      issuedAt: "2026-09-10T10:00:00.000Z",
      dueDate: type === "RECEIPT" ? null : "2026-10-10",
      notes: "Thank you for your business.",
      isTestDocument: overrides.isTestDocument ?? false,
    },
    issuer: {
      workspaceId: overrides.workspaceId ?? randomUUID(),
      displayName: "Snapshot Trading Name",
      legalName: "Snapshot Legal Name Ltd",
      tradingName: "Snapshot Trading Name",
      issuerType: "ORGANIZATION",
      country: "GH",
      currency: "GHS",
      email: "accounts@example.invalid",
      phone: "+233200000000",
      address: "Snapshot Business Address, Accra",
      registrationNumber: "REG-100",
      businessTin: "LEGACY-TIN",
      taxpayerIdType: "GRA_TIN",
      taxpayerId: "P000000001",
      taxpayerVerificationStatus: "UNVERIFIED",
      vatRegistered: type === "VAT_INVOICE",
      logo: null,
    },
    customer: {
      id: overrides.customerId ?? null,
      name: "Snapshot Customer",
      email: "customer@example.invalid",
      phone: "+233240000000",
      address: "Snapshot Customer Address",
      businessTin: "CUST-TIN",
    },
    lines: Array.from({ length: lineCount }, (_, index) => ({
      order: index + 1,
      description: lineCount > 1 ? `Professional service ${index + 1} with a long description that remains readable across page boundaries` : "Professional service",
      quantity: "1",
      unitPrice: "100.00",
      subtotal: "100.00",
      customRate: null,
      total: "100.00",
    })),
    tax,
    totals: {
      subtotal: "100.00",
      discount: "0.00",
      customRates: "0.00",
      taxableValue: "100.00",
      trustedTax: type === "VAT_INVOICE" ? "20.00" : "0.00",
      grandTotal: type === "VAT_INVOICE" ? "120.00" : "100.00",
    },
    issuedBy: { userId: randomUUID(), displayName: "Issuing Member" },
    presentation: { template: null, signature: null },
    verification: null,
  });
}

test("issued PDF models support Invoice, Receipt, and VAT Invoice without inventing document types", () => {
  assert.equal(buildIssuedDocumentPdfModel(snapshotFixture({ type: "INVOICE" }), false).title, "Invoice");
  assert.equal(buildIssuedDocumentPdfModel(snapshotFixture({ type: "RECEIPT" }), false).title, "Receipt");
  assert.equal(buildIssuedDocumentPdfModel(snapshotFixture({ type: "VAT_INVOICE" }), false).title, "VAT Invoice");
});

test("VAT PDF presentation uses the persisted statutory breakdown without recalculation", () => {
  const model = buildIssuedDocumentPdfModel(snapshotFixture({ type: "VAT_INVOICE" }), false);
  assert.deepEqual(model.tax?.components.map(({ code, amount }) => [code, amount]), [
    ["NHIL", "2.50"],
    ["GETFUND", "2.50"],
    ["VAT", "15.00"],
  ]);
  assert.equal(model.totals.trustedTax, "20.00");
  assert.equal(model.totals.grandTotal, "120.00");
});

test("TEST status is fail-safe when either persisted document flag is true", () => {
  assert.equal(buildIssuedDocumentPdfModel(snapshotFixture({ isTestDocument: true }), false).isTestDocument, true);
  assert.equal(buildIssuedDocumentPdfModel(snapshotFixture({ isTestDocument: false }), true).isTestDocument, true);
  assert.equal(buildIssuedDocumentPdfModel(snapshotFixture({ isTestDocument: false }), false).isTestDocument, false);
});

test("historical snapshots without newer TEST and taxpayer fields remain readable", () => {
  const historical = structuredClone(snapshotFixture()) as unknown as Record<string, unknown>;
  delete (historical.document as Record<string, unknown>).isTestDocument;
  const issuer = historical.issuer as Record<string, unknown>;
  for (const field of ["legalName", "tradingName", "taxpayerIdType", "taxpayerId", "taxpayerVerificationStatus", "vatRegistered"]) delete issuer[field];
  const parsed = issuedDocumentSnapshotSchema.parse(historical);
  const model = buildIssuedDocumentPdfModel(parsed, false);
  assert.equal(model.isTestDocument, false);
  assert.equal(model.issuer.legalName, "Snapshot Trading Name");
  assert.equal(model.issuer.taxpayerId, "LEGACY-TIN");
});

test("PDF rendering produces A4 multi-page output and visible TEST metadata", async () => {
  const model = buildIssuedDocumentPdfModel(snapshotFixture({ isTestDocument: true, lineCount: 45 }), true);
  const bytes = await renderIssuedDocumentPdf(model);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("ascii"), "%PDF-");
  const parsed = await PDFDocument.load(bytes);
  assert.ok(parsed.getPageCount() > 1);
  assert.equal(parsed.getSubject(), TEST_WARNING);
  assert.match(parsed.getTitle() ?? "", /Invoice INV-000001/);
});

test("normal PDFs do not receive TEST warning metadata and filenames are sanitized", async () => {
  const model = buildIssuedDocumentPdfModel(snapshotFixture(), false);
  const parsed = await PDFDocument.load(await renderIssuedDocumentPdf(model));
  assert.equal(parsed.getSubject(), "Issued CIV document");
  assert.equal(buildDocumentPdfFilename({ ...model, number: "INV/001 dangerous\nname" }), "CIV-INVOICE-INV-001-dangerous-name.pdf");
});

test("PDF source authorization is tenant-safe and reads immutable snapshots only", async (t) => {
  const suffix = randomUUID();
  const previousSuperAdmins = process.env.SUPER_ADMIN_EMAILS;
  const superAdminEmail = `pdf-super-${suffix}@example.invalid`;
  process.env.SUPER_ADMIN_EMAILS = superAdminEmail;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  try {
    const owner = await db.user.create({ data: { email: `pdf-owner-${suffix}@example.invalid`, name: "PDF Owner" }, select: { id: true } });
    const staff = await db.user.create({ data: { email: `pdf-staff-${suffix}@example.invalid`, name: "PDF Staff" }, select: { id: true } });
    const outsider = await db.user.create({ data: { email: `pdf-outsider-${suffix}@example.invalid`, name: "PDF Outsider" }, select: { id: true } });
    const superAdmin = await db.user.create({ data: { email: superAdminEmail, name: "PDF Super Admin" }, select: { id: true } });
    userIds.push(owner.id, staff.id, outsider.id, superAdmin.id);

    const workspace = await db.workspace.create({
      data: {
        name: "Mutable Workspace Name",
        type: "ORGANIZATION",
        legalName: "Mutable Workspace Legal Name",
        address: "Mutable Workspace Address",
        taxpayerIdType: "GRA_TIN",
        taxpayerId: "MUTABLE-TIN",
        memberships: { create: [
          { userId: owner.id, role: "OWNER", status: "ACTIVE" },
          { userId: staff.id, role: "STAFF", status: "ACTIVE" },
        ] },
      },
      select: { id: true },
    });
    const outsiderWorkspace = await db.workspace.create({
      data: { name: "Outsider PDF Workspace", type: "INDIVIDUAL", memberships: { create: { userId: outsider.id, role: "OWNER", status: "ACTIVE" } } },
      select: { id: true },
    });
    const testWorkspace = await db.workspace.create({
      data: { name: "PDF TEST Workspace", type: "INDIVIDUAL", environment: "TEST", memberships: { create: [{ userId: superAdmin.id, role: "OWNER", status: "ACTIVE" }, { userId: outsider.id, role: "ADMIN", status: "ACTIVE" }] } },
      select: { id: true },
    });
    workspaceIds.push(workspace.id, outsiderWorkspace.id, testWorkspace.id);

    const customer = await db.customer.create({
      data: { workspaceId: workspace.id, createdByUserId: owner.id, name: "Mutable Customer Name", address: "Mutable Customer Address" },
      select: { id: true },
    });

    async function persistIssuedDocument(args: {
      workspaceId: string;
      creatorId: string;
      isTestDocument: boolean;
      snapshot: IssuedDocumentSnapshot;
      customerId?: string;
    }) {
      return db.document.create({
        data: {
          id: args.snapshot.document.id,
          workspaceId: args.workspaceId,
          createdByUserId: args.creatorId,
          issuedByUserId: args.creatorId,
          customerId: args.customerId,
          customerName: args.snapshot.customer?.name,
          type: args.snapshot.document.type,
          status: "ISSUED",
          isTestDocument: args.isTestDocument,
          draftReference: args.snapshot.document.draftReference,
          documentNumber: args.snapshot.document.documentNumber,
          currency: args.snapshot.document.currency,
          issueDate: new Date(`${args.snapshot.document.issueDate}T00:00:00.000Z`),
          draftDate: new Date(`${args.snapshot.document.issueDate}T00:00:00.000Z`),
          issuedAt: new Date(args.snapshot.document.issuedAt),
          subtotal: args.snapshot.totals.subtotal,
          discountTotal: args.snapshot.totals.discount,
          rateTotal: args.snapshot.totals.customRates,
          taxableValue: args.snapshot.totals.taxableValue,
          taxTotal: args.snapshot.totals.trustedTax,
          grandTotal: args.snapshot.totals.grandTotal,
          snapshot: { create: { snapshotVersion: 1, payload: args.snapshot as unknown as Prisma.InputJsonValue } },
        },
        select: { id: true },
      });
    }

    const normalSnapshot = snapshotFixture({ customerId: customer.id, workspaceId: workspace.id });
    const normalDocument = await persistIssuedDocument({ workspaceId: workspace.id, creatorId: owner.id, isTestDocument: false, snapshot: normalSnapshot, customerId: customer.id });
    const testSnapshot = snapshotFixture({ isTestDocument: true, workspaceId: testWorkspace.id });
    const testDocument = await persistIssuedDocument({ workspaceId: testWorkspace.id, creatorId: superAdmin.id, isTestDocument: true, snapshot: testSnapshot });

    await t.test("an authorized workspace member can load an eligible issued PDF source", async () => {
      const generated = await generateIssuedDocumentPdf({ actorUserId: owner.id, workspaceId: workspace.id, documentId: normalDocument.id });
      assert.equal(generated.model.number, normalSnapshot.document.documentNumber);
      assert.equal(generated.model.customer?.name, "Snapshot Customer");
      assert.equal(Buffer.from(generated.bytes.subarray(0, 5)).toString("ascii"), "%PDF-");
    });

    await t.test("OWN visibility prevents staff from reading another member's issued document", async () => {
      await assert.rejects(
        loadIssuedDocumentPdfSource({ actorUserId: staff.id, workspaceId: workspace.id, documentId: normalDocument.id }),
        (error) => error instanceof DocumentPdfUnavailableError && error.reason === "NOT_FOUND",
      );
    });

    await t.test("another workspace cannot access a guessed document ID", async () => {
      await assert.rejects(
        loadIssuedDocumentPdfSource({ actorUserId: outsider.id, workspaceId: outsiderWorkspace.id, documentId: normalDocument.id }),
        (error) => error instanceof DocumentPdfUnavailableError && error.reason === "NOT_FOUND",
      );
    });

    await t.test("a non-member cannot bypass workspace authorization", async () => {
      await assert.rejects(
        loadIssuedDocumentPdfSource({ actorUserId: outsider.id, workspaceId: workspace.id, documentId: normalDocument.id }),
        WorkspaceAuthorizationError,
      );
    });

    await t.test("invalid and nonexistent document IDs fail without disclosing records", async () => {
      await assert.rejects(
        loadIssuedDocumentPdfSource({ actorUserId: owner.id, workspaceId: workspace.id, documentId: "not-a-document-id" }),
        (error) => error instanceof DocumentPdfUnavailableError && error.reason === "NOT_FOUND",
      );
      await assert.rejects(
        loadIssuedDocumentPdfSource({ actorUserId: owner.id, workspaceId: workspace.id, documentId: randomUUID() }),
        (error) => error instanceof DocumentPdfUnavailableError && error.reason === "NOT_FOUND",
      );
    });

    await t.test("changing live workspace and customer records does not alter issued PDF source data", async () => {
      const before = await loadIssuedDocumentPdfSource({ actorUserId: owner.id, workspaceId: workspace.id, documentId: normalDocument.id });
      await db.workspace.update({ where: { id: workspace.id }, data: { name: "Changed Live Workspace", legalName: "Changed Live Legal Name", address: "Changed Live Address", taxpayerId: "CHANGED" } });
      await db.customer.update({ where: { id: customer.id }, data: { name: "Changed Live Customer", address: "Changed Live Customer Address" } });
      const after = await loadIssuedDocumentPdfSource({ actorUserId: owner.id, workspaceId: workspace.id, documentId: normalDocument.id });
      assert.deepEqual(after.model, before.model);
      assert.equal(after.model.issuer.legalName, "Snapshot Legal Name Ltd");
      assert.equal(after.model.customer?.name, "Snapshot Customer");
    });

    await t.test("TEST PDFs are available only to the Super Admin and cannot lose their marking", async () => {
      const source = await loadIssuedDocumentPdfSource({ actorUserId: superAdmin.id, workspaceId: testWorkspace.id, documentId: testDocument.id });
      assert.equal(source.model.isTestDocument, true);
      assert.match(source.filename, /^CIV-TEST-/);
      const parsedPdf = await PDFDocument.load(await renderIssuedDocumentPdf(source.model));
      assert.equal(parsedPdf.getSubject(), TEST_WARNING);
      await assert.rejects(
        loadIssuedDocumentPdfSource({ actorUserId: outsider.id, workspaceId: testWorkspace.id, documentId: testDocument.id }),
        WorkspaceAuthorizationError,
      );
    });
  } finally {
    if (workspaceIds.length) {
      await db.documentSnapshot.deleteMany({ where: { document: { workspaceId: { in: workspaceIds } } } });
      await db.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.customer.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (previousSuperAdmins === undefined) delete process.env.SUPER_ADMIN_EMAILS;
    else process.env.SUPER_ADMIN_EMAILS = previousSuperAdmins;
  }
});

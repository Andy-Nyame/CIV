import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { issuedDocumentSnapshotSchema, type IssuedDocumentSnapshot } from "../snapshots";
import { buildDocumentPdfFilename, buildDraftDocumentPdfModel, buildIssuedDocumentPdfModel } from "./model";
import { buildPdfPageWarnings, buildPdfTotalRows, DRAFT_WARNING, renderDocumentPdf, renderIssuedDocumentPdf, TEST_WARNING } from "./render";
import {
  DocumentPdfUnavailableError,
  generateDocumentPdf,
  generateIssuedDocumentPdf,
  loadDraftDocumentPdfSource,
  loadIssuedDocumentPdfSource,
  loadPdfLogoImage,
} from "./service";

function snapshotFixture(overrides: {
  documentId?: string;
  type?: "INVOICE" | "RECEIPT" | "VAT_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
  isTestDocument?: boolean;
  customerId?: string | null;
  lineCount?: number;
  workspaceId?: string;
  customRate?: { name: string; type: "PERCENTAGE" | "FIXED"; value: string; amount: string };
  verificationCode?: string | null;
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
      documentNumber: type === "VAT_INVOICE" ? "VAT-000001" : type === "RECEIPT" ? "REC-000001" : type === "CREDIT_NOTE" ? "CRN-000001" : type === "DEBIT_NOTE" ? "DBN-000001" : "INV-000001",
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
      customRate: overrides.customRate ?? null,
      total: overrides.customRate ? `${(100 + Number(overrides.customRate.amount)).toFixed(2)}` : "100.00",
    })),
    tax,
    totals: {
      subtotal: "100.00",
      discount: "0.00",
      customRates: overrides.customRate?.amount ?? "0.00",
      taxableValue: "100.00",
      trustedTax: type === "VAT_INVOICE" ? "20.00" : "0.00",
      grandTotal: type === "VAT_INVOICE" ? "120.00" : overrides.customRate ? `${(100 + Number(overrides.customRate.amount)).toFixed(2)}` : "100.00",
    },
    issuedBy: { userId: randomUUID(), displayName: "Issuing Member" },
    presentation: { template: null, signature: null },
    verification: overrides.verificationCode ? { code: overrides.verificationCode } : null,
  });
}

function draftModelFixture(overrides: Parameters<typeof snapshotFixture>[0] = {}) {
  const snapshot = snapshotFixture(overrides);
  return buildDraftDocumentPdfModel({
    document: {
      draftReference: snapshot.document.draftReference,
      type: snapshot.document.type,
      currency: snapshot.document.currency,
      draftDate: snapshot.document.issueDate,
      dueDate: snapshot.document.dueDate,
      notes: snapshot.document.notes,
      isTestDocument: snapshot.document.isTestDocument,
    },
    issuer: snapshot.issuer,
    customer: snapshot.customer,
    lines: snapshot.lines,
    tax: snapshot.tax,
    totals: snapshot.totals,
    preparedBy: "Draft Author",
  });
}

test("issued PDF models render Invoice, Receipt, and VAT Invoice as one A4 document family", async () => {
  for (const [type, title] of [["INVOICE", "Invoice"], ["RECEIPT", "Receipt"], ["VAT_INVOICE", "VAT Invoice"], ["CREDIT_NOTE", "Credit Note"], ["DEBIT_NOTE", "Debit Note"]] as const) {
    const model = buildIssuedDocumentPdfModel(snapshotFixture({ type }), false);
    assert.equal(model.title, title);
    const pdf = await PDFDocument.load(await renderIssuedDocumentPdf(model));
    assert.equal(pdf.getPageCount(), 1);
    assert.deepEqual(pdf.getPage(0).getSize(), { width: 595.28, height: 841.89 });
  }
});

test("draft PDF models support every current document type without verification identity", () => {
  for (const type of ["INVOICE", "RECEIPT", "VAT_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"] as const) {
    const model = draftModelFixture({ type, verificationCode: "CIV-7K4M-92PX-H6Q2" });
    assert.equal(model.lifecycle, "DRAFT");
    assert.equal(model.title, type === "VAT_INVOICE" ? "VAT Invoice" : type === "RECEIPT" ? "Receipt" : type === "CREDIT_NOTE" ? "Credit Note" : type === "DEBIT_NOTE" ? "Debit Note" : "Invoice");
    assert.equal(model.verificationCode, null);
    assert.match(buildDocumentPdfFilename(model), /^CIV-DRAFT-/);
  }
});

test("draft PDFs are marked on every page and cannot render verification identity", async () => {
  const injectedCode = "CIV-7K4M-92PX-H6Q2";
  const model = { ...draftModelFixture({ lineCount: 45 }), verificationCode: injectedCode };
  assert.deepEqual(buildPdfPageWarnings(model), [DRAFT_WARNING]);
  const bytes = await renderDocumentPdf(model);
  const parsed = await PDFDocument.load(bytes);
  assert.ok(parsed.getPageCount() > 1);
  assert.equal(parsed.getSubject(), DRAFT_WARNING);
  assert.equal((parsed.getKeywords() ?? "").includes(injectedCode), false);
  assert.equal(Buffer.from(bytes).includes(Buffer.from("/Subtype /Image")), false);
  for (const page of parsed.getPages()) assert.deepEqual(page.getSize(), { width: 595.28, height: 841.89 });
});

test("TEST draft PDFs carry both persisted safety warnings", async () => {
  const model = draftModelFixture({ isTestDocument: true });
  assert.deepEqual(buildPdfPageWarnings(model), [TEST_WARNING, DRAFT_WARNING]);
  const parsed = await PDFDocument.load(await renderDocumentPdf(model));
  assert.equal(parsed.getSubject(), `${DRAFT_WARNING} · ${TEST_WARNING}`);
  assert.match(buildDocumentPdfFilename(model), /^CIV-TEST-DRAFT-/);
});

test("workspace logos are checksum-verified, normalized, and optional", async () => {
  const body = await sharp({ create: { width: 80, height: 40, channels: 4, background: "#2563eb" } }).webp().toBuffer();
  const reference = {
    storageKey: "workspaces/test/logo/example.webp",
    mimeType: "image/webp",
    width: 80,
    height: 40,
    checksum: createHash("sha256").update(body).digest("hex"),
  };
  const loaded = await loadPdfLogoImage(reference, async () => ({ body: new Uint8Array(body), contentType: "image/webp" }));
  assert.ok(loaded);
  assert.equal(Buffer.from(loaded).toString("hex", 0, 8), "89504e470d0a1a0a");
  const rendered = await renderDocumentPdf(draftModelFixture(), { logoImage: loaded });
  assert.equal(Buffer.from(rendered).includes(Buffer.from("/Subtype /Image")), true);
  assert.equal(await loadPdfLogoImage({ ...reference, checksum: "0".repeat(64) }, async () => ({ body: new Uint8Array(body), contentType: "image/webp" })), null);
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
  assert.deepEqual(model.appliedRates.map(({ label, amount }) => [label, amount]), [
    ["NHIL (2.5%)", "2.50"],
    ["GETFund Levy (2.5%)", "2.50"],
    ["VAT (15%)", "15.00"],
  ]);
  assert.deepEqual(draftModelFixture({ type: "VAT_INVOICE" }).appliedRates.map(({ label, amount }) => [label, amount]), [
    ["NHIL (2.5%)", "2.50"],
    ["GETFund Levy (2.5%)", "2.50"],
    ["VAT (15%)", "15.00"],
  ]);
});

test("Invoice and Receipt PDFs show an applied custom snapshot rate and omit unapplied rates", () => {
  for (const type of ["INVOICE", "RECEIPT"] as const) {
    const model = buildIssuedDocumentPdfModel(snapshotFixture({
      type,
      customRate: { name: "Service Levy", type: "PERCENTAGE", value: "3.000000", amount: "3.00" },
    }), false);
    assert.deepEqual(model.appliedRates.map(({ label, amount }) => [label, amount]), [["Service Levy (3%)", "3.00"]]);
    assert.equal(model.appliedRates.some(({ name }) => name === "Configured but unused"), false);
    assert.deepEqual(buildPdfTotalRows(model).map(({ label, value }) => [label, value]), [
      ["Subtotal", "100.00"],
      ["Service Levy (3%)", "3.00"],
      ["Grand total", "103.00"],
    ]);
  }
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
  delete historical.verification;
  const parsed = issuedDocumentSnapshotSchema.parse(historical);
  const model = buildIssuedDocumentPdfModel(parsed, false);
  assert.equal(model.isTestDocument, false);
  assert.equal(model.issuer.legalName, "Snapshot Trading Name");
  assert.equal(model.issuer.taxpayerId, "LEGACY-TIN");
  assert.equal(model.verificationCode, null);
});

test("verified PDFs contain the immutable code and a rendered barcode image", async () => {
  const verificationCode = "CIV-7K4M-92PX-H6Q2";
  const model = buildIssuedDocumentPdfModel(snapshotFixture({ verificationCode }), false);
  assert.equal(model.verificationCode, verificationCode);
  const bytes = await renderIssuedDocumentPdf(model);
  const parsed = await PDFDocument.load(bytes);
  assert.match(parsed.getKeywords() ?? "", new RegExp(verificationCode));
  assert.equal(Buffer.from(bytes).includes(Buffer.from("/Subtype /Image")), true);
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
          verificationCode: args.snapshot.verification?.code ?? null,
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

    const mutableRate = await db.customRate.create({
      data: { workspaceId: workspace.id, name: "Mutable live rate", type: "PERCENTAGE", value: "8" },
      select: { id: true },
    });
    const normalSnapshot = snapshotFixture({
      customerId: customer.id,
      workspaceId: workspace.id,
      customRate: { name: "Snapshot Service Levy", type: "PERCENTAGE", value: "3.000000", amount: "3.00" },
      verificationCode: "CIV-7K4M-92PX-H6Q2",
    });
    const normalDocument = await persistIssuedDocument({ workspaceId: workspace.id, creatorId: owner.id, isTestDocument: false, snapshot: normalSnapshot, customerId: customer.id });
    const testSnapshot = snapshotFixture({ isTestDocument: true, workspaceId: testWorkspace.id, verificationCode: "CIV-3N7W-8R5Y-K9QM" });
    const testDocument = await persistIssuedDocument({ workspaceId: testWorkspace.id, creatorId: superAdmin.id, isTestDocument: true, snapshot: testSnapshot });
    const normalDraft = await db.document.create({
      data: {
        workspaceId: workspace.id,
        createdByUserId: owner.id,
        customerId: customer.id,
        customerName: "Saved Draft Customer",
        customerAddress: "Saved Draft Address",
        type: "INVOICE",
        status: "DRAFT",
        draftReference: `DRAFT-PDF-${suffix.slice(0, 12)}`,
        currency: "GHS",
        draftDate: new Date("2026-09-10T00:00:00.000Z"),
        dueDate: new Date("2026-10-10T00:00:00.000Z"),
        subtotal: "100.00",
        rateTotal: "3.00",
        taxableValue: "100.00",
        grandTotal: "103.00",
        lines: { create: {
          description: "Saved draft professional service",
          quantity: "1",
          unitPrice: "100.00",
          lineSubtotal: "100.00",
          rateNameSnapshot: "Draft Service Levy",
          rateTypeSnapshot: "PERCENTAGE",
          rateValueSnapshot: "3",
          rateTotal: "3.00",
          lineTotal: "103.00",
          lineOrder: 1,
        } },
      },
      select: { id: true },
    });
    const testDraft = await db.document.create({
      data: {
        workspaceId: testWorkspace.id,
        createdByUserId: superAdmin.id,
        customerName: "TEST Draft Customer",
        type: "RECEIPT",
        status: "DRAFT",
        isTestDocument: true,
        draftReference: `DRAFT-TEST-${suffix.slice(0, 12)}`,
        currency: "GHS",
        draftDate: new Date("2026-09-10T00:00:00.000Z"),
        subtotal: "50.00",
        taxableValue: "50.00",
        grandTotal: "50.00",
        lines: { create: {
          description: "TEST draft service",
          quantity: "1",
          unitPrice: "50.00",
          lineSubtotal: "50.00",
          lineTotal: "50.00",
          lineOrder: 1,
        } },
      },
      select: { id: true },
    });

    await t.test("an authorized workspace member can load an eligible issued PDF source", async () => {
      const generated = await generateIssuedDocumentPdf({ actorUserId: owner.id, workspaceId: workspace.id, documentId: normalDocument.id });
      assert.equal(generated.model.number, normalSnapshot.document.documentNumber);
      assert.equal(generated.model.customer?.name, "Snapshot Customer");
      assert.equal(Buffer.from(generated.bytes.subarray(0, 5)).toString("ascii"), "%PDF-");
    });

    await t.test("an authorized creator can generate a saved draft PDF without verification", async () => {
      const source = await loadDraftDocumentPdfSource({ actorUserId: owner.id, workspaceId: workspace.id, documentId: normalDraft.id });
      assert.equal(source.lifecycle, "DRAFT");
      assert.equal(source.snapshot, null);
      assert.equal(source.model.customer?.name, "Saved Draft Customer");
      assert.equal(source.model.verificationCode, null);
      assert.deepEqual(source.model.appliedRates.map(({ label, amount }) => [label, amount]), [["Draft Service Levy (3%)", "3.00"]]);
      const generated = await generateDocumentPdf({ actorUserId: owner.id, workspaceId: workspace.id, documentId: normalDraft.id });
      const parsed = await PDFDocument.load(generated.bytes);
      assert.equal(parsed.getSubject(), DRAFT_WARNING);
      assert.equal(Buffer.from(generated.bytes).includes(Buffer.from("/Subtype /Image")), false);
    });

    await t.test("OWN visibility and workspace isolation protect draft PDFs", async () => {
      await assert.rejects(
        loadDraftDocumentPdfSource({ actorUserId: staff.id, workspaceId: workspace.id, documentId: normalDraft.id }),
        (error) => error instanceof DocumentPdfUnavailableError && error.reason === "NOT_FOUND",
      );
      await assert.rejects(
        loadDraftDocumentPdfSource({ actorUserId: outsider.id, workspaceId: outsiderWorkspace.id, documentId: normalDraft.id }),
        (error) => error instanceof DocumentPdfUnavailableError && error.reason === "NOT_FOUND",
      );
    });

    await t.test("a TEST draft retains both warnings and remains Super-Admin-only", async () => {
      const generated = await generateDocumentPdf({ actorUserId: superAdmin.id, workspaceId: testWorkspace.id, documentId: testDraft.id });
      assert.equal(generated.model.isTestDocument, true);
      assert.equal(generated.model.lifecycle, "DRAFT");
      assert.deepEqual(buildPdfPageWarnings(generated.model), [TEST_WARNING, DRAFT_WARNING]);
      assert.equal((await PDFDocument.load(generated.bytes)).getSubject(), `${DRAFT_WARNING} · ${TEST_WARNING}`);
      await assert.rejects(
        loadDraftDocumentPdfSource({ actorUserId: outsider.id, workspaceId: testWorkspace.id, documentId: testDraft.id }),
        WorkspaceAuthorizationError,
      );
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
      await db.customRate.update({ where: { id: mutableRate.id }, data: { name: "Changed Live Rate", value: "12" } });
      const after = await loadIssuedDocumentPdfSource({ actorUserId: owner.id, workspaceId: workspace.id, documentId: normalDocument.id });
      assert.deepEqual(after.model, before.model);
      assert.equal(after.model.issuer.legalName, "Snapshot Legal Name Ltd");
      assert.equal(after.model.customer?.name, "Snapshot Customer");
      assert.deepEqual(after.model.appliedRates.map(({ label, amount }) => [label, amount]), [["Snapshot Service Levy (3%)", "3.00"]]);
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
      await db.customRate.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (previousSuperAdmins === undefined) delete process.env.SUPER_ADMIN_EMAILS;
    else process.env.SUPER_ADMIN_EMAILS = previousSuperAdmins;
  }
});

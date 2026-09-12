import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { issuedDocumentSnapshotSchema, type IssuedDocumentSnapshot } from "../snapshots";
import { buildVerificationBarcodeOptions, renderVerificationBarcodePng, VERIFICATION_BARCODE_FORMAT } from "./barcode";
import { generateVerificationCode, normalizeVerificationCode, VERIFICATION_CODE_PATTERN } from "./code";
import { lookupPublicDocumentVerification, mapPublicVerificationResult } from "./service";

function verificationSnapshot(input: {
  documentId?: string;
  workspaceId?: string;
  verificationCode?: string | null;
  isTestDocument?: boolean;
} = {}): IssuedDocumentSnapshot {
  const documentId = input.documentId ?? randomUUID();
  return issuedDocumentSnapshotSchema.parse({
    snapshotVersion: 1,
    document: {
      id: documentId,
      draftReference: `DRAFT-${documentId.slice(0, 8)}`,
      documentNumber: "INV-000001",
      type: "INVOICE",
      status: "ISSUED",
      currency: "GHS",
      issueDate: "2026-09-10",
      issuedAt: "2026-09-10T10:00:00.000Z",
      dueDate: null,
      notes: "Private document notes must never be public.",
      isTestDocument: input.isTestDocument ?? false,
    },
    issuer: {
      workspaceId: input.workspaceId ?? randomUUID(),
      displayName: "Public Trading Name",
      legalName: "Verified Issuer Ltd",
      tradingName: "Public Trading Name",
      issuerType: "ORGANIZATION",
      country: "GH",
      currency: "GHS",
      email: "private-issuer@example.invalid",
      phone: "+233200000000",
      address: "Private issuer address",
      registrationNumber: "PRIVATE-REG",
      businessTin: "PRIVATE-BUSINESS-TIN",
      taxpayerIdType: "GRA_TIN",
      taxpayerId: "PRIVATE-TAXPAYER-ID",
      taxpayerVerificationStatus: "UNVERIFIED",
      vatRegistered: false,
      logo: null,
    },
    customer: {
      id: null,
      name: "Private Customer",
      email: "private-customer@example.invalid",
      phone: "+233240000000",
      address: "Private customer address",
      businessTin: "PRIVATE-CUSTOMER-TIN",
    },
    lines: [{ order: 1, description: "Private line description", quantity: "1", unitPrice: "100.00", subtotal: "100.00", customRate: null, total: "100.00" }],
    tax: null,
    totals: { subtotal: "100.00", discount: "0.00", customRates: "0.00", taxableValue: "100.00", trustedTax: "0.00", grandTotal: "100.00" },
    issuedBy: { userId: randomUUID(), displayName: "Private Issuing Member" },
    presentation: { template: null, signature: null },
    verification: input.verificationCode ? { code: input.verificationCode } : null,
  });
}

test("verification codes are canonical, non-sequential, normalized safely, and barcode-ready", async () => {
  const codes = Array.from({ length: 1_000 }, generateVerificationCode);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(codes.every((code) => VERIFICATION_CODE_PATTERN.test(code)), true);
  assert.equal(normalizeVerificationCode("  civ-7k4m-92px-h6q2  "), "CIV-7K4M-92PX-H6Q2");
  assert.equal(normalizeVerificationCode("CIV 7K4M 92PX H6Q2"), null);
  assert.equal(normalizeVerificationCode("not-a-code"), null);

  const code = "CIV-7K4M-92PX-H6Q2";
  const options = buildVerificationBarcodeOptions(code);
  assert.equal(options?.bcid, "code128");
  assert.equal(options?.text, code);
  const barcode = await renderVerificationBarcodePng(code);
  assert.equal(barcode?.format, VERIFICATION_BARCODE_FORMAT);
  assert.equal(barcode?.code, code);
  assert.equal(barcode?.bytes.toString("hex", 0, 8), "89504e470d0a1a0a");
});

test("public result mapping exposes only immutable public-safe snapshot fields", () => {
  const code = "CIV-7K4M-92PX-H6Q2";
  const result = mapPublicVerificationResult({
    status: "ISSUED",
    verificationCode: code,
    isTestDocument: false,
    snapshot: verificationSnapshot({ verificationCode: code }),
  });
  assert.deepEqual(result, {
    status: "VALID",
    isTestDocument: false,
    verificationCode: code,
    documentType: "Invoice",
    documentNumber: "INV-000001",
    issuerName: "Verified Issuer Ltd",
    issueDate: "2026-09-10",
    currency: "GHS",
    grandTotal: "100.00",
    fiscalizationStatus: "GRA fiscalization not recorded",
  });
  const serialized = JSON.stringify(result);
  for (const privateValue of ["PRIVATE-TAXPAYER-ID", "private-customer@example.invalid", "+233240000000", "Private document notes", "Private line description"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("public lookup returns VALID, TEST, and safe NOT_FOUND results without authentication", async () => {
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: `verify-${suffix}@example.invalid`, name: "Verification Issuer" }, select: { id: true } });
  const workspace = await db.workspace.create({ data: { name: `Verification ${suffix.slice(0, 8)}`, type: "ORGANIZATION" }, select: { id: true } });
  const normalCode = generateVerificationCode();
  const testCode = generateVerificationCode();
  const normalId = randomUUID();
  const testId = randomUUID();
  const historicalId = randomUUID();

  try {
    const createIssued = (input: { id: string; code: string | null; isTestDocument: boolean; snapshot: IssuedDocumentSnapshot }) => db.document.create({
      data: {
        id: input.id,
        workspaceId: workspace.id,
        createdByUserId: user.id,
        issuedByUserId: user.id,
        type: "INVOICE",
        status: "ISSUED",
        isTestDocument: input.isTestDocument,
        draftReference: `DRAFT-${input.id.slice(0, 8)}`,
        documentNumber: `INV-${input.id.slice(0, 6)}`,
        verificationCode: input.code,
        currency: "GHS",
        draftDate: new Date("2026-09-10T00:00:00.000Z"),
        issueDate: new Date("2026-09-10T00:00:00.000Z"),
        issuedAt: new Date("2026-09-10T10:00:00.000Z"),
        grandTotal: "100.00",
        snapshot: { create: { payload: input.snapshot as unknown as Prisma.InputJsonValue } },
      },
    });

    await createIssued({ id: normalId, code: normalCode, isTestDocument: false, snapshot: verificationSnapshot({ documentId: normalId, workspaceId: workspace.id, verificationCode: normalCode }) });
    await createIssued({ id: testId, code: testCode, isTestDocument: true, snapshot: verificationSnapshot({ documentId: testId, workspaceId: workspace.id, verificationCode: testCode, isTestDocument: true }) });
    const historical = structuredClone(verificationSnapshot({ documentId: historicalId, workspaceId: workspace.id })) as unknown as Record<string, unknown>;
    delete historical.verification;
    await createIssued({ id: historicalId, code: null, isTestDocument: false, snapshot: issuedDocumentSnapshotSchema.parse(historical) });

    assert.equal((await lookupPublicDocumentVerification(`  ${normalCode.toLowerCase()}  `)).status, "VALID");
    const testResult = await lookupPublicDocumentVerification(testCode);
    assert.equal(testResult.status, "TEST");
    assert.equal(testResult.isTestDocument, true);
    assert.deepEqual(await lookupPublicDocumentVerification("CIV-2222-2222-2222"), { status: "NOT_FOUND" });
    assert.deepEqual(await lookupPublicDocumentVerification("invalid"), { status: "NOT_FOUND" });

    await assert.rejects(createIssued({
      id: randomUUID(),
      code: normalCode,
      isTestDocument: false,
      snapshot: verificationSnapshot({ verificationCode: normalCode, workspaceId: workspace.id }),
    }));
    assert.equal(issuedDocumentSnapshotSchema.parse(historical).verification, null);
  } finally {
    await db.documentSnapshot.deleteMany({ where: { document: { workspaceId: workspace.id } } });
    await db.document.deleteMany({ where: { workspaceId: workspace.id } });
    await db.workspace.delete({ where: { id: workspace.id } });
    await db.user.delete({ where: { id: user.id } });
  }
});

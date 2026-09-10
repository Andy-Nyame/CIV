import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { addUtcMonth } from "@/features/commercial/periods";
import { createCustomer, updateCustomer } from "@/features/customers/service";
import { db } from "@/lib/db";
import { synchronizeGhanaVat2026ReferenceData } from "../../../prisma/reference-data/ghana-vat-2026";

import { issueDocument } from "./issuance";
import { listWorkspaceCustomerSuggestions } from "./queries";
import { createDraft } from "./service";
import { issuedDocumentSnapshotSchema } from "./snapshots";

type DocumentType = "INVOICE" | "RECEIPT" | "VAT_INVOICE";

test("customer details are document-first, reusable, isolated, and snapshotted", async () => {
  const suffix = randomUUID();
  const workspaceIds: string[] = [];
  const userIds: string[] = [];
  const free = await db.plan.findUniqueOrThrow({ where: { code: "FREE" } });
  const periodStart = new Date(Date.now() - 60_000);

  async function createWorkspace(label: string) {
    const user = await db.user.create({
      data: { name: `${label} owner`, email: `customer-flow-${label}-${suffix}@example.invalid` },
      select: { id: true },
    });
    userIds.push(user.id);
    const workspace = await db.workspace.create({
      data: {
        name: `${label} ${suffix.slice(0, 8)}`,
        type: "BUSINESS",
        country: "GH",
        currency: "GHS",
        businessTin: `ISSUER-${suffix.slice(0, 8)}`,
        memberships: { create: { userId: user.id, role: "OWNER", status: "ACTIVE" } },
        subscription: { create: { planId: free.id, status: "BETA" } },
        documentAllowancePeriods: {
          create: { planId: free.id, periodStart, periodEnd: addUtcMonth(periodStart), allowance: free.documentLimit, used: 0 },
        },
      },
      select: { id: true },
    });
    workspaceIds.push(workspace.id);
    return { id: workspace.id, ownerId: user.id };
  }

  function draftData(type: DocumentType, customer: Record<string, unknown> = {}) {
    return {
      type,
      customerId: null,
      currency: "GHS",
      draftDate: "2026-09-10",
      dueDate: type === "RECEIPT" ? null : "2026-10-10",
      notes: "Document-first customer test",
      lines: [{ catalogItemId: null, customRateId: null, description: "Professional service", quantity: "1", unitPrice: "100.00" }],
      ...customer,
    };
  }

  try {
    await db.$transaction((transaction) => synchronizeGhanaVat2026ReferenceData(transaction));
    const primary = await createWorkspace("Customer flow primary");
    const isolated = await createWorkspace("Customer flow isolated");

    const receiptDetails = {
      customerName: "Akosua Mensah",
      customerEmail: `akosua-${suffix}@example.invalid`,
      customerPhone: "+233200000001",
      customerAddress: "First address, Accra",
      customerBusinessTin: "C-TIN-100",
    };
    assert.equal(await db.customer.count({ where: { workspaceId: primary.id, email: receiptDetails.customerEmail } }), 0);
    const receipt = await createDraft({ actorUserId: primary.ownerId, workspaceId: primary.id, data: draftData("RECEIPT", receiptDetails) });
    assert.ok(receipt.customerId, "Valid document customer details should be reusable after the draft is saved.");
    assert.equal(receipt.customerName, receiptDetails.customerName);
    const reusableCustomer = await db.customer.findUniqueOrThrow({ where: { id: receipt.customerId } });
    assert.equal(reusableCustomer.workspaceId, primary.id);
    assert.equal(reusableCustomer.address, receiptDetails.customerAddress);

    const invoiceDetails = { ...receiptDetails, customerAddress: "Document-specific delivery address" };
    const invoice = await createDraft({ actorUserId: primary.ownerId, workspaceId: primary.id, data: draftData("INVOICE", invoiceDetails) });
    assert.equal(invoice.customerId, receipt.customerId, "A strong exact identity match should reuse the saved customer.");
    assert.equal(invoice.customerAddress, invoiceDetails.customerAddress);
    assert.equal(await db.customer.count({ where: { workspaceId: primary.id, email: receiptDetails.customerEmail } }), 1);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: receipt.customerId! } })).address, receiptDetails.customerAddress, "Document entry must not overwrite the saved customer.");

    const vatDetails = {
      customerName: "Kofi Owusu Ltd",
      customerEmail: `kofi-${suffix}@example.invalid`,
      customerPhone: "+233200000002",
      customerAddress: "Tema, Ghana",
      customerBusinessTin: "VAT-TIN-200",
    };
    const vatInvoice = await createDraft({ actorUserId: primary.ownerId, workspaceId: primary.id, data: draftData("VAT_INVOICE", vatDetails) });
    assert.equal(vatInvoice.customerName, vatDetails.customerName);

    const saved = await createCustomer({
      actorUserId: primary.ownerId,
      workspaceId: primary.id,
      data: { name: "Saved Selection Ltd", email: `saved-${suffix}@example.invalid`, phone: "+233200000003", address: "Kumasi", businessTin: "TIN-SAVED", notes: "" },
    });
    const selected = await createDraft({ actorUserId: primary.ownerId, workspaceId: primary.id, data: draftData("INVOICE", { customerId: saved.id }) });
    assert.equal(selected.customerId, saved.id);
    assert.equal(selected.customerName, saved.name);
    assert.equal(selected.customerEmail, saved.email);
    assert.equal(selected.customerBusinessTin, saved.businessTin);

    const isolatedCustomer = await createCustomer({
      actorUserId: isolated.ownerId,
      workspaceId: isolated.id,
      data: { name: "Other Workspace Contact", email: `isolated-${suffix}@example.invalid`, phone: "", address: "", businessTin: "", notes: "" },
    });
    const suggestions = await listWorkspaceCustomerSuggestions(primary.id);
    assert.ok(suggestions.some(({ id }) => id === saved.id));
    assert.ok(!suggestions.some(({ id }) => id === isolatedCustomer.id), "Customer suggestions must not cross workspace boundaries.");

    const failedAutoSaveDetails = {
      customerName: "No Saved Row Customer",
      customerEmail: `unsaved-${suffix}@example.invalid`,
      customerPhone: "+233200000004",
      customerAddress: "Exact document address",
      customerBusinessTin: "TIN-UNSAVED",
    };
    const unsaved = await createDraft(
      { actorUserId: primary.ownerId, workspaceId: primary.id, data: draftData("INVOICE", failedAutoSaveDetails) },
      { autoSaveCustomer: async () => { throw new Error("simulated background customer save failure"); } },
    );
    assert.equal(unsaved.customerId, null);
    assert.equal(unsaved.customerName, failedAutoSaveDetails.customerName);
    assert.equal(await db.customer.count({ where: { workspaceId: primary.id, email: failedAutoSaveDetails.customerEmail } }), 0);

    const receiptIssue = await issueDocument({ actorUserId: primary.ownerId, workspaceId: primary.id, documentId: receipt.id });
    await issueDocument({ actorUserId: primary.ownerId, workspaceId: primary.id, documentId: invoice.id });
    await issueDocument({ actorUserId: primary.ownerId, workspaceId: primary.id, documentId: vatInvoice.id });
    await issueDocument({ actorUserId: primary.ownerId, workspaceId: primary.id, documentId: unsaved.id });

    const receiptSnapshot = issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: receipt.id } })).payload);
    assert.equal(receiptSnapshot.customer?.name, receiptDetails.customerName);
    assert.equal(receiptSnapshot.customer?.email, receiptDetails.customerEmail);
    assert.equal(receiptSnapshot.customer?.phone, receiptDetails.customerPhone);
    assert.equal(receiptSnapshot.customer?.address, receiptDetails.customerAddress);
    assert.equal(receiptSnapshot.customer?.businessTin, receiptDetails.customerBusinessTin);
    const originalPayload = structuredClone(receiptSnapshot);
    await updateCustomer({
      actorUserId: primary.ownerId,
      workspaceId: primary.id,
      customerId: receipt.customerId,
      data: { name: "Changed after issue", email: "changed@example.invalid", phone: "", address: "Changed", businessTin: "CHANGED", notes: "" },
    });
    assert.deepEqual(issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: receipt.id } })).payload), originalPayload);
    assert.equal(receiptIssue.documentId, receipt.id);

    const unsavedSnapshot = issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: unsaved.id } })).payload);
    assert.equal(unsavedSnapshot.customer?.id, null);
    assert.equal(unsavedSnapshot.customer?.name, failedAutoSaveDetails.customerName);
    assert.equal(unsavedSnapshot.customer?.address, failedAutoSaveDetails.customerAddress);
    const vatSnapshot = issuedDocumentSnapshotSchema.parse((await db.documentSnapshot.findUniqueOrThrow({ where: { documentId: vatInvoice.id } })).payload);
    assert.equal(vatSnapshot.customer?.name, vatDetails.customerName);
    assert.equal(vatSnapshot.totals.grandTotal, "120.00");
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
  }
});

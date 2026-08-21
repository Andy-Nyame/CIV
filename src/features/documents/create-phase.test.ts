import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { BusinessDataValidationError } from "@/features/business-data/errors";
import { createCatalogueItem, updateCatalogueItem } from "@/features/catalog/service";
import { createCustomer, updateCustomer } from "@/features/customers/service";
import { db } from "@/lib/db";

import { calculateDraftLine, calculateDraftTotals } from "./calculations";
import { archiveDraft, createDraft, updateDraft } from "./service";

type DraftLineInput = {
  catalogItemId: string | null;
  customRateId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
};

type DraftData = {
  type: "INVOICE" | "RECEIPT" | "VAT_INVOICE";
  customerId: string | null;
  currency: string;
  draftDate: string;
  dueDate: string | null;
  notes: string;
  lines: DraftLineInput[];
};

function draftData(overrides: Partial<DraftData> = {}): DraftData {
  return {
    type: "INVOICE",
    customerId: null,
    currency: "GHS",
    draftDate: "2026-08-21",
    dueDate: "2026-09-21",
    notes: "CREATE Phase 1 test draft",
    lines: [{ catalogItemId: null, customRateId: null, description: "Custom service", quantity: "1", unitPrice: "10.00" }],
    ...overrides,
  };
}

test("draft calculations use exact Decimal arithmetic and reject unsafe values", () => {
  const lines = [
    calculateDraftLine({ description: "A", quantity: "1", unitPrice: "0.01" }),
    calculateDraftLine({ description: "B", quantity: "1", unitPrice: "10.00" }),
    calculateDraftLine({ description: "C", quantity: "1", unitPrice: "99.99" }),
    calculateDraftLine({ description: "D", quantity: "1", unitPrice: "1000.50", rate: { type: "PERCENTAGE", value: "2.5" } }),
  ];
  const totals = calculateDraftTotals(lines);
  assert.equal(totals.subtotal.toFixed(4), "1110.5000");
  assert.equal(totals.rateTotal.toFixed(4), "25.0125");
  assert.equal(totals.grandTotal.toFixed(4), "1135.5125");
  assert.throws(() => calculateDraftLine({ description: "Negative", quantity: "1", unitPrice: "-0.01" }));
  assert.throws(() => calculateDraftLine({ description: "Zero quantity", quantity: "0", unitPrice: "1" }));
  assert.throws(() => calculateDraftLine({ description: "Malformed", quantity: "not-a-number", unitPrice: "1" }));
});

test("customers, catalogue entries, and drafts are isolated, authorized, snapshotted, audited, and concurrency-safe", async () => {
  const suffix = randomUUID();
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  async function createUser(label: string) {
    const user = await db.user.create({
      data: { name: `CREATE ${label}`, email: `create-${label}-${suffix}@example.invalid` },
      select: { id: true },
    });
    userIds.push(user.id);
    return user;
  }

  try {
    const [owner, manager, staffOne, staffTwo, outsider] = await Promise.all([
      createUser("owner"),
      createUser("manager"),
      createUser("staff-one"),
      createUser("staff-two"),
      createUser("outsider"),
    ]);
    const workspace = await db.workspace.create({
      data: {
        name: `CREATE Workspace ${suffix.slice(0, 8)}`,
        type: "BUSINESS",
        memberships: {
          create: [
            { userId: owner.id, role: "OWNER", status: "ACTIVE" },
            { userId: manager.id, role: "MANAGER", status: "ACTIVE" },
            { userId: staffOne.id, role: "STAFF", status: "ACTIVE" },
            { userId: staffTwo.id, role: "STAFF", status: "ACTIVE" },
          ],
        },
      },
      select: { id: true },
    });
    workspaceIds.push(workspace.id);
    const otherWorkspace = await db.workspace.create({
      data: {
        name: `CREATE Isolated ${suffix.slice(0, 8)}`,
        type: "BUSINESS",
        memberships: { create: { userId: outsider.id, role: "OWNER", status: "ACTIVE" } },
      },
      select: { id: true },
    });
    workspaceIds.push(otherWorkspace.id);

    const customer = await createCustomer({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      data: { name: "Ada Trading", email: "ADA@EXAMPLE.COM", phone: "+233200000000", address: "Accra", businessTin: "TIN-001", notes: "Priority customer" },
    });
    assert.equal(customer.createdByUserId, owner.id);
    assert.equal(customer.email, "ada@example.com");
    const updatedCustomer = await updateCustomer({
      actorUserId: manager.id,
      workspaceId: workspace.id,
      customerId: customer.id,
      data: { name: "Ada Trading Ltd", email: "ada@example.com", phone: "+233200000000", address: "Accra", businessTin: "TIN-001", notes: "Updated safely" },
    });
    assert.equal(updatedCustomer.name, "Ada Trading Ltd");
    assert.equal(await db.customer.count({ where: { workspaceId: workspace.id, name: { contains: "ada", mode: "insensitive" } } }), 1);
    await assert.rejects(
      createCustomer({ actorUserId: staffOne.id, workspaceId: workspace.id, data: { name: "Unauthorized", email: "", phone: "", address: "", businessTin: "", notes: "" } }),
      WorkspaceAuthorizationError,
    );

    const item = await createCatalogueItem({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      data: { name: "Logo Design", description: "Identity design service", type: "SERVICE", unitPrice: "99.99", currency: "GHS", unitLabel: "project", sku: `LOGO-${suffix.slice(0, 8)}` },
    });
    assert.equal(item.createdByUserId, owner.id);
    assert.equal(item.unitPrice.toFixed(4), "99.9900");
    assert.equal(await db.itemService.count({ where: { workspaceId: workspace.id, OR: [{ name: { contains: "logo", mode: "insensitive" } }, { sku: { contains: suffix.slice(0, 8), mode: "insensitive" } }] } }), 1);
    await assert.rejects(
      updateCatalogueItem({ actorUserId: staffOne.id, workspaceId: workspace.id, itemId: item.id, data: { name: item.name, description: item.description ?? "", type: item.type, unitPrice: item.unitPrice.toString(), currency: item.currency, unitLabel: item.unitLabel ?? "", sku: item.sku ?? "" } }),
      WorkspaceAuthorizationError,
    );
    await assert.rejects(
      createCatalogueItem({ actorUserId: owner.id, workspaceId: workspace.id, data: { name: "Unsafe", description: "", type: "ITEM", unitPrice: "-1", currency: "GHS", unitLabel: "", sku: "" } }),
      BusinessDataValidationError,
    );

    const rate = await db.customRate.create({
      data: { workspaceId: workspace.id, name: "CREATE Test Rate", type: "PERCENTAGE", scope: "CUSTOM", value: "2.5", isActive: true },
    });
    const otherCustomer = await createCustomer({
      actorUserId: outsider.id,
      workspaceId: otherWorkspace.id,
      data: { name: "Other Workspace Customer", email: "", phone: "", address: "", businessTin: "", notes: "" },
    });
    const otherItem = await createCatalogueItem({
      actorUserId: outsider.id,
      workspaceId: otherWorkspace.id,
      data: { name: "Other Item", description: "", type: "ITEM", unitPrice: "12.00", currency: "GHS", unitLabel: "unit", sku: "" },
    });

    const capacityBefore = await db.documentCapacityConsumption.count({ where: { workspaceId: workspace.id } });
    const ledgerBefore = await db.documentCreditTransaction.aggregate({ where: { workspaceId: workspace.id }, _sum: { amount: true } });
    const draft = await createDraft({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      data: draftData({
        type: "VAT_INVOICE",
        customerId: customer.id,
        lines: [
          { catalogItemId: null, customRateId: null, description: "Exact penny", quantity: "1", unitPrice: "0.01" },
          { catalogItemId: null, customRateId: null, description: "Ten", quantity: "1", unitPrice: "10.00" },
          { catalogItemId: item.id, customRateId: null, description: "Logo Design", quantity: "1", unitPrice: "99.99" },
          { catalogItemId: null, customRateId: rate.id, description: "Large service", quantity: "1", unitPrice: "1000.50" },
        ],
      }),
    });
    assert.match(draft.draftReference, /^DRAFT-[0-9A-F]{12}$/);
    assert.equal(draft.documentNumber, null);
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.createdByUserId, owner.id);
    assert.equal(draft.customerId, customer.id);
    assert.equal(draft.type, "VAT_INVOICE");
    assert.equal(draft.subtotal.toFixed(4), "1110.5000");
    assert.equal(draft.rateTotal.toFixed(4), "25.0125");
    assert.equal(draft.grandTotal.toFixed(4), "1135.5125");
    assert.equal(draft.lines[2]?.description, "Logo Design");
    assert.equal(draft.lines[2]?.unitPrice.toFixed(4), "99.9900");
    assert.equal(draft.lines[3]?.rateNameSnapshot, "CREATE Test Rate");
    assert.equal(draft.lines[3]?.rateValueSnapshot?.toFixed(6), "2.500000");

    await updateCatalogueItem({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      itemId: item.id,
      data: { name: "Logo Design", description: "Identity design service", type: "SERVICE", unitPrice: "700.00", currency: "GHS", unitLabel: "project", sku: item.sku ?? "" },
    });
    const snapshottedLine = await db.documentLine.findFirstOrThrow({ where: { documentId: draft.id, catalogItemId: item.id } });
    assert.equal(snapshottedLine.unitPrice.toFixed(4), "99.9900");

    await assert.rejects(
      createDraft({ actorUserId: owner.id, workspaceId: workspace.id, data: draftData({ customerId: otherCustomer.id }) }),
      BusinessDataValidationError,
    );
    await assert.rejects(
      createDraft({ actorUserId: owner.id, workspaceId: workspace.id, data: draftData({ lines: [{ catalogItemId: otherItem.id, customRateId: null, description: "Cross workspace", quantity: "1", unitPrice: "12" }] }) }),
      BusinessDataValidationError,
    );
    await assert.rejects(
      updateDraft({ actorUserId: outsider.id, workspaceId: otherWorkspace.id, documentId: draft.id, data: draftData() }),
      WorkspaceAuthorizationError,
    );

    const staffDraft = await createDraft({ actorUserId: staffOne.id, workspaceId: workspace.id, data: draftData({ type: "RECEIPT" }) });
    await assert.rejects(
      updateDraft({ actorUserId: staffTwo.id, workspaceId: workspace.id, documentId: staffDraft.id, data: draftData({ type: "RECEIPT" }) }),
      WorkspaceAuthorizationError,
    );
    const staffUpdated = await updateDraft({ actorUserId: staffOne.id, workspaceId: workspace.id, documentId: staffDraft.id, data: draftData({ type: "RECEIPT", notes: "Own draft updated" }) });
    assert.equal(staffUpdated.notes, "Own draft updated");
    const ownerUpdatedStaffDraft = await updateDraft({ actorUserId: owner.id, workspaceId: workspace.id, documentId: staffDraft.id, data: draftData({ type: "RECEIPT", notes: "Owner-managed draft" }) });
    assert.equal(ownerUpdatedStaffDraft.notes, "Owner-managed draft");

    const parallelDrafts = await Promise.all(Array.from({ length: 8 }, (_, index) => createDraft({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      data: draftData({ notes: `Parallel draft ${index}` }),
    })));
    assert.equal(new Set(parallelDrafts.map(({ draftReference }) => draftReference)).size, 8);

    const concurrentTarget = parallelDrafts[0]!;
    await Promise.all([
      updateDraft({ actorUserId: owner.id, workspaceId: workspace.id, documentId: concurrentTarget.id, data: draftData({ lines: [{ catalogItemId: null, customRateId: null, description: "Concurrent one", quantity: "2", unitPrice: "3.25" }] }) }),
      updateDraft({ actorUserId: owner.id, workspaceId: workspace.id, documentId: concurrentTarget.id, data: draftData({ lines: [{ catalogItemId: null, customRateId: null, description: "Concurrent A", quantity: "1", unitPrice: "5.00" }, { catalogItemId: null, customRateId: null, description: "Concurrent B", quantity: "2", unitPrice: "7.50" }] }) }),
    ]);
    const concurrentResult = await db.document.findUniqueOrThrow({ where: { id: concurrentTarget.id }, include: { lines: true } });
    const persistedLineTotal = concurrentResult.lines.reduce((sum, line) => sum + Number(line.lineTotal.toString()), 0);
    assert.equal(Number(concurrentResult.grandTotal.toString()), persistedLineTotal);
    assert.ok(concurrentResult.lines.length === 1 || concurrentResult.lines.length === 2);

    await updateCustomer({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      customerId: customer.id,
      archived: true,
      data: { name: updatedCustomer.name, email: updatedCustomer.email ?? "", phone: updatedCustomer.phone ?? "", address: updatedCustomer.address ?? "", businessTin: updatedCustomer.businessTin ?? "", notes: updatedCustomer.notes ?? "" },
    });
    await updateCatalogueItem({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      itemId: item.id,
      active: false,
      data: { name: item.name, description: item.description ?? "", type: item.type, unitPrice: "700.00", currency: item.currency, unitLabel: item.unitLabel ?? "", sku: item.sku ?? "" },
    });
    await db.customRate.update({ where: { id: rate.id }, data: { isActive: false } });
    const preservedDraft = await updateDraft({
      actorUserId: owner.id,
      workspaceId: workspace.id,
      documentId: draft.id,
      data: draftData({
        type: "VAT_INVOICE",
        customerId: customer.id,
        lines: [
          { catalogItemId: item.id, customRateId: null, description: "Logo Design", quantity: "1", unitPrice: "99.99" },
          { catalogItemId: null, customRateId: rate.id, description: "Large service", quantity: "1", unitPrice: "1000.50" },
        ],
      }),
    });
    assert.equal(preservedDraft.customerId, customer.id);
    assert.equal(preservedDraft.lines[0]?.unitPrice.toFixed(4), "99.9900");

    await assert.rejects(
      createDraft({ actorUserId: owner.id, workspaceId: workspace.id, data: draftData({ customerId: customer.id }) }),
      BusinessDataValidationError,
    );
    await assert.rejects(
      createDraft({ actorUserId: owner.id, workspaceId: workspace.id, data: draftData({ lines: [{ catalogItemId: item.id, customRateId: null, description: "Archived", quantity: "1", unitPrice: "99.99" }] }) }),
      BusinessDataValidationError,
    );

    const archivedDraft = await archiveDraft({ actorUserId: owner.id, workspaceId: workspace.id, documentId: draft.id });
    assert.ok(archivedDraft.archivedAt);
    await assert.rejects(
      updateDraft({ actorUserId: owner.id, workspaceId: workspace.id, documentId: draft.id, data: draftData() }),
      WorkspaceAuthorizationError,
    );

    assert.equal(await db.documentSnapshot.count({ where: { document: { workspaceId: workspace.id } } }), 0);
    assert.equal(await db.documentCapacityConsumption.count({ where: { workspaceId: workspace.id } }), capacityBefore);
    const ledgerAfter = await db.documentCreditTransaction.aggregate({ where: { workspaceId: workspace.id }, _sum: { amount: true } });
    assert.equal(ledgerAfter._sum.amount ?? 0, ledgerBefore._sum.amount ?? 0);
    assert.equal(await db.document.count({ where: { workspaceId: workspace.id, status: { not: "DRAFT" } } }), 0);
    assert.ok(await db.auditEvent.count({ where: { workspaceId: workspace.id, action: "CUSTOMER_CREATED" } }));
    assert.ok(await db.auditEvent.count({ where: { workspaceId: workspace.id, action: "ITEM_UPDATED" } }));
    assert.ok(await db.auditEvent.count({ where: { workspaceId: workspace.id, action: "DOCUMENT_DRAFT_CREATED" } }));
    assert.ok(await db.auditEvent.count({ where: { workspaceId: workspace.id, action: "DOCUMENT_DRAFT_UPDATED" } }));
    assert.equal(await db.auditEvent.count({ where: { workspaceId: workspace.id, action: "DOCUMENT_DRAFT_ARCHIVED" } }), 1);
  } finally {
    if (workspaceIds.length) {
      await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.customRate.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.itemService.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.customer.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    assert.equal(await db.platformMembership.count({ where: { role: "PLATFORM_OWNER", status: "ACTIVE" } }), 1);
  }
});

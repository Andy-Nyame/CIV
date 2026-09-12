import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { CAPABILITIES } from "@/features/authorization/capabilities";
import { AUDIT_RESOURCE_TYPES } from "@/features/audit/registry";
import { recordAuditEvent } from "@/features/audit/service";
import { requireDocumentAccessInTransaction, requireWorkspaceCapabilityInTransaction } from "@/features/business-data/authorization";
import { BusinessDataConflictError, BusinessDataValidationError } from "@/features/business-data/errors";
import { businessDataTransactionOptions, lockBusinessResource } from "@/features/business-data/locking";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requireWorkspaceDocumentReadinessInTransaction } from "@/features/workspaces/document-readiness-service";
import { determineTaxPointDateTime, isVatEligibleAtTaxPoint, parseGhanaDateTime } from "@/features/tax/eligibility";
import { resolveGhanaVatVersion } from "@/features/tax/resolver";
import { buildTaxSnapshot } from "@/features/tax/snapshot";
import type { TrustedTaxComponent, TrustedTaxVersion } from "@/features/tax/types";
import { calculateDocumentLine, calculateDraftTotals, calculateNetPayable } from "./calculations";
import { issuedDocumentSnapshotSchema } from "./snapshots";
import { documentIdSchema, draftInputSchema } from "./validation";
import { fiscalizationStatusForDraft, isStatutoryTaxDocument } from "./compliance";

function draftReference() { return `DRAFT-${randomBytes(6).toString("hex").toUpperCase()}`; }

function withBackwardCompatibleDraftDefaults(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  return { ...record, supplyDate: record.supplyDate ?? record.draftDate };
}

type DraftCustomerInput = {
  customerId: string | null;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerBusinessTin?: string | null;
  customerTaxpayerIdType?: "GHANA_CARD_PIN" | "GRA_TIN" | null;
  customerTaxpayerId?: string | null;
  customerVatRegistrationStatus?: "NOT_REGISTERED" | "PENDING" | "REGISTERED" | "DEREGISTERED" | null;
  customerTaxStatus?: "ORDINARY_CONSUMER" | "TAXABLE_PERSON";
};

type StoredDraftCustomer = {
  customerId: string | null; customerName: string | null; customerEmail: string | null;
  customerPhone: string | null; customerAddress: string | null; customerBusinessTin: string | null;
  customerTaxpayerIdType: "GHANA_CARD_PIN" | "GRA_TIN" | null; customerTaxpayerId: string | null;
  customerVatRegistrationStatus: "NOT_REGISTERED" | "PENDING" | "REGISTERED" | "DEREGISTERED" | null;
  customerTaxStatus: "ORDINARY_CONSUMER" | "TAXABLE_PERSON";
};

type CustomerAutoSave = (input: { actorUserId: string; workspaceId: string; documentId: string }) => Promise<string | null>;
type DraftServiceOptions = { autoSaveCustomer?: CustomerAutoSave };

async function resolveDraftCustomer(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  customer: DraftCustomerInput,
  existing?: StoredDraftCustomer,
): Promise<StoredDraftCustomer> {
  const sameName = existing?.customerName?.trim().toLowerCase() === customer.customerName.toLowerCase();
  const explicitTaxIdentity = customer.customerTaxStatus === "TAXABLE_PERSON";
  if (!customer.customerId) return {
    customerId: null,
    customerName: customer.customerName,
    customerEmail: customer.customerEmail !== undefined ? customer.customerEmail : sameName ? existing.customerEmail : null,
    customerPhone: customer.customerPhone !== undefined ? customer.customerPhone : sameName ? existing.customerPhone : null,
    customerAddress: explicitTaxIdentity && customer.customerAddress !== undefined ? customer.customerAddress : sameName ? existing.customerAddress : null,
    customerBusinessTin: customer.customerBusinessTin !== undefined ? customer.customerBusinessTin : sameName ? existing.customerBusinessTin : null,
    customerTaxpayerIdType: explicitTaxIdentity && customer.customerTaxpayerIdType !== undefined ? customer.customerTaxpayerIdType : sameName ? existing.customerTaxpayerIdType : null,
    customerTaxpayerId: explicitTaxIdentity && customer.customerTaxpayerId !== undefined ? customer.customerTaxpayerId : sameName ? existing.customerTaxpayerId : null,
    customerVatRegistrationStatus: explicitTaxIdentity && customer.customerVatRegistrationStatus !== undefined ? customer.customerVatRegistrationStatus : sameName ? existing.customerVatRegistrationStatus : null,
    customerTaxStatus: customer.customerTaxStatus ?? (sameName ? existing?.customerTaxStatus : null) ?? "ORDINARY_CONSUMER",
  };
  const saved = await tx.customer.findFirst({
    where: { id: customer.customerId, workspaceId, ...(customer.customerId === existing?.customerId ? {} : { archivedAt: null }) },
    select: { id: true, name: true, email: true, phone: true, address: true, businessTin: true, taxpayerIdType: true, taxpayerId: true, vatRegistrationStatus: true, taxStatus: true },
  });
  if (!saved) throw new BusinessDataValidationError({ customerId: ["Customer is unavailable."] });
  const preserveExisting = customer.customerId === existing?.customerId && sameName;
  return {
    customerId: saved.id,
    customerName: customer.customerName,
    customerEmail: customer.customerEmail !== undefined ? customer.customerEmail : preserveExisting ? existing.customerEmail : saved.email,
    customerPhone: customer.customerPhone !== undefined ? customer.customerPhone : preserveExisting ? existing.customerPhone : saved.phone,
    customerAddress: explicitTaxIdentity && customer.customerAddress !== undefined ? customer.customerAddress : preserveExisting ? existing.customerAddress : saved.address,
    customerBusinessTin: customer.customerBusinessTin !== undefined ? customer.customerBusinessTin : preserveExisting ? existing.customerBusinessTin : saved.businessTin,
    customerTaxpayerIdType: explicitTaxIdentity && customer.customerTaxpayerIdType !== undefined ? customer.customerTaxpayerIdType : preserveExisting ? existing.customerTaxpayerIdType : saved.taxpayerIdType,
    customerTaxpayerId: explicitTaxIdentity && customer.customerTaxpayerId !== undefined ? customer.customerTaxpayerId : preserveExisting ? existing.customerTaxpayerId : saved.taxpayerId,
    customerVatRegistrationStatus: explicitTaxIdentity && customer.customerVatRegistrationStatus !== undefined ? customer.customerVatRegistrationStatus : preserveExisting ? existing.customerVatRegistrationStatus : saved.vatRegistrationStatus,
    customerTaxStatus: customer.customerTaxStatus ?? saved.taxStatus,
  };
}

export async function autoSaveDocumentCustomer(input: {
  actorUserId: string;
  workspaceId: string;
  documentId: string;
}) {
  return db.$transaction(async (tx) => {
    await requireWorkspaceCapabilityInTransaction(tx, input.actorUserId, input.workspaceId, CAPABILITIES.CREATE_DOCUMENT);
    const document = await tx.document.findFirst({
      where: { id: input.documentId, workspaceId: input.workspaceId, status: "DRAFT", archivedAt: null },
      select: { customerId: true, customerName: true, customerEmail: true, customerPhone: true, customerAddress: true, customerBusinessTin: true, customerTaxpayerIdType: true, customerTaxpayerId: true, customerVatRegistrationStatus: true, customerTaxStatus: true },
    });
    if (!document?.customerName || document.customerId) return document?.customerId ?? null;

    const normalizedIdentity = document.customerName.trim().toLowerCase();
    const identityLock = createHash("sha256").update(normalizedIdentity).digest("hex");
    await lockBusinessResource(tx, `document-customer:${input.workspaceId}:${identityLock}`);

    const existing = await tx.customer.findFirst({
      where: {
        workspaceId: input.workspaceId,
        archivedAt: null,
        name: { equals: document.customerName, mode: "insensitive" },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const customer = existing ?? await tx.customer.create({
      data: {
        workspaceId: input.workspaceId,
        createdByUserId: input.actorUserId,
        name: document.customerName,
        email: document.customerEmail,
        phone: document.customerPhone,
        address: document.customerAddress,
        businessTin: document.customerBusinessTin,
        taxpayerIdType: document.customerTaxpayerIdType,
        taxpayerId: document.customerTaxpayerId,
        vatRegistrationStatus: document.customerVatRegistrationStatus,
        taxStatus: document.customerTaxStatus,
      },
      select: { id: true },
    });
    if (!existing) await recordAuditEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "CUSTOMER_CREATED",
      resourceType: AUDIT_RESOURCE_TYPES.CUSTOMER,
      resourceId: customer.id,
      metadata: { customerName: document.customerName },
    });
    await tx.document.updateMany({
      where: { id: input.documentId, workspaceId: input.workspaceId, status: "DRAFT", archivedAt: null, customerId: null },
      data: { customerId: customer.id },
    });
    return customer.id;
  }, businessDataTransactionOptions);
}

async function attachReusableCustomer<T extends { id: string; customerId: string | null; customerName: string | null }>(
  document: T,
  input: { actorUserId: string; workspaceId: string },
  options: DraftServiceOptions,
) {
  if (document.customerId || !document.customerName) return document;
  try {
    const customerId = await (options.autoSaveCustomer ?? autoSaveDocumentCustomer)({ ...input, documentId: document.id });
    return customerId ? { ...document, customerId } : document;
  } catch {
    // The document is already safely persisted. Reusable-contact saving is best effort.
    return document;
  }
}

async function prepareLines(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  currency: string,
  lines: ReturnType<typeof draftInputSchema.parse>["lines"],
  calculationContext: {
    priceMode: "TAX_EXCLUSIVE" | "TAX_INCLUSIVE";
    supplierVatEligible: boolean;
    statutoryComponents: TrustedTaxComponent[];
  },
  existingReferences: { catalogueItemIds: Set<string>; rateIds: Set<string>; lines: Map<string, { customRateId: string | null; rateNameSnapshot: string | null; rateTypeSnapshot: "PERCENTAGE" | "FIXED" | null; rateValueSnapshot: Prisma.Decimal | null }> } = { catalogueItemIds: new Set(), rateIds: new Set(), lines: new Map() },
) {
  const catalogueIds = [...new Set(lines.flatMap((line) => line.catalogItemId ? [line.catalogItemId] : []))];
  const rateIds = [...new Set(lines.flatMap((line) => line.customRateId ? [line.customRateId] : []))];
  // Interactive transactions use one checked-out pg client. Keep its queries
  // sequential so node-postgres never receives overlapping client.query calls.
  const items = await tx.itemService.findMany({ where: { id: { in: catalogueIds }, workspaceId, OR: [{ archivedAt: null }, { id: { in: [...existingReferences.catalogueItemIds] } }] } });
  const rates = await tx.customRate.findMany({ where: { id: { in: rateIds }, workspaceId, OR: [{ isActive: true }, { id: { in: [...existingReferences.rateIds] } }] } });
  if (items.length !== catalogueIds.length) throw new BusinessDataValidationError({ lines: ["A selected catalogue item is unavailable."] });
  const itemIds = new Set(items.map(({ id }) => id)); const itemMap = new Map(items.map((item) => [item.id, item])); const rateMap = new Map(rates.map((rate) => [rate.id, rate]));
  const calculatedLines = lines.map((line, index) => {
    if (line.catalogItemId && !itemIds.has(line.catalogItemId)) throw new BusinessDataValidationError({ lines: ["A selected catalogue entry is invalid."] });
    if (line.catalogItemId && itemMap.get(line.catalogItemId)?.currency !== currency) throw new BusinessDataValidationError({ lines: ["Catalogue item currency must match the document currency."] });
    const item = line.catalogItemId ? itemMap.get(line.catalogItemId) : null;
    const taxTreatment = line.taxTreatment ?? item?.defaultTaxTreatment ?? "STANDARD_RATED";
    const taxTreatmentReason = line.taxTreatmentReason ?? (line.taxTreatment === undefined ? item?.taxTreatmentReason : null) ?? null;
    const taxTreatmentReference = line.taxTreatmentReference ?? (line.taxTreatment === undefined ? item?.taxTreatmentReference : null) ?? null;
    if (taxTreatment !== "STANDARD_RATED" && !taxTreatmentReason?.trim()) {
      throw new BusinessDataValidationError({ lines: ["Every zero-rated or exempt line needs a classification reason."] });
    }
    if (taxTreatment !== "STANDARD_RATED" && !taxTreatmentReference?.trim()) {
      throw new BusinessDataValidationError({ lines: ["Every zero-rated or exempt line needs a supporting classification/reference."] });
    }
    const previous = line.id ? existingReferences.lines.get(line.id) : null;
    const preserveRateSnapshot = Boolean(previous && previous.customRateId === line.customRateId && previous.rateTypeSnapshot && previous.rateValueSnapshot);
    const candidateRate = line.customRateId ? rateMap.get(line.customRateId) : null;
    const liveRate = candidateRate?.isActive ? candidateRate : null;
    if (line.customRateId && !preserveRateSnapshot && !liveRate) throw new BusinessDataValidationError({ lines: ["A selected workspace custom rate is unavailable."] });
    const rate = preserveRateSnapshot ? { id: line.customRateId!, name: previous!.rateNameSnapshot!, type: previous!.rateTypeSnapshot!, value: previous!.rateValueSnapshot! } : liveRate;
    let calculated;
    try {
      calculated = calculateDocumentLine({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        priceMode: calculationContext.priceMode,
        taxTreatment,
        reliefApplied: line.reliefApplied,
        supplierVatEligible: calculationContext.supplierVatEligible,
        statutoryComponents: calculationContext.statutoryComponents,
        rate: rate ? { type: rate.type, value: rate.value.toString() } : null,
      });
    } catch {
      throw new BusinessDataValidationError({ lines: ["Line quantities, prices, discounts, tax treatments, or rates are invalid."] });
    }
    return {
      catalogItemId: line.catalogItemId,
      customRateId: rate?.id ?? null,
      description: calculated.description,
      quantity: calculated.quantity,
      unitPrice: calculated.unitPrice,
      unitOfMeasure: line.unitOfMeasure ?? item?.unitLabel ?? null,
      taxTreatment,
      taxTreatmentReason,
      taxTreatmentReference,
      reliefApplied: line.reliefApplied,
      reliefReason: line.reliefReason,
      reliefReference: line.reliefReference,
      originalAmount: calculated.originalAmount,
      discountAmount: calculated.discountAmount,
      lineSubtotal: calculated.lineSubtotal,
      taxableBase: calculated.taxableBase,
      rateNameSnapshot: rate?.name ?? null,
      rateTypeSnapshot: rate?.type ?? null,
      rateValueSnapshot: rate?.value ?? null,
      rateTotal: calculated.rateTotal,
      taxTotal: calculated.taxTotal,
      taxCalculation: calculated.taxComponents.length
        ? { components: calculated.taxComponents.map((component) => ({ code: component.code, name: component.name, rate: component.rate, order: component.calculationOrder, baseStrategy: component.baseStrategy, calculationBase: component.calculationBase, amount: component.amount })) } as unknown as Prisma.InputJsonValue
        : Prisma.JsonNull,
      lineTotal: calculated.lineTotal,
      lineOrder: index + 1,
      taxComponents: calculated.taxComponents,
    };
  });
  const totals = calculateDraftTotals(calculatedLines);
  const prepared = calculatedLines.map(({ taxComponents, ...line }) => {
    void taxComponents;
    return line;
  });
  return { prepared, totals };
}

async function resolveCalculationContext(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  workspace: {
    vatRegistrationStatus: "NOT_REGISTERED" | "PENDING" | "REGISTERED" | "DEREGISTERED";
    vatRegistrationEffectiveDate: Date | null;
    vatDeregistrationEffectiveDate: Date | null;
  },
  parsed: ReturnType<typeof draftInputSchema.parse>,
) {
  const paymentDates = parsed.paymentEvents.map(({ occurredAt }) => occurredAt);
  const taxPointDateTime = determineTaxPointDateTime({ supplyDate: parsed.supplyDate, documentDate: parsed.draftDate, paymentDates });
  const taxPointDate = taxPointDateTime;
  const supplierVatEligible = isVatEligibleAtTaxPoint(workspace, taxPointDate);
  if (["CREDIT_NOTE", "DEBIT_NOTE"].includes(parsed.type)) {
    const original = parsed.originalDocumentId ? await tx.document.findFirst({
      where: { id: parsed.originalDocumentId, workspaceId, status: "ISSUED", archivedAt: null, type: { notIn: ["CREDIT_NOTE", "DEBIT_NOTE"] } },
      select: { id: true, type: true, currency: true, documentNumber: true, issueDate: true, taxVersionId: true, snapshot: { select: { payload: true } } },
    }) : null;
    const originalSnapshot = original?.snapshot ? issuedDocumentSnapshotSchema.safeParse(original.snapshot.payload) : null;
    if (!original || !originalSnapshot?.success) throw new BusinessDataValidationError({ originalDocumentId: ["Select an available issued document from this workspace."] });
    if (original.currency !== parsed.currency) throw new BusinessDataValidationError({ currency: ["An adjustment must use the original document currency."] });
    const components: TrustedTaxComponent[] = originalSnapshot.data.tax?.components.map((component) => ({
      code: component.code,
      name: component.name,
      rate: component.rate,
      calculationOrder: component.order,
      baseStrategy: component.baseStrategy,
      contributesToTaxableValue: false,
      contributesToTotal: true,
    })) ?? [];
    const taxVersion: TrustedTaxVersion | null = originalSnapshot.data.tax ? {
      id: originalSnapshot.data.tax.version.id,
      version: originalSnapshot.data.tax.version.code,
      effectiveFrom: new Date(`${originalSnapshot.data.tax.version.effectiveFrom}T00:00:00.000Z`),
      effectiveTo: originalSnapshot.data.tax.version.effectiveTo ? new Date(`${originalSnapshot.data.tax.version.effectiveTo}T00:00:00.000Z`) : null,
      profile: originalSnapshot.data.tax.profile,
      components,
    } : null;
    return { taxPointDate, taxPointDateTime, supplierVatEligible: components.length > 0, statutoryComponents: components, taxVersion, original, originalSnapshot: originalSnapshot.data };
  }
  const statutoryTaxDocument = isStatutoryTaxDocument(parsed.type, parsed.receiptType);
  const needsTaxVersion = supplierVatEligible && statutoryTaxDocument;
  if (needsTaxVersion && parsed.currency !== "GHS") {
    throw new BusinessDataValidationError({
      currency: ["Documents charging Ghana VAT-family taxes must use GHS."],
    });
  }
  const taxVersion = needsTaxVersion ? await resolveGhanaVatVersion(taxPointDate, tx) : null;
  return { taxPointDate, taxPointDateTime, supplierVatEligible: supplierVatEligible && statutoryTaxDocument, statutoryComponents: taxVersion?.components ?? [], taxVersion, original: null, originalSnapshot: null };
}

function prepareDocumentCalculation(
  totals: Awaited<ReturnType<typeof prepareLines>>["totals"],
  context: Awaited<ReturnType<typeof resolveCalculationContext>>,
  parsed: ReturnType<typeof draftInputSchema.parse>,
) {
  const { withholdingAmount, netPayable } = calculateNetPayable(totals.grandTotal, parsed.withholdingApplied, parsed.withholdingAmount);
  const paymentTotal = parsed.paymentEvents.reduce((sum, event) => sum.add(event.amount), new Prisma.Decimal(0));
  if (paymentTotal.gt(totals.grandTotal)) throw new BusinessDataValidationError({ paymentEvents: ["Recorded payments cannot exceed the document total."] });
  if (parsed.type === "CREDIT_NOTE" && context.originalSnapshot && totals.subtotal.gt(context.originalSnapshot.totals.subtotal)) {
    throw new BusinessDataValidationError({ lines: ["A credit note cannot reduce the original supply below zero."] });
  }
  if (parsed.withholdingApplied && withholdingAmount.gt(totals.grandTotal)) throw new BusinessDataValidationError({ withholdingAmount: ["VAT withholding cannot exceed the gross document total."] });
  const snapshotComponents = totals.taxComponents.length ? totals.taxComponents : context.taxVersion?.components.map((component) => ({
    ...component,
    calculationBase: "0.00",
    amount: "0.00",
  })) ?? [];
  const taxCalculation = context.taxVersion ? buildTaxSnapshot(context.taxVersion, {
    base: totals.taxableValue.toFixed(2),
    taxableValue: totals.taxableValue.toFixed(2),
    taxTotal: totals.taxTotal.toFixed(2),
    grossTotal: totals.taxableValue.add(totals.taxTotal).toFixed(2),
    components: snapshotComponents,
  }) as unknown as Prisma.InputJsonValue : Prisma.JsonNull;
  return {
    taxVersionId: context.taxVersion?.id ?? context.original?.taxVersionId ?? null,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    rateTotal: totals.rateTotal,
    taxableValue: totals.taxableValue,
    taxTotal: totals.taxTotal,
    grandTotal: totals.grandTotal,
    standardRatedValue: totals.standardRatedValue,
    zeroRatedValue: totals.zeroRatedValue,
    exemptValue: totals.exemptValue,
    relievedValue: totals.relievedValue,
    withholdingApplied: parsed.withholdingApplied,
    withholdingAgent: parsed.withholdingApplied && parsed.withholdingAgent,
    withholdingAmount,
    withholdingReference: parsed.withholdingApplied ? parsed.withholdingReference : null,
    withholdingEvidence: parsed.withholdingApplied ? parsed.withholdingEvidence : null,
    withholdingDate: parsed.withholdingApplied && parsed.withholdingDate ? new Date(`${parsed.withholdingDate}T00:00:00.000Z`) : null,
    netPayable,
    taxCalculation,
  };
}

export async function createDraft(input: { actorUserId: string; workspaceId: string; data: unknown }, options: DraftServiceOptions = {}) {
  const parsed = draftInputSchema.safeParse(withBackwardCompatibleDraftDefaults(input.data)); if (!parsed.success) throw new BusinessDataValidationError(parsed.error.flatten().fieldErrors);
  const document = await db.$transaction(async (tx) => {
    const taxPointDate = determineTaxPointDateTime({ supplyDate: parsed.data.supplyDate, documentDate: parsed.data.draftDate, paymentDates: parsed.data.paymentEvents.map(({ occurredAt }) => occurredAt) });
    const { readiness, workspace } = await requireWorkspaceDocumentReadinessInTransaction({
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      documentType: parsed.data.type,
      taxPointDate,
      capability: CAPABILITIES.CREATE_DOCUMENT,
    }, tx);
    const customer = await resolveDraftCustomer(tx, input.workspaceId, parsed.data);
    const calculationContext = await resolveCalculationContext(tx, input.workspaceId, workspace, parsed.data);
    const { prepared, totals } = await prepareLines(tx, input.workspaceId, parsed.data.currency, parsed.data.lines, { ...calculationContext, priceMode: parsed.data.priceMode });
    const calculation = prepareDocumentCalculation(totals, calculationContext, parsed.data);
    let document = null;
    for (let attempt = 0; attempt < 5 && !document; attempt++) {
      try {
        document = await tx.document.create({ data: { workspaceId: input.workspaceId, createdByUserId: input.actorUserId, ...customer, originalDocumentId: parsed.data.originalDocumentId, adjustmentReason: parsed.data.adjustmentReason, type: parsed.data.type, receiptType: parsed.data.receiptType, fiscalizationStatus: fiscalizationStatusForDraft(parsed.data.type, parsed.data.receiptType), status: "DRAFT", isTestDocument: readiness.isTestWorkspace, draftReference: draftReference(), documentNumber: null, currency: parsed.data.currency, draftDate: new Date(`${parsed.data.draftDate}T00:00:00.000Z`), dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : null, supplyDate: parseGhanaDateTime(parsed.data.supplyDate), taxPointDate: calculationContext.taxPointDateTime, transactionType: parsed.data.transactionType, servicePeriodStart: parsed.data.servicePeriodStart ? parseGhanaDateTime(parsed.data.servicePeriodStart) : null, servicePeriodEnd: parsed.data.servicePeriodEnd ? parseGhanaDateTime(parsed.data.servicePeriodEnd) : null, priceMode: parsed.data.priceMode, notes: parsed.data.notes, ...calculation, paymentEvents: { create: parsed.data.paymentEvents.map((event, index) => ({ occurredAt: parseGhanaDateTime(event.occurredAt), amount: event.amount, method: event.method, reference: event.reference, isPartial: new Prisma.Decimal(event.amount).lt(totals.grandTotal), eventOrder: index + 1 })) }, lines: { create: prepared } }, include: { lines: true } });
      } catch (error) {
        const isDraftReferenceCollision = error instanceof Prisma.PrismaClientKnownRequestError
          && error.code === "P2002"
          && Array.isArray(error.meta?.target)
          && error.meta.target.includes("draftReference");
        if (!isDraftReferenceCollision) throw error;
        if (attempt === 4) throw new BusinessDataConflictError("Unable to allocate a unique draft reference.");
      }
    }
    await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "DOCUMENT_DRAFT_CREATED", resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT, resourceId: document!.id, metadata: { documentType: parsed.data.type, draftReference: document!.draftReference } });
    return document!;
  }, businessDataTransactionOptions);
  return attachReusableCustomer(document, input, options);
}

export async function updateDraft(input: { actorUserId: string; workspaceId: string; documentId: unknown; data: unknown }, options: DraftServiceOptions = {}) {
  const id = documentIdSchema.safeParse(input.documentId); const parsed = draftInputSchema.safeParse(withBackwardCompatibleDraftDefaults(input.data));
  if (!id.success || !parsed.success) throw new BusinessDataValidationError(parsed.success ? {} : parsed.error.flatten().fieldErrors);
  const document = await db.$transaction(async (tx) => {
    await lockBusinessResource(tx, `document:${id.data}`); const { document: before } = await requireDocumentAccessInTransaction(tx, input.actorUserId, input.workspaceId, id.data);
    const taxPointDate = determineTaxPointDateTime({ supplyDate: parsed.data.supplyDate, documentDate: parsed.data.draftDate, paymentDates: parsed.data.paymentEvents.map(({ occurredAt }) => occurredAt) });
    const { readiness, workspace } = await requireWorkspaceDocumentReadinessInTransaction({
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      documentType: parsed.data.type,
      taxPointDate,
      capability: CAPABILITIES.UPDATE_DRAFT_DOCUMENT,
    }, tx);
    if (before.isTestDocument !== readiness.isTestWorkspace) {
      throw new BusinessDataConflictError("A document's TEST status cannot be changed.");
    }
    const customer = await resolveDraftCustomer(tx, input.workspaceId, parsed.data, before);
    const existingLines = await tx.documentLine.findMany({ where: { documentId: id.data }, select: { id: true, catalogItemId: true, customRateId: true, rateNameSnapshot: true, rateTypeSnapshot: true, rateValueSnapshot: true } });
    const calculationContext = await resolveCalculationContext(tx, input.workspaceId, workspace, parsed.data);
    const { prepared, totals } = await prepareLines(tx, input.workspaceId, parsed.data.currency, parsed.data.lines, { ...calculationContext, priceMode: parsed.data.priceMode }, {
      catalogueItemIds: new Set(existingLines.flatMap(({ catalogItemId }) => catalogItemId ? [catalogItemId] : [])),
      rateIds: new Set(existingLines.flatMap(({ customRateId }) => customRateId ? [customRateId] : [])),
      lines: new Map(existingLines.map((line) => [line.id, line])),
    });
    const calculation = prepareDocumentCalculation(totals, calculationContext, parsed.data);
    await tx.documentPaymentEvent.deleteMany({ where: { documentId: id.data } });
    await tx.documentLine.deleteMany({ where: { documentId: id.data } });
    const document = await tx.document.update({ where: { id: id.data }, data: { ...customer, originalDocumentId: parsed.data.originalDocumentId, adjustmentReason: parsed.data.adjustmentReason, type: parsed.data.type, receiptType: parsed.data.receiptType, fiscalizationStatus: fiscalizationStatusForDraft(parsed.data.type, parsed.data.receiptType), currency: parsed.data.currency, draftDate: new Date(`${parsed.data.draftDate}T00:00:00.000Z`), dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : null, supplyDate: parseGhanaDateTime(parsed.data.supplyDate), taxPointDate: calculationContext.taxPointDateTime, transactionType: parsed.data.transactionType, servicePeriodStart: parsed.data.servicePeriodStart ? parseGhanaDateTime(parsed.data.servicePeriodStart) : null, servicePeriodEnd: parsed.data.servicePeriodEnd ? parseGhanaDateTime(parsed.data.servicePeriodEnd) : null, priceMode: parsed.data.priceMode, notes: parsed.data.notes, ...calculation, paymentEvents: { create: parsed.data.paymentEvents.map((event, index) => ({ occurredAt: parseGhanaDateTime(event.occurredAt), amount: event.amount, method: event.method, reference: event.reference, isPartial: new Prisma.Decimal(event.amount).lt(totals.grandTotal), eventOrder: index + 1 })) }, lines: { create: prepared } }, include: { lines: true } });
    const changedFields = [
      ...(before.type !== document.type ? ["documentType"] : []),
      ...(before.receiptType !== document.receiptType ? ["receiptType"] : []),
      ...(before.customerTaxStatus !== document.customerTaxStatus ? ["customerTaxStatus"] : []),
      ...(before.transactionType !== document.transactionType ? ["transactionType"] : []),
      ...(before.priceMode !== document.priceMode ? ["priceMode"] : []),
      ...(String(before.supplyDate ?? "") !== String(document.supplyDate ?? "") ? ["supplyDate"] : []),
      ...(String(before.servicePeriodStart ?? "") !== String(document.servicePeriodStart ?? "") || String(before.servicePeriodEnd ?? "") !== String(document.servicePeriodEnd ?? "") ? ["servicePeriod"] : []),
      ...(before.withholdingApplied !== document.withholdingApplied ? ["withholdingApplied"] : []),
      ...(before.withholdingAgent !== document.withholdingAgent ? ["withholdingAgent"] : []),
      ...(!before.withholdingAmount.eq(document.withholdingAmount) ? ["withholdingAmount"] : []),
      ...(before.withholdingReference !== document.withholdingReference ? ["withholdingReference"] : []),
      ...(before.withholdingEvidence !== document.withholdingEvidence ? ["withholdingEvidence"] : []),
      "lines",
      "paymentEvents",
    ];
    await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "DOCUMENT_DRAFT_UPDATED", resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT, resourceId: document.id, metadata: { documentType: parsed.data.type, draftReference: before.draftReference, total: document.grandTotal.toString(), currency: document.currency, changedFields } });
    return document;
  }, businessDataTransactionOptions);
  return attachReusableCustomer(document, input, options);
}

export async function archiveDraft(input: { actorUserId: string; workspaceId: string; documentId: unknown }) {
  const id = documentIdSchema.safeParse(input.documentId); if (!id.success) throw new BusinessDataValidationError({ documentId: ["Invalid draft."] });
  return db.$transaction(async (tx) => {
    await lockBusinessResource(tx, `document:${id.data}`);
    const { document } = await requireDocumentAccessInTransaction(tx, input.actorUserId, input.workspaceId, id.data);
    if (document.status !== "DRAFT") throw new BusinessDataConflictError("Issued documents cannot be archived or deleted. Use a credit note, debit note, or audited void where appropriate.");
    const archived = await tx.document.update({ where: { id: id.data }, data: { archivedAt: new Date() } });
    await recordAuditEvent(tx, { workspaceId: input.workspaceId, actorUserId: input.actorUserId, action: "DOCUMENT_DRAFT_ARCHIVED", resourceType: AUDIT_RESOURCE_TYPES.DOCUMENT, resourceId: id.data, metadata: { draftReference: document.draftReference } });
    return archived;
  }, businessDataTransactionOptions);
}

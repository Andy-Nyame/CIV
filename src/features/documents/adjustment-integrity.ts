import { Prisma } from "@/generated/prisma/client";

import type { IssuedDocumentSnapshot } from "./snapshots";

export type AdjustmentIntegrityIssue = {
  code: "ADJUSTMENT_TAX_CONTEXT_INVALID" | "CREDIT_LIMIT_EXCEEDED";
  message: string;
  field: "lines";
};

type Amounts = {
  subtotal: Prisma.Decimal;
  tax: Prisma.Decimal;
  customRates: Prisma.Decimal;
  total: Prisma.Decimal;
};

const zeroAmounts = (): Amounts => ({
  subtotal: new Prisma.Decimal(0),
  tax: new Prisma.Decimal(0),
  customRates: new Prisma.Decimal(0),
  total: new Prisma.Decimal(0),
});

function addAmounts(left: Amounts, right: Amounts): Amounts {
  return {
    subtotal: left.subtotal.add(right.subtotal),
    tax: left.tax.add(right.tax),
    customRates: left.customRates.add(right.customRates),
    total: left.total.add(right.total),
  };
}

function exceeds(used: Amounts, candidate: Amounts, available: Amounts) {
  return used.subtotal.add(candidate.subtotal).gt(available.subtotal)
    || used.tax.add(candidate.tax).gt(available.tax)
    || used.customRates.add(candidate.customRates).gt(available.customRates)
    || used.total.add(candidate.total).gt(available.total);
}

function snapshotAmounts(snapshot: IssuedDocumentSnapshot): Amounts {
  return {
    subtotal: new Prisma.Decimal(snapshot.totals.subtotal),
    tax: new Prisma.Decimal(snapshot.totals.trustedTax),
    customRates: new Prisma.Decimal(snapshot.totals.customRates),
    total: new Prisma.Decimal(snapshot.totals.grandTotal),
  };
}

function canonicalRate(value: string) {
  return new Prisma.Decimal(value).toString();
}

function taxVersionContext(snapshot: IssuedDocumentSnapshot) {
  if (!snapshot.tax) return null;
  return {
    profile: {
      jurisdiction: snapshot.tax.profile.jurisdiction,
      code: snapshot.tax.profile.code,
    },
    version: snapshot.tax.version,
    components: snapshot.tax.components.map((component) => ({
      code: component.code,
      name: component.name,
      rate: canonicalRate(component.rate),
      order: component.order,
      baseStrategy: component.baseStrategy,
    })),
  };
}

function lineContext(snapshot: IssuedDocumentSnapshot, line: IssuedDocumentSnapshot["lines"][number]) {
  const statutoryComponents = line.tax?.components
    ?? (line.taxTreatment === "STANDARD_RATED" && !line.relief && snapshot.tax
      ? snapshot.tax.components
      : []);
  return JSON.stringify({
    taxTreatment: line.taxTreatment,
    relieved: Boolean(line.relief),
    statutoryComponents: statutoryComponents.map((component) => ({
      code: component.code,
      name: component.name,
      rate: canonicalRate(component.rate),
      order: component.order,
      baseStrategy: component.baseStrategy,
    })),
    customRate: line.customRate ? {
      name: line.customRate.name,
      type: line.customRate.type,
      value: canonicalRate(line.customRate.value),
    } : null,
  });
}

function lineAmounts(line: IssuedDocumentSnapshot["lines"][number]): Amounts {
  return {
    subtotal: new Prisma.Decimal(line.subtotal),
    tax: new Prisma.Decimal(line.tax?.amount ?? 0),
    customRates: new Prisma.Decimal(line.customRate?.amount ?? 0),
    total: new Prisma.Decimal(line.total),
  };
}

function contextAmounts(snapshot: IssuedDocumentSnapshot) {
  const amounts = new Map<string, Amounts>();
  for (const line of snapshot.lines) {
    const context = lineContext(snapshot, line);
    amounts.set(context, addAmounts(amounts.get(context) ?? zeroAmounts(), lineAmounts(line)));
  }
  return amounts;
}

/**
 * Validates an adjustment exclusively against immutable issued snapshots.
 * Draft/live workspace tax settings are intentionally not consulted here.
 */
export function validateAdjustmentIntegrity(input: {
  original: IssuedDocumentSnapshot;
  adjustment: IssuedDocumentSnapshot;
  priorIssuedCredits?: IssuedDocumentSnapshot[];
}): AdjustmentIntegrityIssue[] {
  const { original, adjustment } = input;
  const isCredit = adjustment.document.type === "CREDIT_NOTE";
  const isDebit = adjustment.document.type === "DEBIT_NOTE";
  const referenceMatches = adjustment.document.adjustment?.originalDocumentId === original.document.id;
  const directionMatches = adjustment.document.adjustment?.direction === (isCredit ? "REDUCE" : "INCREASE");
  const taxVersionMatches = JSON.stringify(taxVersionContext(adjustment)) === JSON.stringify(taxVersionContext(original));
  const priceModeMatches = adjustment.document.priceMode === original.document.priceMode;
  const originalContexts = contextAmounts(original);
  const adjustmentContexts = contextAmounts(adjustment);
  const contextsMatch = [...adjustmentContexts.keys()].every((context) => originalContexts.has(context));

  if ((!isCredit && !isDebit) || !referenceMatches || !directionMatches || !taxVersionMatches || !priceModeMatches || !contextsMatch) {
    return [{
      code: "ADJUSTMENT_TAX_CONTEXT_INVALID",
      message: "Adjustment lines must retain a tax treatment, relief state, price mode, and rate context from the frozen original document.",
      field: "lines",
    }];
  }

  if (!isCredit) return [];

  const priorCredits = input.priorIssuedCredits ?? [];
  const priorContextsValid = priorCredits.every((credit) =>
    credit.document.type === "CREDIT_NOTE"
    && credit.document.adjustment?.originalDocumentId === original.document.id
    && credit.document.adjustment.direction === "REDUCE"
    && credit.document.priceMode === original.document.priceMode
    && JSON.stringify(taxVersionContext(credit)) === JSON.stringify(taxVersionContext(original))
    && [...contextAmounts(credit).keys()].every((context) => originalContexts.has(context)),
  );
  if (!priorContextsValid) {
    return [{
      code: "ADJUSTMENT_TAX_CONTEXT_INVALID",
      message: "An existing credit note has a tax/rate context inconsistent with the frozen original document.",
      field: "lines",
    }];
  }
  const priorTotals = priorCredits.reduce(
    (total, credit) => addAmounts(total, snapshotAmounts(credit)),
    zeroAmounts(),
  );
  if (exceeds(priorTotals, snapshotAmounts(adjustment), snapshotAmounts(original))) {
    return [{
      code: "CREDIT_LIMIT_EXCEEDED",
      message: "This credit note exceeds the original document's remaining adjustable subtotal, tax, custom-rate charge, or total.",
      field: "lines",
    }];
  }

  const priorContextTotals = new Map<string, Amounts>();
  for (const credit of priorCredits) {
    for (const [context, amounts] of contextAmounts(credit)) {
      priorContextTotals.set(context, addAmounts(priorContextTotals.get(context) ?? zeroAmounts(), amounts));
    }
  }
  for (const [context, candidate] of adjustmentContexts) {
    const available = originalContexts.get(context);
    if (!available || exceeds(priorContextTotals.get(context) ?? zeroAmounts(), candidate, available)) {
      return [{
        code: "CREDIT_LIMIT_EXCEEDED",
        message: "This credit note exceeds the remaining value available in an original supply's frozen tax/rate context.",
        field: "lines",
      }];
    }
  }

  return [];
}

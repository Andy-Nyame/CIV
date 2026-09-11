"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import { buildAppliedRateRows } from "@/features/documents/applied-rates";
import { saveDraftAction, type DraftFormState } from "@/features/documents/actions";
import { isVatEligibleAtTaxPoint } from "@/features/tax/eligibility";

type TaxTreatment = "STANDARD_RATED" | "ZERO_RATED" | "EXEMPT";
type DocumentType = "INVOICE" | "RECEIPT" | "VAT_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
type Line = {
  id?: string;
  catalogItemId: string | null;
  customRateId: string | null;
  originalCustomRateId?: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  unitOfMeasure: string | null;
  discountAmount: string;
  taxTreatment: TaxTreatment;
  taxTreatmentReason: string | null;
  taxTreatmentReference: string | null;
  reliefApplied: boolean;
  reliefReason: string | null;
  reliefReference: string | null;
  rateNameSnapshot?: string | null;
  rateTypeSnapshot?: "PERCENTAGE" | "FIXED" | null;
  rateValueSnapshot?: string | null;
};
type Option = { id: string; name: string };
type TaxComponent = { code: string; name: string; rate: string; calculationOrder: number; baseStrategy: "ORIGINAL_BASE" | "BASE_PLUS_APPLICABLE_LEVIES"; contributesToTaxableValue: boolean; contributesToTotal: boolean };
type SavedCalculation = { base?: string; taxableValue?: string; taxTotal?: string; grossTotal?: string; components?: Array<{ code: string; name: string; rate: string; amount: string }> };
type OriginalDocument = { id: string; documentNumber: string | null; type: string; issueDate: Date | string | null; currency: string };

const rounded = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const blankLine = (): Line => ({ catalogItemId: null, customRateId: null, description: "", quantity: "1", unitPrice: "0.00", unitOfMeasure: "Each", discountAmount: "0.00", taxTreatment: "STANDARD_RATED", taxTreatmentReason: null, taxTreatmentReference: null, reliefApplied: false, reliefReason: null, reliefReference: null });

export function DraftEditor({ documentId, initial, customers, items, rates, trustedTax, workspaceVat, originalDocuments, isTestDocument = false }: {
  documentId: string | null;
  initial: {
    type: DocumentType; customerId: string | null; customerName: string; currency: string;
    draftDate: string; supplyDate: string; dueDate: string; transactionType: "SALE" | "SERVICE" | "HIRE_OR_LEASE" | "EXCHANGE" | "OTHER";
    priceMode: "TAX_EXCLUSIVE" | "TAX_INCLUSIVE"; originalDocumentId: string | null; adjustmentReason: string;
    withholdingApplied: boolean; withholdingAmount: string; withholdingReference: string; withholdingDate: string;
    notes: string; lines: Line[]; savedCalculation: SavedCalculation | null;
  };
  customers: Option[];
  items: Array<Option & { description: string | null; unitPrice: string; currency: string; unitLabel: string | null; defaultTaxTreatment: TaxTreatment; taxTreatmentReason: string | null; taxTreatmentReference: string | null }>;
  rates: Array<Option & { type: "PERCENTAGE" | "FIXED"; value: string }>;
  trustedTax: { name: string; version: string; components: TaxComponent[] } | null;
  workspaceVat: { vatRegistrationStatus: "NOT_REGISTERED" | "PENDING" | "REGISTERED" | "DEREGISTERED"; vatRegistrationEffectiveDate: Date | string | null; vatDeregistrationEffectiveDate: Date | string | null };
  originalDocuments: OriginalDocument[];
  isTestDocument?: boolean;
}) {
  const [state, action, pending] = useActionState(saveDraftAction.bind(null, documentId), {} as DraftFormState);
  const [lines, setLines] = useState(initial.lines);
  const [documentType, setDocumentType] = useState<DocumentType>(initial.type);
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [customerName, setCustomerName] = useState(initial.customerName);
  const [draftDate, setDraftDate] = useState(initial.draftDate);
  const [supplyDate, setSupplyDate] = useState(initial.supplyDate);
  const [priceMode, setPriceMode] = useState(initial.priceMode);
  const [withholdingApplied, setWithholdingApplied] = useState(initial.withholdingApplied);
  const isAdjustment = documentType === "CREDIT_NOTE" || documentType === "DEBIT_NOTE";
  const supplierVatEligible = useMemo(() => isVatEligibleAtTaxPoint(workspaceVat, [supplyDate, draftDate].sort()[0]!), [draftDate, supplyDate, workspaceVat]);

  const preview = useMemo(() => {
    const useCurrentStatutoryRates = supplierVatEligible && !isAdjustment;
    const lineResults = lines.map((line) => {
      const original = rounded((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0));
      const enteredAfterDiscount = Math.max(0, rounded(original - (Number(line.discountAmount) || 0)));
      const statutory = useCurrentStatutoryRates && line.taxTreatment === "STANDARD_RATED" && !line.reliefApplied ? trustedTax?.components ?? [] : [];
      const combinedRate = statutory.filter((component) => component.contributesToTotal).reduce((sum, component) => sum + Number(component.rate), 0);
      const base = priceMode === "TAX_INCLUSIVE" && combinedRate > 0 ? rounded(enteredAfterDiscount / (1 + combinedRate / 100)) : enteredAfterDiscount;
      const statutoryAmounts = statutory.map((component) => ({ ...component, amount: rounded(base * Number(component.rate) / 100) }));
      const taxAmount = priceMode === "TAX_INCLUSIVE" && statutory.length ? rounded(enteredAfterDiscount - base) : rounded(statutoryAmounts.reduce((sum, component) => sum + component.amount, 0));
      const persistedRate = line.customRateId && line.customRateId === line.originalCustomRateId && line.rateTypeSnapshot && line.rateValueSnapshot
        ? { id: line.customRateId, name: line.rateNameSnapshot ?? "Custom rate", type: line.rateTypeSnapshot, value: line.rateValueSnapshot }
        : undefined;
      const rate = persistedRate ?? rates.find((candidate) => candidate.id === line.customRateId);
      const rateAmount = !rate ? 0 : rounded(rate.type === "PERCENTAGE" ? base * Number(rate.value) / 100 : Number(rate.value));
      return { original, base, taxAmount, rateAmount, rate, statutoryAmounts, line };
    });
    const subtotal = rounded(lineResults.reduce((sum, line) => sum + line.base, 0));
    const discount = rounded(lineResults.reduce((sum, line) => sum + (Number(line.line.discountAmount) || 0), 0));
    const customRates = rounded(lineResults.reduce((sum, line) => sum + line.rateAmount, 0));
    const tax = rounded(lineResults.reduce((sum, line) => sum + line.taxAmount, 0));
    const statutoryByCode = new Map<string, { code: string; name: string; rate: string; amount: number }>();
    for (const result of lineResults) for (const component of result.statutoryAmounts) {
      const current = statutoryByCode.get(component.code);
      statutoryByCode.set(component.code, { ...component, amount: rounded((current?.amount ?? 0) + component.amount) });
    }
    const appliedRates = buildAppliedRateRows({
      currency: initial.currency,
      customRates: lineResults.flatMap((line) => line.rate ? [{ name: line.rate.name, type: line.rate.type, value: line.rate.value, amount: line.rateAmount.toFixed(2) }] : []),
      statutoryRates: [...statutoryByCode.values()].map((component) => ({ ...component, amount: component.amount.toFixed(2) })),
    });
    const categoryValue = (treatment: TaxTreatment, relieved = false) => rounded(lineResults.reduce((sum, result) => result.line.taxTreatment === treatment && result.line.reliefApplied === relieved ? sum + result.base : sum, 0));
    return {
      subtotal, discount, customRates, tax, appliedRates,
      grandTotal: rounded(subtotal + customRates + tax),
      standard: categoryValue("STANDARD_RATED"), zero: categoryValue("ZERO_RATED"), exempt: categoryValue("EXEMPT"),
      relieved: rounded(lineResults.reduce((sum, result) => result.line.reliefApplied ? sum + result.base : sum, 0)),
    };
  }, [initial.currency, isAdjustment, lines, priceMode, rates, supplierVatEligible, trustedTax]);

  const field = "min-h-11 w-full rounded-lg border border-border bg-page px-3 text-sm text-text focus:border-civ-blue focus:outline-none";
  const update = (index: number, patch: Partial<Line>) => setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  const updateCustomerName = (name: string) => {
    const saved = customers.find((candidate) => candidate.name.toLowerCase() === name.trim().toLowerCase());
    setCustomerName(name); setCustomerId(saved?.id ?? null);
  };

  return <form action={action} className="grid gap-7">
    {isTestDocument ? <div className="rounded-xl border-2 border-danger bg-danger px-5 py-4 text-center text-lg font-black tracking-wide text-white">TEST DOCUMENT — NOT VALID</div> : null}
    <input type="hidden" name="lines" value={JSON.stringify(lines)}/><input type="hidden" name="customerId" value={customerId ?? ""}/>
    <section className="grid gap-4 rounded-xl border border-border bg-surface p-5 sm:grid-cols-2 sm:p-6">
      <label className="grid gap-1.5 text-sm font-semibold text-text">Document type<select className={field} name="type" value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentType)}><option value="INVOICE">Invoice</option><option value="RECEIPT">Receipt</option><option value="VAT_INVOICE" disabled={!trustedTax}>VAT invoice{trustedTax ? "" : " (not available)"}</option><option value="CREDIT_NOTE">Credit note</option><option value="DEBIT_NOTE">Debit note</option></select></label>
      <label className="grid gap-1.5 text-sm font-semibold text-text">Transaction type<select className={field} name="transactionType" defaultValue={initial.transactionType}><option value="SALE">Sale</option><option value="SERVICE">Service</option><option value="HIRE_OR_LEASE">Hire or lease</option><option value="EXCHANGE">Exchange</option><option value="OTHER">Other</option></select></label>
      <label className="grid gap-1.5 text-sm font-semibold text-text">Document date<input className={field} type="date" name="draftDate" value={draftDate} onChange={(event)=>setDraftDate(event.target.value)} required/></label>
      <label className="grid gap-1.5 text-sm font-semibold text-text">Supply date<input className={field} type="date" name="supplyDate" value={supplyDate} onChange={(event)=>setSupplyDate(event.target.value)} required/></label>
      <label className="grid gap-1.5 text-sm font-semibold text-text">Due date<input className={field} type="date" name="dueDate" defaultValue={initial.dueDate}/></label>
      <label className="grid gap-1.5 text-sm font-semibold text-text">Price mode<select className={field} name="priceMode" value={priceMode} onChange={(event)=>setPriceMode(event.target.value as typeof priceMode)}><option value="TAX_EXCLUSIVE">Tax exclusive</option><option value="TAX_INCLUSIVE">Tax inclusive</option></select></label>
      <label className="grid gap-1.5 text-sm font-semibold text-text">Currency<input className={field} name="currency" defaultValue={initial.currency} maxLength={3} required/></label>
      <label className="grid gap-1.5 text-sm font-semibold text-text sm:col-span-2">Notes / terms<textarea className={`${field} min-h-24 py-3`} name="notes" defaultValue={initial.notes}/></label>
    </section>
    {isAdjustment ? <section className="grid gap-4 rounded-xl border border-border bg-surface p-5 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-text">Original issued document<select className={field} name="originalDocumentId" defaultValue={initial.originalDocumentId ?? ""} required><option value="">Select original document</option>{originalDocuments.map((document)=><option key={document.id} value={document.id}>{document.documentNumber} · {document.type.replaceAll("_", " ")}</option>)}</select></label><label className="grid gap-1.5 text-sm font-semibold text-text">Adjustment reason<input className={field} name="adjustmentReason" defaultValue={initial.adjustmentReason} required maxLength={1000}/></label><p className="text-sm text-muted sm:col-span-2">CIV uses the original issued document&apos;s frozen statutory rates. The original document is never edited.</p></section> : <><input type="hidden" name="originalDocumentId" value=""/><input type="hidden" name="adjustmentReason" value=""/></>}
    <section className="rounded-xl border border-border bg-surface p-5 sm:p-6"><label className="grid gap-1.5 text-sm font-semibold text-text">Customer name *<input className={field} name="customerName" value={customerName} onChange={(event)=>updateCustomerName(event.target.value)} list="saved-customer-names" maxLength={200} required autoComplete="off"/></label><datalist id="saved-customer-names">{customers.map((saved)=><option value={saved.name} key={saved.id}/>)}</datalist><p className="mt-2 text-sm text-muted">Start typing to reuse a saved customer, or enter a new name.</p></section>
    <section className="border-l-4 border-civ-blue bg-soft-blue p-5 dark:bg-surface-muted"><h2 className="font-bold text-text">Ghana tax treatment</h2><p className="mt-1 text-sm text-muted">{supplierVatEligible ? `VAT eligible at the current tax point${trustedTax ? ` · ${trustedTax.name} ${trustedTax.version}` : ""}.` : "No VAT-family tax will be charged at the current tax point."} Each line carries its own treatment; custom rates remain separate.</p>{trustedTax?<ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-text">{trustedTax.components.map((component)=><li key={component.code}><strong>{component.code}</strong> {Number(component.rate)}%</li>)}</ul>:null}</section>
    <section aria-labelledby="line-items-title"><div className="flex items-center justify-between gap-3"><div><h2 id="line-items-title" className="text-xl font-bold text-text">Line items</h2><p className="mt-1 text-sm text-muted">Saved totals are recalculated with exact decimal arithmetic on the server.</p></div><button type="button" className="min-h-11 rounded-lg border border-civ-blue px-4 text-sm font-semibold text-link" onClick={()=>setLines(current=>[...current,blankLine()])}>Add line</button></div>
      <div className="mt-4 grid gap-4">{lines.map((line,index)=><article key={line.id ?? index} className="rounded-xl border border-border bg-surface p-4 sm:p-5"><div className="flex items-center justify-between"><h3 className="font-bold text-text">Line {index+1}</h3><button type="button" disabled={lines.length===1} className="min-h-11 px-3 text-sm font-semibold text-danger disabled:opacity-40" onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))}>Remove</button></div><div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-semibold text-text sm:col-span-2">Catalogue entry<select className={field} value={line.catalogItemId??""} onChange={event=>{const item=items.find(i=>i.id===event.target.value);update(index,item?{catalogItemId:item.id,description:item.description||item.name,unitPrice:item.unitPrice,unitOfMeasure:item.unitLabel,taxTreatment:item.defaultTaxTreatment,taxTreatmentReason:item.taxTreatmentReason,taxTreatmentReference:item.taxTreatmentReference,reliefApplied:false,reliefReason:null,reliefReference:null}:{catalogItemId:null});}}><option value="">Custom line</option>{items.map(item=><option value={item.id} key={item.id}>{item.name} · {item.currency} {item.unitPrice}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm font-semibold text-text sm:col-span-2">Description<textarea className={`${field} min-h-20 py-3`} value={line.description} onChange={e=>update(index,{description:e.target.value})} required/></label>
        <label className="grid gap-1.5 text-sm font-semibold text-text">Quantity<input className={field} inputMode="decimal" value={line.quantity} onChange={e=>update(index,{quantity:e.target.value})} required/></label><label className="grid gap-1.5 text-sm font-semibold text-text">Unit of measure<input className={field} value={line.unitOfMeasure??""} onChange={e=>update(index,{unitOfMeasure:e.target.value})} placeholder="Each, hour, kg, service" maxLength={50}/></label>
        <label className="grid gap-1.5 text-sm font-semibold text-text">Unit price<input className={field} inputMode="decimal" value={line.unitPrice} onChange={e=>update(index,{unitPrice:e.target.value})} required/></label><label className="grid gap-1.5 text-sm font-semibold text-text">Discount amount<input className={field} inputMode="decimal" value={line.discountAmount} onChange={e=>update(index,{discountAmount:e.target.value})} required/></label>
        <label className="grid gap-1.5 text-sm font-semibold text-text">Tax treatment<select className={field} value={line.taxTreatment} onChange={e=>update(index,{taxTreatment:e.target.value as TaxTreatment,reliefApplied:false,reliefReason:null,reliefReference:null})}><option value="STANDARD_RATED">Standard-rated</option><option value="ZERO_RATED">Zero-rated</option><option value="EXEMPT">Exempt</option></select></label>
        <label className="grid gap-1.5 text-sm font-semibold text-text">Treatment reason<input className={field} value={line.taxTreatmentReason??""} onChange={e=>update(index,{taxTreatmentReason:e.target.value})} required={line.taxTreatment!=="STANDARD_RATED"}/></label>
        {line.taxTreatment!=="STANDARD_RATED"?<label className="grid gap-1.5 text-sm font-semibold text-text sm:col-span-2">Classification/support reference<input className={field} value={line.taxTreatmentReference??""} onChange={e=>update(index,{taxTreatmentReference:e.target.value})} required={line.taxTreatment==="ZERO_RATED"}/></label>:null}
        {line.taxTreatment==="STANDARD_RATED"?<label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-text sm:col-span-2"><input type="checkbox" checked={line.reliefApplied} onChange={e=>update(index,{reliefApplied:e.target.checked})}/>Apply transaction-specific relief</label>:null}
        {line.reliefApplied?<><label className="grid gap-1.5 text-sm font-semibold text-text">Relief reason<input className={field} value={line.reliefReason??""} onChange={e=>update(index,{reliefReason:e.target.value})} required/></label><label className="grid gap-1.5 text-sm font-semibold text-text">Relief support reference<input className={field} value={line.reliefReference??""} onChange={e=>update(index,{reliefReference:e.target.value})} required/></label></>:null}
        <label className="grid gap-1.5 text-sm font-semibold text-text sm:col-span-2">Custom rate / charge<select className={field} value={line.customRateId??""} onChange={e=>update(index,{customRateId:e.target.value||null})}><option value="">No custom rate</option>{rates.map(rate=><option value={rate.id} key={rate.id}>{rate.name} · {rate.value}{rate.type==="PERCENTAGE"?"%":" fixed"}</option>)}</select></label>
      </div></article>)}</div>
    </section>
    <section className="rounded-xl border border-border bg-surface p-5"><h2 className="font-bold text-text">Calculation preview</h2><p className="mt-1 text-sm text-muted">Immediate estimate only. CIV recalculates authoritative values on save and issue.</p><dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><div className="flex justify-between gap-3"><dt>Post-discount base</dt><dd>{initial.currency} {preview.subtotal.toFixed(2)}</dd></div>{preview.discount>0?<div className="flex justify-between gap-3"><dt>Discount</dt><dd>{initial.currency} {preview.discount.toFixed(2)}</dd></div>:null}<div className="flex justify-between gap-3"><dt>Standard-rated value</dt><dd>{initial.currency} {preview.standard.toFixed(2)}</dd></div><div className="flex justify-between gap-3"><dt>Zero-rated value</dt><dd>{initial.currency} {preview.zero.toFixed(2)}</dd></div><div className="flex justify-between gap-3"><dt>Exempt value</dt><dd>{initial.currency} {preview.exempt.toFixed(2)}</dd></div><div className="flex justify-between gap-3"><dt>Relieved value</dt><dd>{initial.currency} {preview.relieved.toFixed(2)}</dd></div>{preview.appliedRates.map((rate)=><div className="flex justify-between gap-3" key={rate.key}><dt>{rate.label}</dt><dd>{initial.currency} {rate.amount}</dd></div>)}<div className="flex justify-between gap-3 font-bold sm:col-span-2"><dt>Gross total</dt><dd>{initial.currency} {preview.grandTotal.toFixed(2)}</dd></div></dl>{initial.savedCalculation?.components?.length?<div className="mt-5 border-t border-border pt-4"><p className="text-xs font-bold uppercase tracking-wide text-muted">Last server-saved trusted calculation</p><p className="mt-2 text-sm text-text">Tax {initial.savedCalculation.taxTotal} · Tax-inclusive value {initial.savedCalculation.grossTotal}</p></div>:null}</section>
    <section className="rounded-xl border border-border bg-surface p-5"><label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-text"><input type="checkbox" name="withholdingApplied" checked={withholdingApplied} onChange={(event)=>setWithholdingApplied(event.target.checked)}/>Record certified VAT withholding</label>{withholdingApplied?<div className="mt-4 grid gap-4 sm:grid-cols-3"><label className="grid gap-1.5 text-sm font-semibold text-text">Withheld amount<input className={field} name="withholdingAmount" defaultValue={initial.withholdingAmount} inputMode="decimal" required/></label><label className="grid gap-1.5 text-sm font-semibold text-text">Certificate/reference<input className={field} name="withholdingReference" defaultValue={initial.withholdingReference} required/></label><label className="grid gap-1.5 text-sm font-semibold text-text">Certificate date<input className={field} type="date" name="withholdingDate" defaultValue={initial.withholdingDate}/></label></div>:<><input type="hidden" name="withholdingAmount" value="0"/><input type="hidden" name="withholdingReference" value=""/><input type="hidden" name="withholdingDate" value=""/></>}<p className="mt-2 text-sm text-muted">Withholding is a settlement credit and never reduces statutory output tax.</p></section>
    <section className="flex flex-wrap justify-end gap-2"><Link href="/app/documents" className="min-h-11 rounded-lg border border-border px-4 py-3 text-sm font-semibold text-text">Back</Link><button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-5 text-sm font-semibold text-white disabled:opacity-60">{pending?"Saving…":"Save Draft"}</button></section>{state.message?<p role="status" className={state.errors?"text-sm text-danger":"text-sm text-success"}>{state.message}</p>:null}
  </form>;
}

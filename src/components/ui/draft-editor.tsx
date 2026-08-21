"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { saveDraftAction, type DraftFormState } from "@/features/documents/actions";

type Line = { id?: string; catalogItemId: string | null; customRateId: string | null; description: string; quantity: string; unitPrice: string };
type Option = { id: string; name: string };
type TaxComponent = { code: string; name: string; rate: string; calculationOrder: number; baseStrategy: "ORIGINAL_BASE" | "BASE_PLUS_APPLICABLE_LEVIES"; contributesToTaxableValue: boolean; contributesToTotal: boolean };
type SavedCalculation = { base?: string; taxableValue?: string; taxTotal?: string; grossTotal?: string; components?: Array<{ code: string; name: string; rate: string; amount: string }> };
const rounded = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function DraftEditor({ documentId, initial, customers, items, rates, trustedTax }: {
  documentId: string | null;
  initial: { type: string; customerId: string | null; currency: string; draftDate: string; dueDate: string; notes: string; lines: Line[]; savedCalculation: SavedCalculation | null };
  customers: Option[];
  items: Array<Option & { description: string | null; unitPrice: string; currency: string }>;
  rates: Array<Option & { type: string; value: string }>;
  trustedTax: { name: string; version: string; components: TaxComponent[] };
}) {
  const [state, action, pending] = useActionState(saveDraftAction.bind(null, documentId), {} as DraftFormState);
  const [lines, setLines] = useState(initial.lines);
  const [documentType, setDocumentType] = useState(initial.type);
  const preview = useMemo(() => {
    const lineResults = lines.map((line) => {
      const subtotal = rounded((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0));
      const rate = documentType === "VAT_INVOICE" ? undefined : rates.find((candidate) => candidate.id === line.customRateId);
      const rateAmount = !rate ? 0 : rounded(rate.type === "PERCENTAGE" ? subtotal * Number(rate.value) / 100 : Number(rate.value));
      return { subtotal, rateAmount };
    });
    const base = rounded(lineResults.reduce((sum, line) => sum + line.subtotal, 0));
    const customRates = rounded(lineResults.reduce((sum, line) => sum + line.rateAmount, 0));
    let applicableLevies = 0;
    const components = documentType === "VAT_INVOICE" ? [...trustedTax.components].sort((a, b) => a.calculationOrder - b.calculationOrder).map((component) => {
      const calculationBase = component.baseStrategy === "ORIGINAL_BASE" ? base : rounded(base + applicableLevies);
      const amount = rounded(calculationBase * Number(component.rate) / 100);
      if (component.contributesToTaxableValue) applicableLevies = rounded(applicableLevies + amount);
      return { ...component, amount };
    }) : [];
    const taxableValue = rounded(base + applicableLevies);
    const trustedTaxTotal = rounded(components.filter((component) => component.contributesToTotal).reduce((sum, component) => sum + component.amount, 0));
    return { base, customRates, taxableValue, components, grandTotal: documentType === "VAT_INVOICE" ? rounded(base + trustedTaxTotal) : rounded(base + customRates) };
  }, [documentType, lines, rates, trustedTax.components]);
  const field = "min-h-11 w-full rounded-lg border border-border bg-page px-3 text-sm text-text focus:border-civ-blue focus:outline-none";
  const update = (index: number, patch: Partial<Line>) => setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  const useVat = documentType === "VAT_INVOICE";

  return <form action={action} className="grid gap-7"><input type="hidden" name="lines" value={JSON.stringify(lines)}/>
    <section className="grid gap-4 rounded-xl border border-border bg-surface p-5 sm:grid-cols-2 sm:p-6"><label className="grid gap-1.5 text-sm font-semibold text-text">Document type<select className={field} name="type" value={documentType} onChange={(event) => { const type = event.target.value; setDocumentType(type); if (type === "VAT_INVOICE") setLines((current) => current.map((line) => ({ ...line, customRateId: null }))); }}><option value="INVOICE">Invoice</option><option value="RECEIPT">Receipt</option><option value="VAT_INVOICE">VAT invoice</option></select></label><label className="grid gap-1.5 text-sm font-semibold text-text">Customer<select className={field} name="customerId" defaultValue={initial.customerId??""}><option value="">No customer selected</option>{customers.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label className="grid gap-1.5 text-sm font-semibold text-text">Draft date<input className={field} type="date" name="draftDate" defaultValue={initial.draftDate} required/></label><label className="grid gap-1.5 text-sm font-semibold text-text">Due date<input className={field} type="date" name="dueDate" defaultValue={initial.dueDate}/></label><label className="grid gap-1.5 text-sm font-semibold text-text">Currency<input className={field} name="currency" defaultValue={initial.currency} maxLength={3} required/></label><label className="grid gap-1.5 text-sm font-semibold text-text sm:col-span-2">Notes<textarea className={`${field} min-h-24 py-3`} name="notes" defaultValue={initial.notes}/></label></section>
    {useVat ? <section className="border-l-4 border-civ-blue bg-soft-blue p-5 dark:bg-surface-muted"><h2 className="font-bold text-text">{trustedTax.name}</h2><p className="mt-1 text-sm text-muted">Trusted CIV tax treatment · version {trustedTax.version}. Workspace custom rates cannot modify or combine with it.</p><ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-text">{trustedTax.components.map((component)=><li key={component.code}><strong>{component.code}</strong> {Number(component.rate)}%</li>)}</ul></section> : <p className="text-sm text-muted">Invoices and receipts may use no rate or an optional workspace Custom Rate on each line.</p>}
    <section aria-labelledby="line-items-title"><div className="flex items-center justify-between gap-3"><div><h2 id="line-items-title" className="text-xl font-bold text-text">Line items</h2><p className="mt-1 text-sm text-muted">Saved totals are recalculated by CIV on the server.</p></div><button type="button" className="min-h-11 rounded-lg border border-civ-blue px-4 text-sm font-semibold text-link" onClick={()=>setLines(current=>[...current,{catalogItemId:null,customRateId:null,description:"",quantity:"1",unitPrice:"0.00"}])}>Add line</button></div>
      <div className="mt-4 grid gap-4">{lines.map((line,index)=><article key={line.id ?? index} className="rounded-xl border border-border bg-surface p-4 sm:p-5"><div className="flex items-center justify-between"><h3 className="font-bold text-text">Line {index+1}</h3><button type="button" disabled={lines.length===1} className="min-h-11 px-3 text-sm font-semibold text-danger disabled:opacity-40" onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))}>Remove</button></div><div className="mt-3 grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-text sm:col-span-2">Catalogue entry<select className={field} value={line.catalogItemId??""} onChange={event=>{const item=items.find(i=>i.id===event.target.value);update(index,item?{catalogItemId:item.id,description:item.description||item.name,unitPrice:item.unitPrice}:{catalogItemId:null});}}><option value="">Custom line</option>{items.map(item=><option value={item.id} key={item.id}>{item.name} · {item.currency} {item.unitPrice}</option>)}</select></label><label className="grid gap-1.5 text-sm font-semibold text-text sm:col-span-2">Description<textarea className={`${field} min-h-20 py-3`} value={line.description} onChange={e=>update(index,{description:e.target.value})} required/></label><label className="grid gap-1.5 text-sm font-semibold text-text">Quantity<input className={field} inputMode="decimal" value={line.quantity} onChange={e=>update(index,{quantity:e.target.value})} required/></label><label className="grid gap-1.5 text-sm font-semibold text-text">Unit price<input className={field} inputMode="decimal" value={line.unitPrice} onChange={e=>update(index,{unitPrice:e.target.value})} required/></label>{!useVat?<label className="grid gap-1.5 text-sm font-semibold text-text sm:col-span-2">Custom rate<select className={field} value={line.customRateId??""} onChange={e=>update(index,{customRateId:e.target.value||null})}><option value="">No rate</option>{rates.map(rate=><option value={rate.id} key={rate.id}>{rate.name} · {rate.value}{rate.type==="PERCENTAGE"?"%":" fixed"}</option>)}</select></label>:null}</div></article>)}</div>
    </section>
    <section className="rounded-xl border border-border bg-surface p-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><h2 className="font-bold text-text">Calculation preview</h2><p className="mt-1 text-sm text-muted">Immediate estimate only. CIV recalculates authoritative values on save.</p></div><p className="text-xl font-bold text-text">{initial.currency} {preview.grandTotal.toFixed(2)}</p></div><dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><div className="flex justify-between gap-3"><dt>Subtotal / Base</dt><dd>{preview.base.toFixed(2)}</dd></div>{useVat?preview.components.map((component)=><div className="flex justify-between gap-3" key={component.code}><dt>{component.name}</dt><dd>{component.amount.toFixed(2)}</dd></div>):<div className="flex justify-between gap-3"><dt>Custom rates</dt><dd>{preview.customRates.toFixed(2)}</dd></div>}{useVat?<div className="flex justify-between gap-3 font-semibold"><dt>Taxable value</dt><dd>{preview.taxableValue.toFixed(2)}</dd></div>:null}<div className="flex justify-between gap-3 font-bold"><dt>Grand total</dt><dd>{preview.grandTotal.toFixed(2)}</dd></div></dl>{initial.savedCalculation?.components?.length?<div className="mt-5 border-t border-border pt-4"><p className="text-xs font-bold uppercase tracking-wide text-muted">Last server-saved trusted calculation</p><p className="mt-2 text-sm text-text">Tax {initial.savedCalculation.taxTotal} · Total {initial.savedCalculation.grossTotal}</p></div>:null}</section>
    <section className="flex flex-wrap justify-end gap-2"><Link href="/app/documents" className="min-h-11 rounded-lg border border-border px-4 py-3 text-sm font-semibold text-text">Back</Link><button disabled={pending} className="min-h-11 rounded-lg bg-civ-blue px-5 text-sm font-semibold text-white disabled:opacity-60">{pending?"Saving…":"Save Draft"}</button></section>{state.message?<p role="status" className={state.errors?"text-sm text-danger":"text-sm text-success"}>{state.message}</p>:null}
  </form>;
}

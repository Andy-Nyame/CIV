import { DraftEditor } from "@/components/ui/draft-editor";
import { PageHeading } from "@/components/ui/page-heading";
import { archiveDraftAction } from "@/features/documents/actions";
import { getDraftEditorData } from "@/features/documents/queries";

export default async function DraftPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params; const data = await getDraftEditorData(documentId); const document = data.document!;
  const date = (value: Date | null) => value ? value.toISOString().slice(0, 10) : "";
  return <div><PageHeading title={document.draftReference} description="Draft only — no official number has been assigned and no capacity has been consumed."/><div className="mt-8"><DraftEditor documentId={document.id} customers={data.customers} items={data.items.map(i=>({...i,unitPrice:i.unitPrice.toString()}))} rates={data.rates.map(r=>({...r,value:r.value.toString()}))} initial={{type:document.type,customerId:document.customerId,currency:document.currency,draftDate:date(document.draftDate),dueDate:date(document.dueDate),notes:document.notes??"",lines:document.lines.map(line=>({catalogItemId:line.catalogItemId,customRateId:line.customRateId,description:line.description,quantity:line.quantity.toString(),unitPrice:line.unitPrice.toString()}))}}/></div><form action={archiveDraftAction.bind(null,document.id)} className="mt-8 rounded-xl border border-danger/40 p-5"><h2 className="font-bold text-text">Archive draft</h2><p className="mt-1 text-sm text-muted">This removes it from normal lists while preserving audit history.</p><button className="mt-4 min-h-11 rounded-lg border border-danger px-4 text-sm font-semibold text-danger">Archive Draft</button></form></div>;
}

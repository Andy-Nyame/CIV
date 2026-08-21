import { DraftEditor } from "@/components/ui/draft-editor";
import { IssueDocumentPanel } from "@/components/ui/issue-document-panel";
import { IssuedDocumentView } from "@/components/ui/issued-document-view";
import { PageHeading } from "@/components/ui/page-heading";
import { CAPABILITIES, hasCapability } from "@/features/authorization/capabilities";
import { getDocumentCapacityAvailability } from "@/features/commercial/capacity";
import { archiveDraftAction } from "@/features/documents/actions";
import { getDocumentRecordPageData, getDraftEditorData } from "@/features/documents/queries";
import { validateIssueReadiness } from "@/features/documents/readiness";

export default async function DraftPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const record = await getDocumentRecordPageData(documentId);
  if (record.document.status === "ISSUED" && record.snapshot) return <div><PageHeading title={record.document.documentNumber!} description="Issued workspace record · Read-only"/><IssuedDocumentView snapshot={record.snapshot}/></div>;
  const data = await getDraftEditorData(documentId); const document = data.document!;
  const date = (value: Date | null) => value ? value.toISOString().slice(0, 10) : "";
  const canIssue = hasCapability(data.context.membership, CAPABILITIES.ISSUE_DOCUMENT);
  const issuePreview = canIssue ? await Promise.all([validateIssueReadiness({ actorUserId: data.context.user.id, workspaceId: data.context.workspace.id, documentId }), getDocumentCapacityAvailability(data.context.workspace.id)]) : null;
  return <div><PageHeading title={document.draftReference} description="Draft only — no official number has been assigned and no capacity has been consumed."/><div className="mt-8"><DraftEditor documentId={document.id} customers={data.customers} items={data.items.map(i=>({...i,unitPrice:i.unitPrice.toString()}))} rates={data.rates.map(r=>({...r,value:r.value.toString()}))} trustedTax={{name:data.trustedTaxVersion.profile.name,version:data.trustedTaxVersion.version,components:data.trustedTaxVersion.components}} initial={{type:document.type,customerId:document.customerId,currency:document.currency,draftDate:date(document.draftDate),dueDate:date(document.dueDate),notes:document.notes??"",lines:document.lines.map(line=>({id:line.id,catalogItemId:line.catalogItemId,customRateId:line.customRateId,description:line.description,quantity:line.quantity.toString(),unitPrice:line.unitPrice.toString()})),savedCalculation:document.taxCalculation as null | {base?:string;taxableValue?:string;taxTotal?:string;grossTotal?:string;components?:Array<{code:string;name:string;rate:string;amount:string}>}}}/></div>{issuePreview?<IssueDocumentPanel documentId={document.id} documentType={document.type} customerName={data.customers.find(({id})=>id===document.customerId)?.name??null} currency={document.currency} grandTotal={document.grandTotal.toFixed(2)} readiness={issuePreview[0].errors.map(({message})=>message)} capacity={issuePreview[1]}/>:null}<form action={archiveDraftAction.bind(null,document.id)} className="mt-8 rounded-xl border border-danger/40 p-5"><h2 className="font-bold text-text">Archive draft</h2><p className="mt-1 text-sm text-muted">This removes it from normal lists while preserving audit history.</p><button className="mt-4 min-h-11 rounded-lg border border-danger px-4 text-sm font-semibold text-danger">Archive Draft</button></form></div>;
}

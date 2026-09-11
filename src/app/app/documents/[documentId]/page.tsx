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
  if (record.document.status === "ISSUED" && record.snapshot) return <div><PageHeading title={record.document.documentNumber!} description="Issued workspace record · Read-only" action={<a className="inline-flex min-h-11 items-center justify-center rounded-lg bg-civ-blue px-4 text-sm font-bold text-white hover:bg-civ-blue-hover" href={`/api/documents/${record.document.id}/pdf`}>Download PDF</a>}/><IssuedDocumentView snapshot={record.snapshot}/></div>;
  const data = await getDraftEditorData(documentId); const document = data.document!;
  const date = (value: Date | null) => value ? value.toISOString().slice(0, 10) : "";
  const canIssue = hasCapability(data.context.membership, CAPABILITIES.ISSUE_DOCUMENT);
  const issuePreview = canIssue ? await Promise.all([validateIssueReadiness({ actorUserId: data.context.user.id, workspaceId: data.context.workspace.id, documentId }), getDocumentCapacityAvailability(data.context.workspace.id)]) : null;
  const trustedTax = data.vatCreationReadiness.ready && data.trustedTaxVersion
    ? { name: data.trustedTaxVersion.profile.name, version: data.trustedTaxVersion.version, components: data.trustedTaxVersion.components }
    : null;
  const customerName = document.customerName ?? document.customer?.name ?? "";
  return <div><PageHeading title={document.draftReference} description="Draft only — no official number has been assigned and no capacity has been consumed." action={<a className="inline-flex min-h-11 items-center justify-center rounded-lg border border-civ-blue px-4 text-sm font-bold text-link hover:bg-hover" href={`/api/documents/${document.id}/pdf`}>Download Draft PDF</a>}/><p className="mt-3 text-sm text-muted">The draft PDF uses the last saved document values and is marked DRAFT — NOT ISSUED.</p><div className="mt-8"><DraftEditor documentId={document.id} isTestDocument={document.isTestDocument} customers={data.customers} items={data.items.map(i=>({...i,unitPrice:i.unitPrice.toString()}))} rates={data.rates.map(r=>({...r,value:r.value.toString()}))} trustedTax={trustedTax} initial={{type:document.type,customerId:document.customerId,customerName,currency:document.currency,draftDate:date(document.draftDate),dueDate:date(document.dueDate),notes:document.notes??"",lines:document.lines.map(line=>({id:line.id,catalogItemId:line.catalogItemId,customRateId:line.customRateId,originalCustomRateId:line.customRateId,description:line.description,quantity:line.quantity.toString(),unitPrice:line.unitPrice.toString(),rateNameSnapshot:line.rateNameSnapshot,rateTypeSnapshot:line.rateTypeSnapshot,rateValueSnapshot:line.rateValueSnapshot?.toString()??null})),savedCalculation:document.taxCalculation as null | {base?:string;taxableValue?:string;taxTotal?:string;grossTotal?:string;components?:Array<{code:string;name:string;rate:string;amount:string}>}}}/></div>{issuePreview?<IssueDocumentPanel documentId={document.id} documentType={document.type} customerName={customerName || null} currency={document.currency} grandTotal={document.grandTotal.toFixed(2)} readiness={issuePreview[0].errors.map(({message})=>message)} capacity={issuePreview[1]}/>:null}<form action={archiveDraftAction.bind(null,document.id)} className="mt-8 rounded-xl border border-danger/40 p-5"><h2 className="font-bold text-text">Archive draft</h2><p className="mt-1 text-sm text-muted">This removes it from normal lists while preserving audit history.</p><button className="mt-4 min-h-11 rounded-lg border border-danger px-4 text-sm font-semibold text-danger">Archive Draft</button></form></div>;
}

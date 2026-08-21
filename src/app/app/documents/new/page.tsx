import { DraftEditor } from "@/components/ui/draft-editor"; import { PageHeading } from "@/components/ui/page-heading"; import { getDraftEditorData } from "@/features/documents/queries";

const supportedTypes = new Set(["INVOICE", "RECEIPT", "VAT_INVOICE"] as const);

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const [data, query] = await Promise.all([getDraftEditorData(), searchParams]);
  const requestedType = query.type;
  const type = requestedType && supportedTypes.has(requestedType as "INVOICE" | "RECEIPT" | "VAT_INVOICE")
    ? requestedType as "INVOICE" | "RECEIPT" | "VAT_INVOICE"
    : "INVOICE";
  const today=new Date().toISOString().slice(0,10); return <div><PageHeading title="Create Draft" description="Build a structured business document. Saving a draft does not issue it or consume document capacity."/><div className="mt-8"><DraftEditor documentId={null} customers={data.customers} items={data.items.map(i=>({...i,unitPrice:i.unitPrice.toString()}))} rates={data.rates.map(r=>({...r,value:r.value.toString()}))} trustedTax={{name:data.trustedTaxVersion.profile.name,version:data.trustedTaxVersion.version,components:data.trustedTaxVersion.components}} initial={{type,customerId:null,currency:data.context.workspace.currency,draftDate:today,dueDate:"",notes:"",lines:[{catalogItemId:null,customRateId:null,description:"",quantity:"1",unitPrice:"0.00"}],savedCalculation:null}}/></div></div>;
}

import { DraftEditor } from "@/components/ui/draft-editor"; import { PageHeading } from "@/components/ui/page-heading"; import { getDraftEditorData } from "@/features/documents/queries";

const supportedTypes = new Set(["INVOICE", "RECEIPT", "VAT_INVOICE"] as const);

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const query = await searchParams;
  const requestedType = query.type;
  const type = requestedType && supportedTypes.has(requestedType as "INVOICE" | "RECEIPT" | "VAT_INVOICE")
    ? requestedType as "INVOICE" | "RECEIPT" | "VAT_INVOICE"
    : "INVOICE";
  const data = await getDraftEditorData(undefined, type);
  const trustedTax = data.trustedTaxVersion
    ? { name: data.trustedTaxVersion.profile.name, version: data.trustedTaxVersion.version, components: data.trustedTaxVersion.components }
    : null;
  const today=new Date().toISOString().slice(0,10); return <div><PageHeading title="Create Draft" description="Enter customer and line details directly. Saving a draft does not issue it or consume document capacity."/><div className="mt-8"><DraftEditor documentId={null} customers={data.customers} items={data.items.map(i=>({...i,unitPrice:i.unitPrice.toString()}))} rates={data.rates.map(r=>({...r,value:r.value.toString()}))} trustedTax={trustedTax} initial={{type,customerId:null,customer:{name:"",email:"",phone:"",address:"",businessTin:""},currency:data.context.workspace.currency,draftDate:today,dueDate:"",notes:"",lines:[{catalogItemId:null,customRateId:null,description:"",quantity:"1",unitPrice:"0.00"}],savedCalculation:null}}/></div></div>;
}

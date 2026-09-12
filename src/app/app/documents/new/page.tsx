import Link from "next/link";

import { DraftEditor } from "@/components/ui/draft-editor";
import { PageHeading } from "@/components/ui/page-heading";
import { getDraftEditorData } from "@/features/documents/queries";

const supportedTypes = new Set(["INVOICE", "RECEIPT", "VAT_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"] as const);

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const query = await searchParams;
  const requestedType = query.type;
  const type = requestedType && supportedTypes.has(requestedType as "INVOICE" | "RECEIPT" | "VAT_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE")
    ? requestedType as "INVOICE" | "RECEIPT" | "VAT_INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE"
    : "INVOICE";
  const data = await getDraftEditorData(undefined, type);

  if (!data.creationReadiness.ready) {
    return <div><PageHeading title="Complete workspace setup" description="This workspace is not ready to create the selected document type."/><section className="mt-8 max-w-2xl rounded-xl border border-civ-blue bg-surface p-5 sm:p-7"><h2 className="font-bold text-text">Required information</h2><ul className="mt-3 list-disc pl-5 text-sm leading-6 text-muted">{data.creationReadiness.issues.map((issue)=><li key={issue.code}>{issue.message}</li>)}</ul><Link href="/app/settings#taxpayer-details" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white">Open workspace settings</Link></section></div>;
  }

  const trustedTax = data.vatCreationReadiness.ready && data.trustedTaxVersion
    ? { name: data.trustedTaxVersion.profile.name, version: data.trustedTaxVersion.version, components: data.trustedTaxVersion.components }
    : null;
  const today = new Date().toISOString().slice(0, 10);
  return <div><PageHeading title="Create Draft" description="Enter the customer name and line details directly. Saving a draft does not issue it or consume document capacity."/><div className="mt-8"><DraftEditor documentId={null} isTestDocument={data.creationReadiness.isTestWorkspace} customers={data.customers} items={data.items.map(i=>({...i,unitPrice:i.unitPrice.toString()}))} rates={data.rates.map(r=>({...r,value:r.value.toString()}))} trustedTax={trustedTax} workspaceVat={data.workspaceTaxState} originalDocuments={data.originalDocuments} initial={{type,customerId:null,customerName:"",customerAddress:"",customerTaxpayerIdType:"",customerTaxpayerId:"",customerVatRegistrationStatus:"",customerTaxStatus:"ORDINARY_CONSUMER",currency:data.context.workspace.currency,draftDate:today,supplyDate:"",dueDate:"",transactionType:"SALE",receiptType:"COMMERCIAL",servicePeriodStart:"",servicePeriodEnd:"",priceMode:"TAX_EXCLUSIVE",originalDocumentId:null,adjustmentReason:"",withholdingApplied:false,withholdingAgent:false,withholdingAmount:"0.00",withholdingReference:"",withholdingEvidence:"",withholdingDate:"",paymentEvents:[],notes:"",lines:[{catalogItemId:null,customRateId:null,description:"",quantity:"1",unitPrice:"0.00",unitOfMeasure:"Each",discountAmount:"0.00",taxTreatment:"STANDARD_RATED",taxTreatmentReason:null,taxTreatmentReference:null,reliefApplied:false,reliefReason:null,reliefReference:null}],savedCalculation:null}}/></div></div>;
}

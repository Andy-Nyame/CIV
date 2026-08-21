import { notFound } from "next/navigation";
import { CatalogueItemForm } from "@/components/ui/catalogue-item-form";
import { PageHeading } from "@/components/ui/page-heading";
import { setCatalogueItemActiveAction } from "@/features/catalog/actions";
import { getCatalogueItemForEdit } from "@/features/catalog/queries";

export default async function ItemEditPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params; const { item } = await getCatalogueItemForEdit(itemId); if (!item) notFound(); const active = !item.archivedAt;
  return <div className="max-w-3xl"><PageHeading title="Edit catalogue entry" description="Draft lines keep their own description, price and rate snapshots."/><section className="mt-8 rounded-xl border border-border bg-surface p-5 sm:p-6"><CatalogueItemForm item={item}/></section><form action={setCatalogueItemActiveAction.bind(null,item.id,!active)} className="mt-6 rounded-xl border border-border p-5"><input type="hidden" name="name" value={item.name}/><input type="hidden" name="description" value={item.description??""}/><input type="hidden" name="type" value={item.type}/><input type="hidden" name="unitPrice" value={item.unitPrice.toString()}/><input type="hidden" name="currency" value={item.currency}/><input type="hidden" name="unitLabel" value={item.unitLabel??""}/><input type="hidden" name="sku" value={item.sku??""}/><button className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text">{active?"Deactivate entry":"Reactivate entry"}</button></form></div>;
}

import type { Metadata } from "next";
import Link from "next/link";

import { CustomerForm } from "@/components/ui/customer-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getCustomersPageData } from "@/features/customers/queries";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/app/customers">) {
  const { q = "" } = await searchParams;
  const data = await getCustomersPageData(typeof q === "string" ? q : "");
  return <div><PageHeading title="Customers" description={`Workspace customers for ${data.context.workspace.name}.`} />
    <div className="mt-8 grid gap-7 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0"><form className="mb-4 flex gap-2"><label className="sr-only" htmlFor="customer-search">Search customers</label><input id="customer-search" name="q" defaultValue={typeof q === "string" ? q : ""} className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-text" placeholder="Search name, email or phone"/><button className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text">Search</button></form>
      {data.customers.length ? <ul className="divide-y divide-border rounded-xl border border-border bg-surface">{data.customers.map((customer) => <li key={customer.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-semibold text-text">{customer.name}</p><p className="mt-1 text-sm text-muted">{customer.email || customer.phone || "No contact details"}</p></div>{data.canManage ? <Link className="min-h-11 rounded-lg border border-border px-4 py-3 text-sm font-semibold text-link" href={`/app/customers/${customer.id}`}>Edit</Link> : null}</li>)}</ul> : <div className="rounded-xl border border-dashed border-border p-10 text-center"><h2 className="font-bold text-text">No saved customers</h2><p className="mt-2 text-sm text-muted">Create a customer to reuse their details in drafts.</p></div>}</section>
      {data.canManage ? <aside className="rounded-xl border border-border bg-surface p-5"><h2 className="text-lg font-bold text-text">New customer</h2><div className="mt-5"><CustomerForm /></div></aside> : null}
    </div></div>;
}

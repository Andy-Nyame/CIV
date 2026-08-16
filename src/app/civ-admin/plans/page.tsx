import type { Metadata } from "next";

import { PlatformPageHeading } from "@/components/ui/platform-page-heading";
import { PlatformPlanEditor } from "@/components/ui/platform-plan-editor";
import { getPlatformPlanManagementData } from "@/features/commercial/queries";

export const metadata: Metadata = { title: "Plans" };

export default async function PlatformPlansPage() {
  const data = await getPlatformPlanManagementData();

  return (
    <div>
      <PlatformPageHeading
        title="Plans"
        description="Configure CIV plan allowances and availability without changing their stable internal identities."
      />
      <p className="mt-6 rounded-xl border border-border bg-soft-blue p-4 text-sm leading-6 text-civ-navy dark:bg-surface-muted dark:text-text">
        Configure Test Mode recurring prices and Paystack plan mappings deliberately. Changes never delete members, documents, or purchased credits, and stable CIV plan codes cannot be edited here.
      </p>
      {!data.canManage ? (
        <p className="mt-4 text-sm text-muted">
          Your platform role has read-only plan access.
        </p>
      ) : null}
      <section
        className="mt-6 grid gap-5 lg:grid-cols-2"
        aria-label="CIV plan configuration"
      >
        {data.plans.map((plan) => (
          <PlatformPlanEditor
            key={plan.code}
            plan={plan}
            canManage={data.canManage}
          />
        ))}
      </section>
    </div>
  );
}

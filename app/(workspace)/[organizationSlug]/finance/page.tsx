import { notFound } from "next/navigation";

import { ComingSoonState } from "@/components/layout/coming-soon-state";
import { getNavItem } from "@/lib/navigation";
import { getTenantBySlug } from "@/lib/tenancy/tenants";

const NAV_ITEM = getNavItem("finance");

export default async function FinancePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  if (!getTenantBySlug(organizationSlug)) {
    notFound();
  }

  return (
    <ComingSoonState
      title={NAV_ITEM.label}
      icon={NAV_ITEM.icon}
      phase="Phase 3"
      description="Daily sales snapshots, expense tracking, and food-cost/labor targets land with the operational modules phase."
    />
  );
}

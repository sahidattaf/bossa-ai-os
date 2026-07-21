import { notFound } from "next/navigation";

import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { PageHeader } from "@/components/layout/page-header";
import { dashboardDataProvider } from "@/lib/dashboard/mock-provider";
import { getTenantBySlug } from "@/lib/tenancy/tenants";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const tenant = getTenantBySlug(organizationSlug);

  if (!tenant) {
    notFound();
  }

  const data = await dashboardDataProvider.getDashboardData(tenant.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={`${tenant.name} — executive overview`} />
      <DashboardGrid tenant={tenant} data={data} />
    </div>
  );
}

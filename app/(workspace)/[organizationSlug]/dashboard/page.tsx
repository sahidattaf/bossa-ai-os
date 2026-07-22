import { notFound } from "next/navigation";

import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { PageHeader } from "@/components/layout/page-header";
import { getDashboardDataProvider, getDashboardProviderMode } from "@/lib/dashboard/get-data-provider";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantForCurrentUser } from "@/lib/tenancy/supabase-tenants";
import { getTenantBySlug } from "@/lib/tenancy/tenants";
import type { TenantConfig } from "@/lib/tenancy/types";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  let tenant: TenantConfig;
  let permissions: string[] = ["*"];
  let data;

  if (getDashboardProviderMode() === "mock") {
    const mockTenant = getTenantBySlug(organizationSlug);
    if (!mockTenant) {
      notFound();
    }
    tenant = mockTenant;
    data = await getDashboardDataProvider().getDashboardData(tenant.id);
  } else {
    // The workspace layout already authenticated and authorized this
    // request; resolveTenantForCurrentUser is cache()d, so this re-call is
    // free. Any non-"ok" result here means the layout's own gate has a bug,
    // not a real access grant — fail closed rather than render partial data.
    const supabase = await createClient();
    const access = await resolveTenantForCurrentUser(supabase, organizationSlug);
    if (access.status !== "ok") {
      notFound();
    }
    tenant = access.tenant;
    permissions = access.permissions;
    data = await getDashboardDataProvider(supabase).getDashboardData(tenant.id);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={`${tenant.name} — executive overview`} />
      <DashboardGrid tenant={tenant} data={data} permissions={permissions} />
    </div>
  );
}

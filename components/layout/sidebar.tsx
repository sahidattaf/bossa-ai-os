import { NavList } from "@/components/layout/nav-list";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { ServiceStatusIndicator } from "@/components/layout/service-status-indicator";
import type { TenantSummary } from "@/lib/tenancy/tenants";
import { toTenantSummary } from "@/lib/tenancy/tenants";
import type { TenantConfig } from "@/lib/tenancy/types";

export interface SidebarProps {
  tenant: TenantConfig;
  tenants: readonly TenantSummary[];
}

function Sidebar({ tenant, tenants }: SidebarProps) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface p-4 lg:flex">
      <OrgSwitcher currentTenant={toTenantSummary(tenant)} tenants={tenants} />
      <div className="mt-4 flex-1 overflow-y-auto">
        <NavList organizationSlug={tenant.slug} />
      </div>
      <div className="border-t border-border pt-3">
        <ServiceStatusIndicator status={tenant.serviceStatus} />
      </div>
    </aside>
  );
}

export { Sidebar };

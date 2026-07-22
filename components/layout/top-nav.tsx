import { GlobalSearchShell } from "@/components/layout/global-search-shell";
import { MobileNavSheet } from "@/components/layout/mobile-nav-sheet";
import { NotificationButton } from "@/components/layout/notification-button";
import { UserMenu } from "@/components/layout/user-menu";
import type { TenantSummary } from "@/lib/tenancy/tenants";
import type { TenantConfig } from "@/lib/tenancy/types";

export interface TopNavProps {
  tenant: TenantConfig;
  tenants: readonly TenantSummary[];
  userDisplayName: string;
  userRoleLabel: string;
  onSignOut?: () => void | Promise<void>;
}

function TopNav({ tenant, tenants, userDisplayName, userRoleLabel, onSignOut }: TopNavProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-surface px-4 lg:px-6">
      <MobileNavSheet tenant={tenant} tenants={tenants} />
      <div className="flex-1">
        <GlobalSearchShell tenantName={tenant.name} />
      </div>
      <NotificationButton count={3} />
      <UserMenu name={userDisplayName} role={userRoleLabel} onSignOut={onSignOut} />
    </header>
  );
}

export { TopNav };

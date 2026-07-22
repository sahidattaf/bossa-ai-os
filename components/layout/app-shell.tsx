import type { ReactNode } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { TopNav } from "@/components/layout/top-nav";
import type { TenantSummary } from "@/lib/tenancy/tenants";
import { getTenantThemeStyle, resolveThemeMode } from "@/lib/tenancy/theme";
import type { TenantConfig } from "@/lib/tenancy/types";

export interface AppShellProps {
  tenant: TenantConfig;
  tenants: readonly TenantSummary[];
  userDisplayName: string;
  userRoleLabel: string;
  onSignOut?: () => void | Promise<void>;
  children: ReactNode;
}

function AppShell({
  tenant,
  tenants,
  userDisplayName,
  userRoleLabel,
  onSignOut,
  children,
}: AppShellProps) {
  return (
    <div
      data-theme={resolveThemeMode(tenant.branding.themeMode)}
      style={getTenantThemeStyle(tenant)}
      className="flex min-h-screen bg-background text-foreground"
    >
      <Sidebar tenant={tenant} tenants={tenants} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav
          tenant={tenant}
          tenants={tenants}
          userDisplayName={userDisplayName}
          userRoleLabel={userRoleLabel}
          onSignOut={onSignOut}
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

export { AppShell };

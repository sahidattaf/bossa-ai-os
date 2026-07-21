import type { ReactNode } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { TopNav } from "@/components/layout/top-nav";
import { getTenantThemeStyle, resolveThemeMode } from "@/lib/tenancy/theme";
import type { TenantConfig } from "@/lib/tenancy/types";

export interface AppShellProps {
  tenant: TenantConfig;
  children: ReactNode;
}

function AppShell({ tenant, children }: AppShellProps) {
  return (
    <div
      data-theme={resolveThemeMode(tenant.branding.themeMode)}
      style={getTenantThemeStyle(tenant)}
      className="flex min-h-screen bg-background text-foreground"
    >
      <Sidebar tenant={tenant} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav tenant={tenant} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

export { AppShell };

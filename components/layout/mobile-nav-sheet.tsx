"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { NavList } from "@/components/layout/nav-list";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { ServiceStatusIndicator } from "@/components/layout/service-status-indicator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { TenantSummary } from "@/lib/tenancy/tenants";
import { toTenantSummary } from "@/lib/tenancy/tenants";
import type { TenantConfig } from "@/lib/tenancy/types";

export interface MobileNavSheetProps {
  tenant: TenantConfig;
  tenants: readonly TenantSummary[];
}

function MobileNavSheet({ tenant, tenants }: MobileNavSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="flex h-9 w-9 items-center justify-center rounded-md text-foreground lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      <SheetContent side="left" className="flex flex-col gap-4">
        <SheetHeader>
          <SheetTitle>{tenant.name}</SheetTitle>
        </SheetHeader>
        <OrgSwitcher currentTenant={toTenantSummary(tenant)} tenants={tenants} />
        <div className="flex-1 overflow-y-auto">
          <NavList organizationSlug={tenant.slug} onNavigate={() => setOpen(false)} />
        </div>
        <div className="border-t border-border pt-3">
          <ServiceStatusIndicator status={tenant.serviceStatus} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export { MobileNavSheet };

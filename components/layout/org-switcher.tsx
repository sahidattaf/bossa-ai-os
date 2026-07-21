"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Check, ChevronsUpDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TenantSummary } from "@/lib/tenancy/tenants";
import { cn } from "@/lib/utils";

export interface OrgSwitcherProps {
  currentTenant: TenantSummary;
  tenants: readonly TenantSummary[];
}

function swapOrganizationSlug(pathname: string, nextSlug: string): string {
  const segments = pathname.split("/").filter(Boolean);
  segments[0] = nextSlug;
  return `/${segments.join("/")}`;
}

function OrgSwitcher({ currentTenant, tenants }: OrgSwitcherProps) {
  const pathname = usePathname();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-surface-elevated/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Switch organization"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          {currentTenant.logoInitials}
        </span>
        <span className="flex-1 truncate">{currentTenant.name}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenants.map((tenant) => (
          <DropdownMenuItem key={tenant.id} asChild>
            <Link
              href={swapOrganizationSlug(pathname, tenant.slug)}
              className="flex items-center gap-2"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface text-[10px] font-bold text-foreground">
                {tenant.logoInitials}
              </span>
              <span className="flex-1 truncate">{tenant.name}</span>
              {tenant.id === currentTenant.id ? (
                <Check className={cn("h-4 w-4 text-primary")} />
              ) : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { OrgSwitcher };

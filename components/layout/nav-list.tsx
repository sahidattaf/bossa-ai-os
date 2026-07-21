"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { NAV_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export interface NavListProps {
  organizationSlug: string;
  onNavigate?: () => void;
}

function NavList({ organizationSlug, onNavigate }: NavListProps) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const href = `/${organizationSlug}/${item.segment}`;
        const isActive = pathname === href;
        const Icon = item.icon;

        return (
          <Link
            key={item.segment}
            href={href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-surface-elevated hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">{item.label}</span>
            {!item.availableInPhase1 ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                Soon
              </Badge>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export { NavList };

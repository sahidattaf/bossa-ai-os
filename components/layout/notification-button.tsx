"use client";

import { Bell } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";

export interface NotificationButtonProps {
  count?: number;
}

function NotificationButton({ count = 0 }: NotificationButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={count > 0 ? `${count} unread notifications` : "Notifications"}
      >
        <Bell className="h-4 w-4" />
        {count > 0 ? (
          <span className="absolute right-1 top-1 flex h-2 w-2 rounded-full bg-danger" />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="p-1">
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="Live service alerts and approvals will appear here in Phase 3."
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { NotificationButton };

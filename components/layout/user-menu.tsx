"use client";

import { LogOut, Settings, User } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";

export interface UserMenuProps {
  name: string;
  role: string;
}

function initialsFor(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function UserMenu({ name, role }: UserMenuProps) {
  const { toast } = useToast();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-elevated text-xs font-semibold text-foreground transition-colors hover:bg-surface-elevated/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Open user menu"
      >
        {initialsFor(name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="font-semibold text-foreground">{name}</p>
          <p className="font-normal text-muted-foreground">{role}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            toast({ title: "Profile", description: "Profile management arrives in Phase 2." })
          }
        >
          <User className="h-4 w-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            toast({ title: "Settings", description: "Organization settings arrive in Phase 2." })
          }
        >
          <Settings className="h-4 w-4" />
          Organization settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            toast({ title: "Sign out", description: "Authentication arrives in Phase 2." })
          }
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { UserMenu };

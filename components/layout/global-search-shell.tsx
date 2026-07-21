"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";

export interface GlobalSearchShellProps {
  tenantName: string;
}

function GlobalSearchShell({ tenantName }: GlobalSearchShellProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-full max-w-sm items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Search className="h-4 w-4" />
        Search {tenantName}…
        <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Search {tenantName}</DialogTitle>
        </DialogHeader>
        <Input autoFocus placeholder="Search orders, guests, menu items…" />
        <EmptyState
          icon={Search}
          title="Search connects to live data in Phase 3"
          description="Orders, reservations, guests, and menu search will appear here once operational modules ship."
        />
      </DialogContent>
    </Dialog>
  );
}

export { GlobalSearchShell };

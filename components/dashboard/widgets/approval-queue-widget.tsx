"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/use-toast";
import type { ApprovalQueueItem } from "@/lib/dashboard/types";
import type { WidgetComponentProps } from "@/lib/widgets/types";

function ApprovalQueueWidget({ data }: WidgetComponentProps<ApprovalQueueItem[]>) {
  const { toast } = useToast();

  if (data.length === 0) {
    return <EmptyState title="Nothing waiting on approval" description="You're all caught up." />;
  }

  return (
    <ul className="flex flex-col gap-4">
      {data.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">{item.title}</p>
            <p className="text-xs text-muted-foreground">
              {item.type} · requested by {item.requestedBy}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              toast({
                title: "Approval flow arrives in Phase 4",
                description: "The AI Executive approval gate isn't wired up yet.",
              })
            }
          >
            Review
          </Button>
        </li>
      ))}
    </ul>
  );
}

export { ApprovalQueueWidget };

"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import type { QuickActionItem } from "@/lib/dashboard/types";
import type { WidgetComponentProps } from "@/lib/widgets/types";

function QuickActionsWidget({ data }: WidgetComponentProps<QuickActionItem[]>) {
  const { toast } = useToast();

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {data.map((action) => (
        <Button
          key={action.id}
          variant="secondary"
          className="h-auto flex-col items-start gap-1 whitespace-normal p-4 text-left"
          onClick={() => toast({ title: action.label, description: action.description })}
        >
          <span className="text-sm font-semibold text-foreground">{action.label}</span>
          <span className="text-xs font-normal text-muted-foreground">{action.description}</span>
        </Button>
      ))}
    </div>
  );
}

export { QuickActionsWidget };

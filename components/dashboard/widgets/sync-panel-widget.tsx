import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

import type { SyncSource } from "@/lib/dashboard/types";
import type { WidgetComponentProps } from "@/lib/widgets/types";
import { cn } from "@/lib/utils";

const STATUS_CONFIG = {
  synced: { icon: CheckCircle2, className: "text-success" },
  syncing: { icon: RefreshCw, className: "text-info" },
  error: { icon: AlertCircle, className: "text-danger" },
} as const;

function SyncPanelWidget({ data }: WidgetComponentProps<SyncSource[]>) {
  return (
    <ul className="flex flex-col gap-3">
      {data.map((source) => {
        const config = STATUS_CONFIG[source.status];
        const Icon = config.icon;

        return (
          <li key={source.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-foreground">
              <Icon className={cn("h-4 w-4", config.className)} aria-hidden="true" />
              {source.name}
            </span>
            <span className="text-xs text-muted-foreground">{source.lastSyncedAt}</span>
          </li>
        );
      })}
    </ul>
  );
}

export { SyncPanelWidget };

import { AlertOctagon, AlertTriangle, Info } from "lucide-react";

import type { AlertSeverity, LiveAlertItem } from "@/lib/dashboard/types";
import type { WidgetComponentProps } from "@/lib/widgets/types";
import { cn } from "@/lib/utils";

const SEVERITY_CONFIG: Record<AlertSeverity, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "text-info" },
  warning: { icon: AlertTriangle, className: "text-warning" },
  critical: { icon: AlertOctagon, className: "text-danger" },
};

function LiveAlertsWidget({ data }: WidgetComponentProps<LiveAlertItem[]>) {
  return (
    <ul className="flex flex-col gap-3">
      {data.map((alert) => {
        const config = SEVERITY_CONFIG[alert.severity];
        const Icon = config.icon;

        return (
          <li key={alert.id} className="flex items-start gap-2 text-sm">
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", config.className)} aria-hidden="true" />
            <div>
              <p className="text-foreground">{alert.message}</p>
              <p className="text-xs text-muted-foreground">{alert.occurredAt}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export { LiveAlertsWidget };

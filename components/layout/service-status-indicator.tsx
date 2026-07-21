import type { ServiceStatus } from "@/lib/tenancy/types";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<ServiceStatus, { label: string; dotClassName: string }> = {
  open: { label: "Service open", dotClassName: "bg-success" },
  busy: { label: "Busy — high volume", dotClassName: "bg-warning" },
  opening_soon: { label: "Opening soon", dotClassName: "bg-info" },
  closed: { label: "Closed", dotClassName: "bg-muted-foreground" },
};

export interface ServiceStatusIndicatorProps {
  status: ServiceStatus;
  className?: string;
}

function ServiceStatusIndicator({ status, className }: ServiceStatusIndicatorProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <span className={cn("h-2 w-2 rounded-full", config.dotClassName)} aria-hidden="true" />
      {config.label}
    </span>
  );
}

export { ServiceStatusIndicator };

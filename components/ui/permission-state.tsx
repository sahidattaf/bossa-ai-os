import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

export interface PermissionStateProps {
  title?: string;
  description?: string;
  requiredPermission?: string;
  className?: string;
}

function PermissionState({
  title = "Restricted",
  description = "You don't have permission to view this yet. Ask an organization owner for access.",
  requiredPermission,
  className,
}: PermissionStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-elevated/50 p-8 text-center",
        className,
      )}
    >
      <Lock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {requiredPermission ? (
        <code className="mt-1 rounded bg-surface px-2 py-1 text-xs text-muted-foreground">
          {requiredPermission}
        </code>
      ) : null}
    </div>
  );
}

export { PermissionState };

import { Badge, type BadgeProps } from "@/components/ui/badge";

const SUCCESS_STATUSES = new Set(["completed", "confirmed", "converted", "paid", "seated"]);
const DANGER_STATUSES = new Set(["cancelled", "lost", "no_show", "refunded"]);
const INFO_STATUSES = new Set(["preparing", "ready", "out_for_delivery", "qualified"]);

/** Maps any of this project's status text values to a consistent badge color across leads/reservations/orders. */
function statusVariant(status: string): NonNullable<BadgeProps["variant"]> {
  if (SUCCESS_STATUSES.has(status)) return "success";
  if (DANGER_STATUSES.has(status)) return "danger";
  if (INFO_STATUSES.has(status)) return "info";
  return "warning";
}

function formatStatusLabel(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusVariant(status)}>{formatStatusLabel(status)}</Badge>;
}

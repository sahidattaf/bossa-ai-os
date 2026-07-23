import { Badge, type BadgeProps } from "@/components/ui/badge";

const SEVERITY_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
  critical: "danger",
  warning: "warning",
  info: "info",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge variant={SEVERITY_VARIANT[severity] ?? "secondary"}>{severity}</Badge>;
}

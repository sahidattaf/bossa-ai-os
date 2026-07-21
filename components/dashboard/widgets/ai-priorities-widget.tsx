import { Badge } from "@/components/ui/badge";
import type { AiPriorityItem, Priority } from "@/lib/dashboard/types";
import type { WidgetComponentProps } from "@/lib/widgets/types";

const PRIORITY_VARIANT: Record<Priority, "danger" | "warning" | "secondary"> = {
  High: "danger",
  Medium: "warning",
  Low: "secondary",
};

function AiPrioritiesWidget({ data }: WidgetComponentProps<AiPriorityItem[]>) {
  return (
    <ul className="flex flex-col gap-4">
      {data.map((item) => (
        <li key={item.id} className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{item.title}</p>
            <Badge variant={PRIORITY_VARIANT[item.priority]}>{item.priority}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {item.detail} · {item.owner}
          </p>
        </li>
      ))}
    </ul>
  );
}

export { AiPrioritiesWidget };

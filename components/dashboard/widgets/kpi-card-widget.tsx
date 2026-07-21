import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

import type { FormattedTrend } from "@/lib/format/kpi";
import type { WidgetComponentProps } from "@/lib/widgets/types";
import { cn } from "@/lib/utils";

export interface KpiCardData {
  label: string;
  value: string;
  trend: FormattedTrend;
  helpText?: string;
}

const TREND_ICON = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const;

function KpiCardWidget({ data }: WidgetComponentProps<KpiCardData>) {
  const TrendIcon = TREND_ICON[data.trend.direction];

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <p className="text-sm font-medium text-muted-foreground">{data.label}</p>
      <p className="text-3xl font-semibold tracking-tight text-foreground">{data.value}</p>
      <div className="flex items-center gap-1 text-xs">
        <TrendIcon className={cn("h-3.5 w-3.5", data.trend.toneClassName)} aria-hidden="true" />
        <span className={data.trend.toneClassName}>{data.trend.label}</span>
      </div>
      {data.helpText ? <p className="text-xs text-muted-foreground">{data.helpText}</p> : null}
    </div>
  );
}

export { KpiCardWidget };

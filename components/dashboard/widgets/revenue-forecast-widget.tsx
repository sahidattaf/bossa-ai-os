import { formatCurrency } from "@/lib/format/kpi";
import type { RevenueForecastData } from "@/lib/dashboard/types";
import type { WidgetComponentProps } from "@/lib/widgets/types";

export interface RevenueForecastViewModel extends RevenueForecastData {
  currency: string;
  locale: string;
}

function RevenueForecastWidget({ data }: WidgetComponentProps<RevenueForecastViewModel>) {
  const max = Math.max(...data.projectedAmounts, 1);

  return (
    <div className="flex h-full items-end gap-3">
      {data.labels.map((label, index) => {
        const amount = data.projectedAmounts[index] ?? 0;
        const heightPercent = Math.round((amount / max) * 100);

        return (
          <div key={label} className="flex flex-1 flex-col items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {formatCurrency(amount, data.currency, data.locale)}
            </span>
            <div className="flex h-24 w-full items-end rounded-md bg-surface-elevated">
              <div
                className="w-full rounded-md bg-chart-1"
                style={{ height: `${heightPercent}%` }}
              />
            </div>
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export { RevenueForecastWidget };

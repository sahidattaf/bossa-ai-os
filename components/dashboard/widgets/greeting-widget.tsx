import { ServiceStatusIndicator } from "@/components/layout/service-status-indicator";
import type { GreetingData } from "@/lib/dashboard/types";
import type { ServiceStatus } from "@/lib/tenancy/types";
import type { WidgetComponentProps } from "@/lib/widgets/types";

export interface GreetingWidgetData extends GreetingData {
  serviceStatus: ServiceStatus;
}

function GreetingWidget({ data }: WidgetComponentProps<GreetingWidgetData>) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{data.headline}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{data.summary}</p>
      </div>
      <ServiceStatusIndicator status={data.serviceStatus} />
    </div>
  );
}

export { GreetingWidget };

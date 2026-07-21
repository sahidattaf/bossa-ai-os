import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { PermissionState } from "@/components/ui/permission-state";
import { WidgetFrame } from "@/components/dashboard/widget-frame";
import type { DashboardData } from "@/lib/dashboard/types";
import type { TenantConfig } from "@/lib/tenancy/types";
import { hasPermission } from "@/lib/widgets/permissions";
import { getWidgetDefinition } from "@/lib/widgets/registry";
import { validateDashboardWidgets } from "@/lib/widgets/schema";

export interface DashboardGridProps {
  tenant: TenantConfig;
  data: DashboardData;
  /** Wildcard "*" grants every permission. Phase 1 has no auth, so pages default to it. */
  permissions?: readonly string[];
}

function DashboardGrid({ tenant, data, permissions = ["*"] }: DashboardGridProps) {
  let widgets;
  try {
    widgets = validateDashboardWidgets(tenant.dashboardWidgets);
  } catch {
    return (
      <ErrorState
        title="Dashboard configuration is invalid"
        description={`${tenant.name}'s widget configuration failed validation. Contact platform support.`}
      />
    );
  }

  const visibleWidgets = widgets.filter((widget) => widget.visible).sort((a, b) => a.order - b.order);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {visibleWidgets.map((widgetConfig) => {
        const definition = getWidgetDefinition(widgetConfig.key);

        if (!hasPermission(permissions, widgetConfig.requiredPermission)) {
          return (
            <WidgetFrame key={widgetConfig.key} title={definition.title} size={widgetConfig.size}>
              <PermissionState requiredPermission={widgetConfig.requiredPermission} />
            </WidgetFrame>
          );
        }

        let widgetData: unknown;
        try {
          widgetData = definition.selectData(data, tenant);
        } catch {
          return (
            <WidgetFrame key={widgetConfig.key} title={definition.title} size={widgetConfig.size}>
              <ErrorState description={`${definition.title} couldn't load its data.`} />
            </WidgetFrame>
          );
        }

        if (Array.isArray(widgetData) && widgetData.length === 0) {
          return (
            <WidgetFrame key={widgetConfig.key} title={definition.title} size={widgetConfig.size}>
              <EmptyState title="Nothing to show yet" />
            </WidgetFrame>
          );
        }

        const Widget = definition.component;

        return (
          <WidgetFrame key={widgetConfig.key} title={definition.title} size={widgetConfig.size}>
            <Widget data={widgetData} tenant={tenant} />
          </WidgetFrame>
        );
      })}
    </div>
  );
}

export { DashboardGrid };

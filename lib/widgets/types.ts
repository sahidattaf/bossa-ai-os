import type { ComponentType } from "react";

import type { DashboardData } from "@/lib/dashboard/types";
import type { TenantConfig, WidgetKey, WidgetSize } from "@/lib/tenancy/types";

export interface WidgetComponentProps<TData> {
  data: TData;
  tenant: TenantConfig;
}

export interface WidgetDefinition<TData> {
  key: WidgetKey;
  title: string;
  defaultSize: WidgetSize;
  component: ComponentType<WidgetComponentProps<TData>>;
  selectData: (dashboardData: DashboardData, tenant: TenantConfig) => TData;
}

/** Registry storage is necessarily heterogeneous across widget data shapes. */
export type AnyWidgetDefinition = WidgetDefinition<unknown>;

export function defineWidget<TData>(definition: WidgetDefinition<TData>): AnyWidgetDefinition {
  return definition as AnyWidgetDefinition;
}

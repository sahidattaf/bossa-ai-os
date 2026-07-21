import { z } from "zod";

import { WIDGET_KEYS } from "@/lib/tenancy/types";

export const widgetSizeSchema = z.enum(["sm", "md", "lg", "full"]);
export const widgetKeySchema = z.enum(WIDGET_KEYS);

export const dashboardWidgetInstanceConfigSchema = z.object({
  key: widgetKeySchema,
  order: z.number().int().nonnegative(),
  size: widgetSizeSchema,
  visible: z.boolean(),
  requiredPermission: z.string().min(1).optional(),
});

export const dashboardWidgetConfigListSchema = z.array(dashboardWidgetInstanceConfigSchema);

export function validateDashboardWidgets(config: unknown) {
  return dashboardWidgetConfigListSchema.parse(config);
}

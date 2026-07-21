import { describe, expect, it } from "vitest";

import { getTenantBySlug } from "@/lib/tenancy/tenants";
import { WIDGET_KEYS } from "@/lib/tenancy/types";
import { dashboardDataProvider } from "@/lib/dashboard/mock-provider";
import { getWidgetDefinition } from "@/lib/widgets/registry";

describe("widget registry", () => {
  it("has a definition for every widget key", () => {
    for (const key of WIDGET_KEYS) {
      const definition = getWidgetDefinition(key);
      expect(definition).toBeDefined();
      expect(definition.key).toBe(key);
      expect(definition.component).toBeDefined();
    }
  });

  it("selectData produces data for every BOSSA widget without throwing", async () => {
    const tenant = getTenantBySlug("bossa")!;
    const data = await dashboardDataProvider.getDashboardData(tenant.id);

    for (const widget of tenant.dashboardWidgets) {
      const definition = getWidgetDefinition(widget.key);
      expect(() => definition.selectData(data, tenant)).not.toThrow();
    }
  });

  it("selectData produces data for every Papai widget without throwing", async () => {
    const tenant = getTenantBySlug("papai")!;
    const data = await dashboardDataProvider.getDashboardData(tenant.id);

    for (const widget of tenant.dashboardWidgets) {
      const definition = getWidgetDefinition(widget.key);
      expect(() => definition.selectData(data, tenant)).not.toThrow();
    }
  });
});

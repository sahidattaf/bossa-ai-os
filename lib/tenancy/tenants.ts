import type { DashboardWidgetInstanceConfig, TenantConfig, WidgetKey } from "./types";

function widgetOrder(
  overrides: Partial<Record<WidgetKey, Partial<DashboardWidgetInstanceConfig>>> = {},
): DashboardWidgetInstanceConfig[] {
  const defaults: DashboardWidgetInstanceConfig[] = [
    { key: "greeting", order: 1, size: "full", visible: true },
    { key: "revenueToday", order: 2, size: "sm", visible: true },
    { key: "ordersToday", order: 3, size: "sm", visible: true },
    { key: "reservationsTonight", order: 4, size: "sm", visible: true },
    { key: "whatsappLeads", order: 5, size: "sm", visible: true },
    { key: "reviewScore", order: 6, size: "sm", visible: true },
    { key: "productKpi", order: 7, size: "sm", visible: true },
    { key: "foodCostPercentage", order: 8, size: "sm", visible: true },
    { key: "laborPercentage", order: 9, size: "sm", visible: true },
    { key: "syncPanel", order: 10, size: "md", visible: true },
    { key: "aiPriorities", order: 11, size: "md", visible: true },
    {
      key: "approvalQueue",
      order: 12,
      size: "md",
      visible: true,
      requiredPermission: "ai.actions.approve",
    },
    { key: "liveAlerts", order: 13, size: "md", visible: true },
    {
      key: "revenueForecast",
      order: 14,
      size: "lg",
      visible: true,
      requiredPermission: "finance.read",
    },
    { key: "quickActions", order: 15, size: "full", visible: true },
  ];

  return defaults.map((widget) => ({ ...widget, ...overrides[widget.key] }));
}

const BOSSA_TENANT: TenantConfig = {
  id: "org_001_bossa",
  slug: "bossa",
  name: "BOSSA Asado i Mar",
  businessType: "restaurant",
  branding: {
    logoInitials: "BA",
    primaryColor: "24 95% 53%",
    accentColor: "199 89% 58%",
    themeMode: "dark",
    borderRadius: "standard",
  },
  locale: "en-CW",
  timezone: "America/Curacao",
  currency: "USD",
  serviceStatus: "open",
  aiManagerName: "BossVisionGPT",
  productKpi: { label: "Fire Boxes Sold", unit: "boxes" },
  dashboardWidgets: widgetOrder(),
};

const PAPAI_TENANT: TenantConfig = {
  id: "org_002_papai",
  slug: "papai",
  name: "Papai Since 1933",
  businessType: "restaurant",
  branding: {
    logoInitials: "PS",
    primaryColor: "142 45% 28%",
    accentColor: "38 75% 45%",
    themeMode: "light",
    borderRadius: "soft",
  },
  locale: "en-CW",
  timezone: "America/Curacao",
  currency: "ANG",
  serviceStatus: "opening_soon",
  aiManagerName: "PapaiLegacyGPT",
  productKpi: { label: "Heritage Platters Served", unit: "platters" },
  dashboardWidgets: widgetOrder(),
};

const TENANTS: readonly TenantConfig[] = [BOSSA_TENANT, PAPAI_TENANT];

export function listTenants(): readonly TenantConfig[] {
  return TENANTS;
}

export function listTenantSlugs(): string[] {
  return TENANTS.map((tenant) => tenant.slug);
}

export function getTenantBySlug(slug: string): TenantConfig | undefined {
  return TENANTS.find((tenant) => tenant.slug === slug.toLowerCase());
}

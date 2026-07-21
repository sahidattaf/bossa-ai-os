export type ThemeMode = "light" | "dark" | "system";

export type ServiceStatus = "open" | "busy" | "opening_soon" | "closed";

export type BusinessType =
  | "restaurant"
  | "cafe"
  | "hotel"
  | "beach_club"
  | "caterer";

export type BorderRadiusStyle = "compact" | "standard" | "soft";

export type WidgetSize = "sm" | "md" | "lg" | "full";

/**
 * Every dashboard widget the platform knows how to render. Tenants opt into a
 * subset (and order) of these via `TenantConfig.dashboardWidgets`. The widget
 * registry (lib/widgets/registry.ts) maps each key to its component.
 */
export const WIDGET_KEYS = [
  "greeting",
  "revenueToday",
  "ordersToday",
  "reservationsTonight",
  "whatsappLeads",
  "reviewScore",
  "productKpi",
  "foodCostPercentage",
  "laborPercentage",
  "syncPanel",
  "aiPriorities",
  "approvalQueue",
  "liveAlerts",
  "revenueForecast",
  "quickActions",
] as const;

export type WidgetKey = (typeof WIDGET_KEYS)[number];

export interface DashboardWidgetInstanceConfig {
  key: WidgetKey;
  order: number;
  size: WidgetSize;
  visible: boolean;
  /** Capability required to view this widget, e.g. "finance.read". Omitted = no restriction. */
  requiredPermission?: string;
}

export interface TenantBranding {
  /** 1-3 letter mark shown when no logo image is configured. */
  logoInitials: string;
  logoUrl?: string;
  /** HSL triplet, e.g. "24 95% 53%" — matches the `hsl(var(--x) / <alpha>)` token format. */
  primaryColor: string;
  accentColor: string;
  themeMode: ThemeMode;
  borderRadius: BorderRadiusStyle;
}

export interface TenantProductKpi {
  label: string;
  unit?: string;
}

export interface TenantConfig {
  id: string;
  slug: string;
  name: string;
  businessType: BusinessType;
  branding: TenantBranding;
  locale: string;
  timezone: string;
  /** ISO 4217 currency code. */
  currency: string;
  serviceStatus: ServiceStatus;
  aiManagerName: string;
  productKpi: TenantProductKpi;
  dashboardWidgets: DashboardWidgetInstanceConfig[];
}

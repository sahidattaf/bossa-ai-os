/**
 * Pure planning logic for scripts/bootstrap-production-tenants.ts, kept in
 * its own module (no Supabase client, no I/O) so it can be unit-tested
 * without touching a real or local database. See that script's header
 * comment for the full production-bootstrap contract.
 */

export type TenantKey = "bossa" | "papai";

export interface TenantBootstrapSpec {
  slug: string;
  name: string;
  businessType: string;
  status: string;
  location: { name: string; isPrimary: boolean; timezone: string; currency: string };
  branding: {
    logoInitials: string;
    primaryColor: string;
    accentColor: string;
    themeMode: string;
    borderRadius: string;
  };
  settings: {
    locale: string;
    timezone: string;
    currency: string;
    serviceStatus: string;
    aiManagerName: string;
    productKpiLabel: string;
    productKpiUnit: string;
    dashboardWidgets: unknown[];
  };
}

/** Matches lib/tenancy/tenants.ts's widgetOrder() default one-for-one (mirrored, not imported, since that helper also applies runtime overrides this bootstrap doesn't need). A fresh array per call avoids sharing one mutable reference across both tenant specs below. */
function defaultDashboardWidgets(): unknown[] {
  return [
    { key: "greeting", order: 1, size: "full", visible: true },
    { key: "revenueToday", order: 2, size: "sm", visible: true, requiredPermission: "finance.read" },
    { key: "ordersToday", order: 3, size: "sm", visible: true },
    { key: "reservationsTonight", order: 4, size: "sm", visible: true },
    { key: "whatsappLeads", order: 5, size: "sm", visible: true },
    { key: "reviewScore", order: 6, size: "sm", visible: true },
    { key: "productKpi", order: 7, size: "sm", visible: true },
    { key: "foodCostPercentage", order: 8, size: "sm", visible: true },
    { key: "laborPercentage", order: 9, size: "sm", visible: true },
    { key: "syncPanel", order: 10, size: "md", visible: true },
    { key: "aiPriorities", order: 11, size: "md", visible: true },
    { key: "approvalQueue", order: 12, size: "md", visible: true, requiredPermission: "ai.actions.approve" },
    { key: "liveAlerts", order: 13, size: "md", visible: true },
    { key: "revenueForecast", order: 14, size: "lg", visible: true, requiredPermission: "finance.read" },
    { key: "quickActions", order: 15, size: "full", visible: true },
  ];
}

/**
 * Mirrors supabase/seed.sql's organization_branding/organization_settings
 * values exactly — that data is BOSSA's/Papai's real visual identity, not
 * fake fixture data. Only seed.sql's fixed all-zero UUIDs, fake auth users,
 * and dev password are fixture-only; the branding/settings shape here is
 * the genuine production configuration.
 */
export const TENANT_BOOTSTRAP_SPECS: Record<TenantKey, TenantBootstrapSpec> = {
  bossa: {
    slug: "bossa",
    name: "BOSSA Asado i Mar",
    businessType: "restaurant",
    status: "active",
    location: { name: "BOSSA Asado i Mar — Main", isPrimary: true, timezone: "America/Curacao", currency: "USD" },
    branding: {
      logoInitials: "BA",
      primaryColor: "24 95% 53%",
      accentColor: "199 89% 58%",
      themeMode: "dark",
      borderRadius: "standard",
    },
    settings: {
      locale: "en-CW",
      timezone: "America/Curacao",
      currency: "USD",
      serviceStatus: "open",
      aiManagerName: "BossVisionGPT",
      productKpiLabel: "Fire Boxes Sold",
      productKpiUnit: "boxes",
      dashboardWidgets: defaultDashboardWidgets(),
    },
  },
  papai: {
    slug: "papai",
    name: "Papai Since 1933",
    businessType: "restaurant",
    // Real current business state — do not activate until Papai's own
    // launch decision is made, independent of the technical cutover.
    status: "onboarding",
    location: { name: "Papai Since 1933 — Main", isPrimary: true, timezone: "America/Curacao", currency: "ANG" },
    branding: {
      logoInitials: "PS",
      primaryColor: "142 45% 28%",
      accentColor: "38 75% 45%",
      themeMode: "light",
      borderRadius: "soft",
    },
    settings: {
      locale: "en-CW",
      timezone: "America/Curacao",
      currency: "ANG",
      serviceStatus: "opening_soon",
      aiManagerName: "PapaiLegacyGPT",
      productKpiLabel: "Heritage Platters Served",
      productKpiUnit: "platters",
      dashboardWidgets: defaultDashboardWidgets(),
    },
  },
};

export interface BootstrapArgs {
  org?: TenantKey;
  ownerEmails: Partial<Record<TenantKey, string>>;
  confirm: boolean;
}

export function parseArgs(argv: string[]): BootstrapArgs {
  const result: BootstrapArgs = { ownerEmails: {}, confirm: false };
  for (const arg of argv) {
    if (arg === "--confirm") {
      result.confirm = true;
      continue;
    }
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "org" && (value === "bossa" || value === "papai")) result.org = value;
    if (key === "bossa-owner-email" && value) result.ownerEmails.bossa = value;
    if (key === "papai-owner-email" && value) result.ownerEmails.papai = value;
  }
  return result;
}

/** Which tenants this invocation targets. Defaults to both. */
export function resolveBootstrapTargets(org: TenantKey | undefined): TenantKey[] {
  return org ? [org] : ["bossa", "papai"];
}

/** A human-readable description of exactly what a run would do, used for both the dry-run printout and its unit test. */
export function describeBootstrapPlan(targets: TenantKey[], ownerEmails: Partial<Record<TenantKey, string>>): string[] {
  const lines: string[] = [];
  for (const key of targets) {
    const spec = TENANT_BOOTSTRAP_SPECS[key];
    lines.push(`${spec.slug}: upsert organization "${spec.name}" (status=${spec.status})`);
    lines.push(`${spec.slug}: ensure primary location "${spec.location.name}" exists (insert only if absent)`);
    lines.push(`${spec.slug}: upsert organization_branding and organization_settings`);
    const email = ownerEmails[key];
    if (email) {
      lines.push(`${spec.slug}: invite owner "${email}" (or find existing user by that email) and grant organization_owner`);
    } else {
      lines.push(`${spec.slug}: no owner email given — skipping owner invite/membership for this run`);
    }
  }
  return lines;
}

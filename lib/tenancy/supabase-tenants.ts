import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";

import type { Database } from "@/lib/supabase/database.types";
import { validateDashboardWidgets } from "@/lib/widgets/schema";

import type { TenantSummary } from "./tenants";
import type { TenantConfig } from "./types";

export type TenantAccessResult =
  | { status: "not_found" }
  | { status: "no_access"; organizationName: string }
  | { status: "ok"; tenant: TenantConfig; permissions: string[]; roleNames: string[] };

/**
 * Resolves a route slug to a tenant for the *current authenticated user*,
 * distinguishing "no such organization" from "organization exists, no
 * active membership" — see get_organization_summary()'s comment in
 * supabase/migrations for why that distinction needs its own RPC.
 *
 * Wrapped in cache() so the workspace layout and the page it renders both
 * calling this for the same slug within one request only hits Postgres once.
 */
export const resolveTenantForCurrentUser = cache(async function resolveTenantForCurrentUser(
  supabase: SupabaseClient<Database>,
  slug: string,
): Promise<TenantAccessResult> {
  const { data: summaryRows } = await supabase.rpc("get_organization_summary", { p_slug: slug });
  const summary = summaryRows?.[0];

  if (!summary) {
    return { status: "not_found" };
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, slug, name, business_type")
    .eq("id", summary.id)
    .maybeSingle();

  if (!organization) {
    // RLS hid the full row: the organization exists, but this user has no
    // active membership in it.
    return { status: "no_access", organizationName: summary.name };
  }

  const [{ data: branding }, { data: settings }, { data: permissions }, { data: roleNames }] =
    await Promise.all([
      supabase
        .from("organization_branding")
        .select("*")
        .eq("organization_id", organization.id)
        .maybeSingle(),
      supabase
        .from("organization_settings")
        .select("*")
        .eq("organization_id", organization.id)
        .maybeSingle(),
      supabase.rpc("get_my_permissions", { p_organization_id: organization.id }),
      supabase.rpc("get_my_role_names", { p_organization_id: organization.id }),
    ]);

  if (!branding || !settings) {
    // Shouldn't happen for a real, fully-provisioned org — fail closed.
    return { status: "no_access", organizationName: summary.name };
  }

  const dashboardWidgets = validateDashboardWidgets(settings.dashboard_widgets);

  const tenant: TenantConfig = {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    businessType: organization.business_type as TenantConfig["businessType"],
    branding: {
      logoInitials: branding.logo_initials,
      logoUrl: branding.logo_url ?? undefined,
      primaryColor: branding.primary_color,
      accentColor: branding.accent_color,
      themeMode: branding.theme_mode,
      borderRadius: branding.border_radius,
    },
    locale: settings.locale,
    timezone: settings.timezone,
    currency: settings.currency,
    serviceStatus: settings.service_status,
    aiManagerName: settings.ai_manager_name,
    productKpi: { label: settings.product_kpi_label, unit: settings.product_kpi_unit ?? undefined },
    dashboardWidgets,
  };

  return {
    status: "ok",
    tenant,
    permissions: permissions ?? [],
    roleNames: roleNames && roleNames.length > 0 ? roleNames : ["Member"],
  };
});

/** Organizations the current user has an active membership in, for the switcher. */
export const listMyOrganizationSummaries = cache(async function listMyOrganizationSummaries(
  supabase: SupabaseClient<Database>,
): Promise<TenantSummary[]> {
  const { data: memberships } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("status", "active");

  const organizationIds = (memberships ?? []).map((m) => m.organization_id);
  if (organizationIds.length === 0) {
    return [];
  }

  const [{ data: organizations }, { data: brandings }] = await Promise.all([
    supabase.from("organizations").select("id, slug, name").in("id", organizationIds),
    supabase
      .from("organization_branding")
      .select("organization_id, logo_initials")
      .in("organization_id", organizationIds),
  ]);

  const initialsByOrgId = new Map(
    (brandings ?? []).map((b) => [b.organization_id, b.logo_initials]),
  );

  return (organizations ?? []).map((org) => ({
    id: org.id,
    slug: org.slug,
    name: org.name,
    logoInitials: initialsByOrgId.get(org.id) || org.name.slice(0, 2).toUpperCase(),
  }));
});

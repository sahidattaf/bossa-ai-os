/**
 * One-off, manual production bootstrap for the two real BOSSA/Papai tenants
 * (issue #20 Lane A). This is deliberately separate from `supabase/seed.sql`,
 * which is dev/test-only fixture data and must never be applied to a real
 * project — see docs/PRODUCTION_DEPLOYMENT.md's "Production seed policy".
 *
 * Creates only: the two organizations (by their real, fixed slugs), one
 * primary location each, organization_branding, organization_settings, and
 * (if an owner email is given) a real invited owner + organization_owner
 * membership. Never touches any other table, never deletes or overwrites
 * existing rows (locations/memberships/role grants are only inserted if
 * absent; branding/settings use an idempotent upsert keyed on
 * organization_id).
 *
 * DRY RUN BY DEFAULT. Nothing is written unless --confirm is passed.
 *
 * Usage:
 *   npm run bootstrap:production-tenants -- --bossa-owner-email=owner@bossa.example
 *   npm run bootstrap:production-tenants -- --org=bossa --bossa-owner-email=owner@bossa.example --confirm
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the
 * environment (the same service-role credentials used by
 * scripts/generate-kpi-snapshots.ts and scripts/evaluate-ai-executive.ts —
 * see lib/supabase/service-role.ts). Never run this in CI, and never wire it
 * into any request path.
 */
import { createServiceRoleClient } from "../lib/supabase/service-role";
import {
  describeBootstrapPlan,
  parseArgs,
  resolveBootstrapTargets,
  TENANT_BOOTSTRAP_SPECS,
  type TenantBootstrapSpec,
} from "./lib/bootstrap-production-tenants-plan";

async function findOrInviteUser(supabase: ReturnType<typeof createServiceRoleClient>, email: string): Promise<string> {
  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email);
  if (!inviteError && invited.user) {
    return invited.user.id;
  }

  // Most likely cause of a failed invite: the user already exists. Fall back
  // to paging through existing users to find the matching email rather than
  // failing outright — this script is meant to be safely re-runnable.
  for (let page = 1; page <= 20; page += 1) {
    const { data: pageResult, error: listError } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (listError) {
      throw new Error(
        `Could not invite "${email}" (${inviteError?.message}) and could not list users to find an existing match: ${listError.message}`,
      );
    }
    const existing = pageResult.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      return existing.id;
    }
    if (pageResult.users.length < 200) break;
  }

  throw new Error(`Could not invite "${email}" and could not find an existing user with that email: ${inviteError?.message}`);
}

async function bootstrapTenant(
  supabase: ReturnType<typeof createServiceRoleClient>,
  spec: TenantBootstrapSpec,
  ownerEmail: string | undefined,
): Promise<void> {
  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .upsert({ slug: spec.slug, name: spec.name, business_type: spec.businessType, status: spec.status }, { onConflict: "slug" })
    .select("id")
    .single();
  if (orgError || !organization) {
    throw new Error(`Failed to upsert organization "${spec.slug}": ${orgError?.message}`);
  }
  console.log(`  ✓ organization "${spec.slug}" -> ${organization.id}`);

  const { data: existingLocation } = await supabase
    .from("locations")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("is_primary", true)
    .maybeSingle();

  if (existingLocation) {
    console.log(`  ✓ primary location already exists (${existingLocation.id}) — left untouched`);
  } else {
    const { data: location, error: locationError } = await supabase
      .from("locations")
      .insert({
        organization_id: organization.id,
        name: spec.location.name,
        is_primary: spec.location.isPrimary,
        timezone: spec.location.timezone,
        currency: spec.location.currency,
      })
      .select("id")
      .single();
    if (locationError || !location) {
      throw new Error(`Failed to create location for "${spec.slug}": ${locationError?.message}`);
    }
    console.log(`  ✓ created primary location -> ${location.id}`);
  }

  const { error: brandingError } = await supabase.from("organization_branding").upsert(
    {
      organization_id: organization.id,
      logo_initials: spec.branding.logoInitials,
      primary_color: spec.branding.primaryColor,
      accent_color: spec.branding.accentColor,
      theme_mode: spec.branding.themeMode,
      border_radius: spec.branding.borderRadius,
    },
    { onConflict: "organization_id" },
  );
  if (brandingError) throw new Error(`Failed to upsert branding for "${spec.slug}": ${brandingError.message}`);
  console.log(`  ✓ branding upserted`);

  const { error: settingsError } = await supabase.from("organization_settings").upsert(
    {
      organization_id: organization.id,
      locale: spec.settings.locale,
      timezone: spec.settings.timezone,
      currency: spec.settings.currency,
      service_status: spec.settings.serviceStatus,
      ai_manager_name: spec.settings.aiManagerName,
      product_kpi_label: spec.settings.productKpiLabel,
      product_kpi_unit: spec.settings.productKpiUnit,
      dashboard_widgets: spec.settings.dashboardWidgets as never,
    },
    { onConflict: "organization_id" },
  );
  if (settingsError) throw new Error(`Failed to upsert settings for "${spec.slug}": ${settingsError.message}`);
  console.log(`  ✓ settings upserted`);

  if (!ownerEmail) {
    console.log(`  – no owner email given, skipping membership grant`);
    return;
  }

  const userId = await findOrInviteUser(supabase, ownerEmail);
  console.log(`  ✓ owner user resolved -> ${userId}`);

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .upsert({ organization_id: organization.id, user_id: userId, status: "active" }, { onConflict: "organization_id,user_id" })
    .select("id")
    .single();
  if (membershipError || !membership) {
    throw new Error(`Failed to upsert membership for "${spec.slug}"/"${ownerEmail}": ${membershipError?.message}`);
  }
  console.log(`  ✓ membership upserted -> ${membership.id}`);

  const { data: role, error: roleError } = await supabase.from("roles").select("id").eq("key", "organization_owner").single();
  if (roleError || !role) {
    throw new Error(`Could not find the "organization_owner" role: ${roleError?.message}`);
  }

  const { error: roleGrantError } = await supabase
    .from("membership_roles")
    .upsert({ membership_id: membership.id, role_id: role.id, organization_id: organization.id }, { onConflict: "membership_id,role_id" });
  if (roleGrantError) {
    throw new Error(`Failed to grant organization_owner for "${spec.slug}"/"${ownerEmail}": ${roleGrantError.message}`);
  }
  console.log(`  ✓ organization_owner role granted`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = resolveBootstrapTargets(args.org);

  console.log("Production tenant bootstrap plan:");
  for (const line of describeBootstrapPlan(targets, args.ownerEmails)) {
    console.log(`  ${line}`);
  }

  if (!args.confirm) {
    console.log("\nDRY RUN — no changes made. Re-run with --confirm to apply.");
    return;
  }

  console.log("\n--confirm passed. Applying...\n");
  const supabase = createServiceRoleClient();

  let failures = 0;
  for (const key of targets) {
    console.log(`${key}:`);
    try {
      await bootstrapTenant(supabase, TENANT_BOOTSTRAP_SPECS[key], args.ownerEmails[key]);
    } catch (error) {
      failures += 1;
      console.error(`  ✗ ${error instanceof Error ? error.message : error}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Unhandled error while bootstrapping production tenants:", error);
  process.exitCode = 1;
});

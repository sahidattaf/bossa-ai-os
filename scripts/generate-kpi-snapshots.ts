/**
 * Manual invocation path for the daily KPI snapshot job (issue #16 scope F).
 * No Vercel Cron / Supabase scheduled job is enabled in Phase 3 — this
 * script is the only way daily_kpi_snapshots rows get generated today. See
 * docs/KPI_SNAPSHOT_OPERATIONS.md for the full runbook.
 *
 * Usage:
 *   npm run kpi:generate                  # all organizations, today (UTC)
 *   npm run kpi:generate -- --date=2026-07-20
 *   npm run kpi:generate -- --org=bossa --date=2026-07-20
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the
 * environment (the same service-role credentials used nowhere else in the
 * request path — see lib/supabase/service-role.ts). Safe to rerun: the
 * underlying RPC always fully recomputes and upserts.
 */
import { createServiceRoleClient } from "../lib/supabase/service-role";

function parseArgs(argv: string[]): { date?: string; org?: string } {
  const result: { date?: string; org?: string } = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "date" && value) result.date = value;
    if (key === "org" && value) result.org = value;
  }
  return result;
}

async function main() {
  const { date, org } = parseArgs(process.argv.slice(2));
  const snapshotDate = date ?? new Date().toISOString().slice(0, 10);

  const supabase = createServiceRoleClient();

  let orgQuery = supabase.from("organizations").select("id, slug, name").eq("status", "active");
  if (org) {
    orgQuery = orgQuery.eq("slug", org);
  }

  const { data: organizations, error: orgError } = await orgQuery;
  if (orgError) {
    console.error("Failed to list organizations:", orgError.message);
    process.exitCode = 1;
    return;
  }

  if (!organizations || organizations.length === 0) {
    console.log("No matching organizations found. Nothing to do.");
    return;
  }

  console.log(`Generating daily KPI snapshots for ${snapshotDate} (${organizations.length} organization(s))...`);

  let failures = 0;
  for (const organization of organizations) {
    const { data, error } = await supabase.rpc("calculate_daily_kpi_snapshot", {
      p_organization_id: organization.id,
      p_snapshot_date: snapshotDate,
      p_location_id: null,
    });

    if (error) {
      failures += 1;
      console.error(`  ✗ ${organization.slug}: ${error.message}`);
      continue;
    }

    console.log(
      `  ✓ ${organization.slug}: revenue=${data.revenue} orders=${data.order_count} reservations=${data.reservation_count} covers=${data.covers}`,
    );
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Unhandled error while generating KPI snapshots:", error);
  process.exitCode = 1;
});

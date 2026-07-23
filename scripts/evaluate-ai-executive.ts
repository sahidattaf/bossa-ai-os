/**
 * Manual invocation path for the AI Executive deterministic evaluation
 * pipeline (issue #18 "Deterministic evaluation process"). No Vercel Cron /
 * Supabase scheduled job is enabled in this phase — this script and the
 * in-app "re-evaluate now" action are the only ways evaluation runs today.
 *
 * Usage:
 *   npm run ai:evaluate                       # all active organizations, now
 *   npm run ai:evaluate -- --org=bossa
 *   npm run ai:evaluate -- --as-of=2026-07-20T18:00:00Z
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (the same
 * service-role credentials used nowhere in the request path — see
 * lib/supabase/service-role.ts). Safe to rerun: apply_ai_evaluation() is
 * fully idempotent per (organization, location, as_of, rule_version).
 */
import { evaluateOrganization } from "../lib/ai/evaluate";
import { createServiceRoleClient } from "../lib/supabase/service-role";

function parseArgs(argv: string[]): { org?: string; asOf?: string } {
  const result: { org?: string; asOf?: string } = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "org" && value) result.org = value;
    if (key === "as-of" && value) result.asOf = value;
  }
  return result;
}

async function main() {
  const { org, asOf } = parseArgs(process.argv.slice(2));
  const evaluationAsOf = asOf ? new Date(asOf) : new Date();

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

  console.log(`Running AI Executive evaluation as of ${evaluationAsOf.toISOString()} (${organizations.length} organization(s))...`);

  let failures = 0;
  for (const organization of organizations) {
    try {
      const result = await evaluateOrganization(supabase, organization.id, { asOf: evaluationAsOf });
      console.log(
        `  ✓ ${organization.slug}: signals +${result.signalsUpserted}/-${result.signalsResolved}, ` +
          `recommendations +${result.recommendationsUpserted} (${result.recommendationsDeferred} deferred)/-${result.recommendationsExpired}, ` +
          `approvals expired ${result.approvalsExpired}`,
      );
    } catch (error) {
      failures += 1;
      console.error(`  ✗ ${organization.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Unhandled error while running AI Executive evaluation:", error);
  process.exitCode = 1;
});

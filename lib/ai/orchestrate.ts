import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toOperationalError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

import { evaluateOrganization, type ApplyEvaluationResult } from "./evaluate";

type SupabaseDb = SupabaseClient<Database>;

export interface OrchestratedEvaluationResult {
  perLocation: Array<{ locationId: string; result: ApplyEvaluationResult }>;
  organization: ApplyEvaluationResult;
}

/**
 * The tenant-wide evaluation orchestrator (issue: exact evaluation
 * orchestration — a rule's declared scope, lib/ai/rules/types.ts's
 * RuleScope, only actually means anything if something runs it at the
 * right granularity). Runs one location-scoped evaluateOrganization() call
 * per currently active location (fetched fresh from `locations` every time,
 * so adding a third location later requires no code change here), plus
 * exactly one organization-scoped call — never a single ambiguous call that
 * tries to cover both.
 *
 * This is the primary entry point real usage should call
 * (scripts/evaluate-ai-executive.ts does) — evaluateOrganization() itself
 * only evaluates the one scope you ask it for, and most of the rule catalog
 * is 'location'-scoped, so a bare organization-wide call alone would never
 * run them.
 */
export async function evaluateOrganizationAcrossLocations(
  supabase: SupabaseDb,
  organizationId: string,
  options?: { asOf?: Date },
): Promise<OrchestratedEvaluationResult> {
  const asOf = options?.asOf ?? new Date();

  const { data: locations, error } = await supabase.from("locations").select("id").eq("organization_id", organizationId);
  if (error) throw toOperationalError(error);

  const perLocation: Array<{ locationId: string; result: ApplyEvaluationResult }> = [];
  for (const location of locations ?? []) {
    const result = await evaluateOrganization(supabase, organizationId, { asOf, locationId: location.id });
    perLocation.push({ locationId: location.id, result });
  }

  const organization = await evaluateOrganization(supabase, organizationId, { asOf, locationId: null });

  return { perLocation, organization };
}

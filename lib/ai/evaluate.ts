import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toOperationalError } from "@/lib/errors";
import type { Database, Json } from "@/lib/supabase/database.types";

import { runLocalSkills } from "./plugins/registry";
import { RULE_REGISTRY } from "./rules/rule-registry";
import { ruleAppliesToScope, type EvaluationFacts } from "./rules/types";
import { evaluationIntentsSchema, type EvaluationIntents, type RecommendationIntent, type SignalIntent } from "./schemas";

type SupabaseDb = SupabaseClient<Database>;

/** The evaluation-run version tag used for stale-signal/recommendation resolution — see apply_ai_evaluation()'s header comment. Bump when the rule engine's overall behavior changes meaningfully. */
const EVALUATOR_VERSION = "phase4.v1";

export interface ApplyEvaluationResult {
  signalsUpserted: number;
  signalsResolved: number;
  recommendationsUpserted: number;
  recommendationsDeferred: number;
  recommendationsExpired: number;
  approvalsExpired: number;
}

interface RuleConfigOverride {
  enabled: boolean;
  config: unknown;
}

async function loadRuleConfigs(
  supabase: SupabaseDb,
  organizationId: string,
  locationId: string | null,
): Promise<Map<string, RuleConfigOverride>> {
  const { data, error } = await supabase
    .from("ai_rule_configs")
    .select("rule_key, enabled, config, location_id")
    .eq("organization_id", organizationId);

  if (error) throw toOperationalError(error);

  const map = new Map<string, RuleConfigOverride>();
  for (const row of data ?? []) {
    // A location-specific row only applies when it matches the location
    // being evaluated; an org-wide row (location_id null) is the fallback.
    if (row.location_id !== null && row.location_id !== locationId) continue;
    const existing = map.get(row.rule_key);
    if (!existing || row.location_id === locationId) {
      map.set(row.rule_key, { enabled: row.enabled, config: row.config });
    }
  }
  return map;
}

/**
 * Converts pure-TypeScript rule output into the snake_case shape
 * apply_ai_evaluation() expects. `evaluationLocationId` is the exact scope
 * of the current run (the same value passed as p_location_id): a signal or
 * recommendation that doesn't set its own locationId inherits the run's
 * scope, rather than always falling back to null — otherwise a
 * location-scoped run's own facts (e.g. the provider-failure signal below,
 * which never sets locationId) would submit an explicit null location_id,
 * which apply_ai_evaluation()'s mixed-scope guard correctly rejects as not
 * matching p_location_id.
 */
function toSnakeCaseIntents(intents: EvaluationIntents, evaluationLocationId: string | null) {
  return {
    signals: intents.signals.map((s: SignalIntent) => ({
      signal_type: s.signalType,
      location_id: s.locationId ?? evaluationLocationId,
      severity: s.severity,
      title: s.title,
      facts: s.facts ?? {},
      observed_at: s.observedAt ?? null,
      dedupe_key: s.dedupeKey,
      source_entity_type: s.sourceEntityType ?? null,
      source_entity_id: s.sourceEntityId ?? null,
    })),
    recommendations: intents.recommendations.map((r: RecommendationIntent) => ({
      dedupe_key: r.dedupeKey,
      location_id: r.locationId ?? evaluationLocationId,
      recommendation_type: r.recommendationType,
      title: r.title,
      executive_summary: r.executiveSummary,
      severity: r.severity,
      priority_score: r.priorityScore ?? 0,
      recommended_action_type: r.recommendedActionType,
      action_schema_version: r.actionSchemaVersion ?? "v1",
      recommended_action_payload: r.recommendedActionPayload,
      expected_benefit: r.expectedBenefit ?? null,
      risk_level: r.riskLevel ?? "low",
      requires_approval: r.requiresApproval ?? true,
      rule_id: r.ruleId,
      expires_at: r.expiresAt ?? null,
      evidence: r.evidence.map((e) => ({
        metric_name: e.metricName,
        observed_value: e.observedValue,
        expected_value: e.expectedValue ?? null,
        source_entity_type: e.sourceEntityType ?? null,
        source_entity_id: e.sourceEntityId ?? null,
        calculation_definition: e.calculationDefinition,
        is_finance_sensitive: e.isFinanceSensitive ?? false,
      })),
    })),
  };
}

async function applyEvaluation(
  supabase: SupabaseDb,
  organizationId: string,
  locationId: string | null,
  asOf: Date,
  ruleVersion: string,
  intents: EvaluationIntents,
): Promise<ApplyEvaluationResult> {
  const { data, error } = await supabase.rpc("apply_ai_evaluation", {
    p_organization_id: organizationId,
    // p_location_id has no SQL default, so the generated type is a required
    // (non-nullable) string even though the column and the runtime value are
    // genuinely nullable — a real null is still sent over the wire.
    p_location_id: locationId as unknown as string,
    p_as_of: asOf.toISOString(),
    p_rule_version: ruleVersion,
    p_intents: toSnakeCaseIntents(intents, locationId) as unknown as Json,
  });

  if (error) throw toOperationalError(error);

  const result = data as unknown as {
    signals_upserted: number;
    signals_resolved: number;
    recommendations_upserted: number;
    recommendations_deferred: number;
    recommendations_expired: number;
    approvals_expired: number;
  };

  return {
    signalsUpserted: result.signals_upserted,
    signalsResolved: result.signals_resolved,
    recommendationsUpserted: result.recommendations_upserted,
    recommendationsDeferred: result.recommendations_deferred,
    recommendationsExpired: result.recommendations_expired,
    approvalsExpired: result.approvals_expired,
  };
}

/**
 * The full deterministic evaluation pipeline for one organization **at one
 * exact scope** (issue #18 "Deterministic evaluation process" + the exact
 * evaluation orchestration follow-up): gather facts (one RLS-safe RPC,
 * scoped to options.locationId exactly as apply_ai_evaluation() will
 * require) → run only the rules/skills whose declared scope matches
 * options.locationId (pure TypeScript, zero DB access) → validate the
 * combined output → apply it all in one transactional RPC call, which
 * itself rejects any intent whose own location_id contradicts this scope.
 *
 * This function evaluates ONE scope per call — either one specific location
 * (options.locationId set) or the organization-wide scope
 * (options.locationId omitted/null), never both. Most callers should use
 * evaluateOrganizationAcrossLocations() (lib/ai/orchestrate.ts) instead,
 * which calls this once per active location plus once for the
 * organization-wide scope, so every rule (whichever scope it declares)
 * actually runs somewhere. Calling this directly with no locationId only
 * evaluates 'organization'/'both'-scoped rules — 'location'-scoped rules
 * (most of the catalog) never fire without a location.
 *
 * If fact-gathering itself fails, this records an honest
 * "operational_provider_failure" signal (never a fabricated recommendation)
 * and re-throws — the caller decides how to surface that.
 */
export async function evaluateOrganization(
  supabase: SupabaseDb,
  organizationId: string,
  options?: { asOf?: Date; locationId?: string | null },
): Promise<ApplyEvaluationResult> {
  const asOf = options?.asOf ?? new Date();
  const locationId = options?.locationId ?? null;

  let facts: EvaluationFacts;
  try {
    const { data, error } = await supabase.rpc("get_ai_evaluation_facts", {
      p_organization_id: organizationId,
      p_as_of: asOf.toISOString(),
      p_location_id: locationId ?? undefined,
    });
    if (error) throw toOperationalError(error);
    facts = data as unknown as EvaluationFacts;
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : "Unknown error gathering AI evaluation facts";
    await applyEvaluation(supabase, organizationId, locationId, asOf, "provider-failure.v1", {
      signals: [
        {
          signalType: "operational_provider_failure",
          locationId: locationId ?? undefined,
          severity: "critical",
          title: "AI evaluation could not gather operational facts",
          facts: { message },
          dedupeKey: `operational_provider_failure:${locationId ?? "org"}`,
        },
      ],
      recommendations: [],
    });
    throw thrown;
  }

  const configs = await loadRuleConfigs(supabase, organizationId, locationId);

  const allSignals: SignalIntent[] = [];
  const allRecommendations: RecommendationIntent[] = [];

  for (const rule of RULE_REGISTRY) {
    if (!ruleAppliesToScope(rule.scope, locationId)) continue;

    const override = configs.get(rule.ruleKey);
    if (override && override.enabled === false) continue;

    const config = rule.configSchema.parse(override?.config ?? rule.defaultConfig);
    const result = rule.evaluate({ facts, config, organizationId, locationId, asOf });
    allSignals.push(...result.signals);
    allRecommendations.push(...result.recommendations);
  }

  // Local, inert skill layer (issue #18 decision #10) — same read-only
  // facts, no database access, output re-validated and merged into the same
  // apply_ai_evaluation() call as every built-in rule's output.
  allRecommendations.push(...runLocalSkills({ organizationId, locationId, asOf, facts }));

  const intents = evaluationIntentsSchema.parse({ signals: allSignals, recommendations: allRecommendations });

  return applyEvaluation(supabase, organizationId, locationId, asOf, EVALUATOR_VERSION, intents);
}

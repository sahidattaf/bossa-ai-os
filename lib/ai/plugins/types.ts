import type { EvaluationFacts, RuleScope } from "../rules/types";
import type { RecommendationIntent } from "../schemas";

/**
 * Typed boundary for the (separate, external) `hospitality-os-plugin`
 * repository's skills (issue #18 decision #10, and D-003 in
 * docs/MULTI_TENANT_HOSPITALITY_OS_ARCHITECTURE.md). Phase 4A implements
 * this boundary locally and inertly: no dynamic loading, no network calls,
 * no cross-repository runtime dependency. A future integration would
 * populate SKILL_REGISTRY (lib/ai/plugins/registry.ts) from real published
 * skills without changing this contract.
 */
export interface SkillManifest {
  id: string;
  version: string;
  displayName: string;
  description: string;
  supportedSignalTypes: readonly string[];
  supportedRecommendationTypes: readonly string[];
  /** Same meaning as RuleDefinition.scope — see lib/ai/rules/types.ts. */
  scope: RuleScope;
}

/**
 * Deliberately the same read-only shape the deterministic rule engine
 * receives, and nothing else — no Supabase client, no service-role
 * credentials, no way to reach the database or the action router. A skill
 * can only ever look at facts and return data.
 */
export interface SkillInput {
  organizationId: string;
  locationId: string | null;
  asOf: Date;
  facts: EvaluationFacts;
}

export interface SkillAdapter {
  manifest: SkillManifest;
  /** Returns proposed recommendations only — never executes anything, never mutates anything. Every returned item is re-validated against recommendationIntentSchema by the registry before it can reach apply_ai_evaluation(). */
  propose(input: SkillInput): RecommendationIntent[];
}

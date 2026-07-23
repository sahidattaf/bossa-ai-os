import { ruleAppliesToScope } from "../rules/types";
import { recommendationIntentSchema } from "../schemas";
import { vipReservationConciergeSkill } from "./skills/vip-reservation-concierge-skill";
import type { SkillAdapter, SkillInput } from "./types";

/**
 * The entire local, inert skill registry (issue #18 decision #10). Adding a
 * real hospitality-os-plugin integration in a future phase means populating
 * this array from that package instead — the contract (SkillAdapter,
 * SkillInput) does not change.
 */
export const SKILL_REGISTRY: readonly SkillAdapter[] = [vipReservationConciergeSkill];

/**
 * Runs every registered skill whose manifest.scope matches the evaluation
 * run's own scope (input.locationId), and re-validates each proposed
 * recommendation against the exact same schema apply_ai_evaluation()
 * expects. A skill's output can only ever become a *proposed*
 * recommendation — this function has no access to the action router, no
 * Supabase client, and calls nothing that could execute anything.
 */
export function runLocalSkills(input: SkillInput) {
  return SKILL_REGISTRY.filter((skill) => ruleAppliesToScope(skill.manifest.scope, input.locationId)).flatMap((skill) =>
    skill.propose(input).map((proposal) => recommendationIntentSchema.parse(proposal)),
  );
}

# Hospitality OS Plugin: Skill Adapter Boundary

How Phase 4A keeps the door open for the separate `hospitality-os-plugin` repository (reusable AI skills, prompts, agent playbooks — see the repository responsibilities table in the root `README.md`) without creating any actual cross-repository dependency in this phase. This is issue #18 decision #10, and corresponds to decision D-003 in `docs/MULTI_TENANT_HOSPITALITY_OS_ARCHITECTURE.md`.

---

## What's built vs. what's deferred

Phase 4A implements the skill boundary **locally and inertly**:

- No dynamic loading, no plugin discovery, no network calls, no `hospitality-os-plugin` package dependency anywhere in `package.json`.
- One local, checked-in reference skill (`vipReservationConciergeSkill`) proves the contract actually works end-to-end, rather than shipping an empty interface nobody has exercised.
- A future real integration — pulling skills from the `hospitality-os-plugin` repository at build or runtime — populates `SKILL_REGISTRY` from that package instead. The contract (`SkillAdapter`, `SkillInput`) is designed not to need to change for that to happen.

## The contract (`lib/ai/plugins/types.ts`)

```ts
interface SkillInput {
  organizationId: string;
  locationId: string | null;
  asOf: Date;
  facts: EvaluationFacts; // the exact same object get_ai_evaluation_facts() returns
}

interface SkillAdapter {
  manifest: SkillManifest; // id, version, displayName, description, supported signal/recommendation types
  propose(input: SkillInput): RecommendationIntent[];
}
```

Three properties make this a safe boundary for code Bossa doesn't control the release cycle of:

1. **Read-only input, deliberately the same shape the deterministic rule engine receives.** A skill gets `EvaluationFacts` — the same object every built-in rule in `lib/ai/rules/*.ts` reads — and nothing else. No Supabase client, no service-role credentials, no organization secrets, no way to reach the database, the action router, or any other tenant's data. A skill *cannot* look at anything beyond what it's handed.
2. **Output-only, and re-validated regardless of what the skill claims.** `propose()` returns proposed recommendations; it can never execute anything, mutate anything, or call back into the host application. `runLocalSkills()` (`lib/ai/plugins/registry.ts`) re-validates every single item a skill returns against `recommendationIntentSchema` — the exact schema `apply_ai_evaluation()` expects from a built-in rule — before it's allowed anywhere near the database. A misbehaving or malformed skill proposal is rejected the same way a malformed built-in rule proposal would be; there's no separate, more trusting path for plugin output.
3. **Merged into the same pipeline, not a side channel.** `evaluateOrganization()` calls `runLocalSkills(input)` and appends the result directly into the same `allRecommendations` array every built-in rule contributes to, before the combined set is validated and sent to `apply_ai_evaluation()` in one call. A skill-sourced recommendation is indistinguishable, from the database's perspective, from a rule-sourced one — same table, same approval/execution security model (`docs/AI_APPROVAL_AND_ACTION_SECURITY.md`), same dedupe/reopening behavior (`docs/AI_EXECUTIVE_ARCHITECTURE.md`).

## The reference skill: VIP Reservation Concierge

`lib/ai/plugins/skills/vip-reservation-concierge-skill.ts` flags any reservation tonight with `party_size >= 6` as a `vip_reservation_concierge` recommendation — `navigate`-type, `requiresApproval: false`, `severity: "info"`. It deliberately reuses the exact same `reservations_tonight` facts the built-in `reservation_capacity.v1` rule already sees (`docs/AI_RULES_AND_SIGNALS.md`), but derives a different kind of recommendation from them — a concierge/hospitality opportunity, not a capacity warning. This is the point of the reference implementation: proving a skill can add a genuinely distinct perspective on shared facts, not just duplicate a built-in rule under a different name. It uses only repository fixtures (the same seeded reservation data every other Phase 3/4 test uses) — no cross-repository dependency, no external call.

## Extending the registry

Adding a new local skill: implement `SkillAdapter`, add it to `SKILL_REGISTRY` (`lib/ai/plugins/registry.ts`), write unit tests under `tests/unit/ai/plugins/`. No migration, RLS, or grant changes are needed — a skill's output flows through the exact same `ai_recommendations`/`ai_recommendation_evidence` tables and `apply_ai_evaluation()` RPC every built-in rule already uses.

## What a future real integration would need to add

- A way to resolve which skills are enabled for a given organization (today, `SKILL_REGISTRY` runs unconditionally for every evaluation).
- A versioning/compatibility story for skills published from an independently-released package.
- Almost certainly a security review of anything beyond "pure function over read-only facts" — e.g., if a future skill ever needed network access or additional context, that would be a materially different trust boundary than what's built here and would need its own explicit decision, not a quiet expansion of `SkillInput`.

None of this exists yet, and none of it needs to for Phase 4A's scope: the reference skill and the registry mechanism prove the seam is real and working, without committing to answers Phase 4A wasn't asked to give.

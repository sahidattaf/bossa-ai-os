# AI Executive Architecture

The Phase 4A database model and evaluation pipeline behind the AI Executive workspace (`/[organizationSlug]/ai-executive`). For the rule/signal catalog, see `docs/AI_RULES_AND_SIGNALS.md`. For the approval/execution security model, see `docs/AI_APPROVAL_AND_ACTION_SECURITY.md`. For the local skill seam, see `docs/HOSPITALITY_PLUGIN_SKILL_ADAPTER.md`.

```text
Signals → Analysis → Recommendation → Approval → Action → Outcome → Memory
```

This phase ships every stage except long-term Memory (no learning loop yet — outcomes are recorded, not fed back into rule weighting).

---

## Why deterministic rules, not a model

Issue #18 scopes Phase 4A as "AI priorities generated from deterministic rules only" — the same constraint Phase 3's dashboard already operated under. There is no LLM call, no external AI service, and no non-deterministic behavior anywhere in the evaluation path: given the same facts and the same rule configuration, the same recommendations are produced every time. This is what "Deterministic mode" (the banner shown on every AI Executive page) means, and it's why every recommendation carries an `evidence` array traceable back to a real row, rather than free-text reasoning.

## Three-layer evaluation pipeline

Evaluation for one organization (`lib/ai/evaluate.ts::evaluateOrganization()`) runs in three distinct layers, each with a narrow, testable responsibility:

1. **Fact gathering** — `get_ai_evaluation_facts(p_organization_id, p_as_of, p_location_id)`, a single `SECURITY INVOKER`, `STABLE` RPC. Requires `ai.executive.read`. Issues a small, fixed number of aggregate queries (never N+1) and returns one `jsonb` object: `open_leads`, `reservations_tonight`, `recent_reservation_attrition`, `open_orders`, `latest_kpi_snapshot`, `today_kpi_snapshot`. Its lookback windows (30 days for open leads, 14 days for attrition, 3 days for open orders) are **generous performance bounds only** — they exist so the query stays bounded on a busy tenant, not because they encode a business threshold. Actual thresholds live one layer up, in rule config.
2. **Rule evaluation** — nine pure TypeScript functions (`lib/ai/rules/*.ts`), each a `RuleDefinition<TConfig>`: a Zod `configSchema`, a `defaultConfig`, and an `evaluate(context)` function that reads only the facts object and returns `{ signals, recommendations }`. Zero database access, fully unit-testable without a database at all — see `docs/AI_RULES_AND_SIGNALS.md` for the full catalog. `lib/ai/plugins/registry.ts::runLocalSkills()` runs alongside the built-in rules at this layer, on the same facts, contributing to the same combined output.
3. **Transactional apply** — `apply_ai_evaluation(p_organization_id, p_location_id, p_as_of, p_rule_version, p_intents)`, one `SECURITY DEFINER` RPC that takes the combined, Zod-validated output of every rule and skill for this run and applies it atomically: upserts signals, resolves stale signals, upserts recommendations (with reopening logic — see below), upserts evidence, expires anything obsolete, and writes one audit event. Nothing about "did this run change anything" is ever computed by re-querying afterward from TypeScript; the function's return value (`signals_upserted`, `signals_resolved`, `recommendations_upserted`, `recommendations_expired`, `approvals_expired`) is authoritative.

This split exists so the actual decision logic (layer 2) can be reviewed, tested, and reasoned about by reading plain TypeScript — no SQL, no database round trip — while both database-facing edges (layers 1 and 3) stay thin, auditable, and RLS/permission-checked independently of the rules that call them.

## Signals vs. recommendations vs. evidence

- **A signal** (`ai_signals`) is a continuously re-evaluated gauge, not a discrete event. The same `dedupe_key` always upserts the same row (`unique (organization_id, dedupe_key)`), flipping `status` between `active`/`resolved`/`suppressed` across evaluation runs rather than accumulating a new row every time a rule re-fires. "3 unanswered leads" today and "5 unanswered leads" tomorrow are the same signal row with different `facts`, not two rows.
- **A recommendation** (`ai_recommendations`) is a discrete, actionable proposal: a title, an executive summary, a severity, a `priority_score`, and — if `requires_approval` — something concrete to approve. Recommendations use a *partial* unique index (`(organization_id, dedupe_key) where status in ('proposed','approved','executing')`), not a plain one: a recommendation can legitimately recur once its predecessor has resolved (`completed`/`failed`/`rejected`/`expired`/`dismissed`), but never duplicate while one is still open.
- **Evidence** (`ai_recommendation_evidence`) is the traceable justification behind a recommendation: one row per named metric, an `observed_value`, an optional `expected_value`, a human-readable `calculation_definition`, and an `is_finance_sensitive` flag (see redaction below). `unique(recommendation_id, metric_name)` lets a re-evaluation safely upsert evidence in place rather than delete-then-insert.

## Server-controlled payload hashing

`ai_recommendations.payload_hash` is a `generated always as (...) stored` column — Postgres itself computes it from `id | organization_id | recommended_action_type | action_schema_version | recommended_action_payload::text` via `digest(..., 'sha256')`, and no client (nor any application code) can ever supply or override it. This is the tamper-evident anchor for the entire approval→execution flow: `approve_ai_recommendation()` snapshots it into `ai_approvals.payload_hash_at_decision`, and `begin_ai_recommendation_execution()` refuses to start if the recommendation's *live* `payload_hash` no longer matches what was actually approved. Hashing the id and action type alongside the payload (not the payload alone) means a byte-identical payload can never be replayed against a different recommendation or action type. See `docs/AI_APPROVAL_AND_ACTION_SECURITY.md` for the full approval lifecycle.

## Reopening: what happens when an approved recommendation's facts change

A gap in the original design, found by tracing the pgTAP suite by hand rather than by a failing test run (no local Docker — see `docs/SUPABASE_OPERATIONS.md`): before this fix, there was no path back from `approved` once a recommendation's underlying facts changed. If a rule re-fired with a materially different payload for an already-`approved` recommendation, `apply_ai_evaluation()`'s upsert would silently overwrite the payload underneath a decision a human had already made — the approval would point at a payload that was never actually reviewed.

Fixed properly, not worked around: `apply_ai_evaluation()` now captures the pre-upsert `status`/`payload_hash`, compares them to the post-upsert `payload_hash`, and if an `approved` recommendation's payload actually changed, resets it to `proposed` and its approval back to `pending` (`version` incremented, `payload_hash_at_decision`/`decided_by_user_id`/`decided_at` cleared). Two new status-transition rows make this legal at the database level: `recommendation_status: approved → proposed` and `approval_status: approved → pending`. A previously-approved-but-now-stale recommendation must be reviewed again before it can execute — it is structurally impossible for a client to approve once and have that approval silently carry over new facts.

## Polymorphic evidence and signal source references

`ai_signals.source_entity_type`/`source_entity_id` and `ai_recommendation_evidence.source_entity_type`/`source_entity_id` can point at any of five domain tables (`lead`, `reservation`, `order`, `order_item`, `daily_kpi_snapshot`) — no single foreign key can express "one of five possible tables." `validate_ai_source_entity_reference()` (one generic `BEFORE INSERT/UPDATE` trigger function, attached to both tables) reads the row generically via `to_jsonb(new)`, looks up the referenced row in whichever table `source_entity_type` names, and checks both existence and organization match (and, where the target type carries one, location match) — raising `RELATED_ENTITY_MISMATCH` on a cross-tenant or nonexistent reference. This is the same "schema-level impossibility" property Phase 3's composite FKs give single-table references, extended to a polymorphic one via a trigger instead of a constraint.

## Database model summary

Seven tables, all `organization_id`-scoped, migrations `20260723000001`–`20260723000009`:

| Table | Role | Directly writable by `authenticated`? |
| --- | --- | --- |
| `ai_rule_configs` | Tenant-scoped threshold overrides | Yes — the one table with direct INSERT/UPDATE grants |
| `ai_signals` | Continuously re-evaluated gauges | No — only via `apply_ai_evaluation()` |
| `ai_recommendations` | Discrete actionable proposals | No — only via the approval/execution functions below |
| `ai_recommendation_evidence` | Traceable per-metric justification | No — only via `apply_ai_evaluation()` |
| `ai_approvals` | One decision row per recommendation | No — only via `approve_ai_recommendation()`/`reject_ai_recommendation()` |
| `ai_action_attempts` | Append-only execution history | No — only via `record_ai_action_attempt()` |
| `ai_outcomes` | Measured result of an executed action | No — only via `record_ai_outcome()` |

Full column-level detail lives in the migrations themselves (`supabase/migrations/20260723000001_ai_tables.sql`); this table is a map of *who can write what*, not a schema reference.

## Dashboard integration

`lib/dashboard/supabase-provider.ts` sources `aiPriorities` (top 5 open recommendations by `priority_score`), `liveAlerts` (active warning/critical signals), and `approvalQueue` (pending approvals joined in-memory to their recommendations) from these tables — replacing the ad-hoc derivations Phase 3 computed directly from operational data. `DashboardData`'s shape is unchanged; only where these three fields come from changed.

## What Phase 4A deliberately does not build

- No scheduler. `scripts/evaluate-ai-executive.ts` (`npm run ai:evaluate -- --org=<slug> --as-of=<iso>`) is the same manual-CLI-invocation pattern Phase 3's `generate-kpi-snapshots.ts` established — no Vercel Cron or Supabase scheduled job is enabled.
- No memory/learning loop. Outcomes are recorded (`ai_outcomes`) for human review and future analysis, but nothing currently feeds them back into rule weighting or priority scoring.
- No non-deterministic or model-backed recommendation source. The local skill seam (`docs/HOSPITALITY_PLUGIN_SKILL_ADAPTER.md`) is inert and fixture-based in this phase — a real `hospitality-os-plugin` integration is future work, not part of Phase 4A.

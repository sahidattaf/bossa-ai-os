# AI Rules and Signals

The nine deterministic rule families the evaluation pipeline runs (`lib/ai/rules/rule-registry.ts::RULE_REGISTRY`), plus the one synthetic signal the pipeline itself generates when fact-gathering fails. See `docs/AI_EXECUTIVE_ARCHITECTURE.md` for how rules fit into the overall evaluation pipeline.

Every rule is a pure function: `evaluate({ facts, config, organizationId, locationId, asOf }) => { signals, recommendations }`. No rule ever touches the database directly — all of it reads from the one `EvaluationFacts` object `get_ai_evaluation_facts()` returns, and nothing else. Each has a Zod `configSchema` with sensible defaults; an organization can override any rule's config (or disable it outright) via a row in `ai_rule_configs`.

---

## Rule catalog

| Rule key | Fires when | Signal severity | Recommendation? | Action type |
| --- | --- | --- | --- | --- |
| `unanswered_leads.v1` | count of `status = 'new'` leads exceeds `maxUnanswered` (default 3; critical at 2×) | warning / critical | Only if `defaultOwnerUserId` is configured | `assign_lead_owner` (requires approval) |
| `aging_leads.v1` | an unowned lead has been open longer than `maxAgeHours` (default 24) | warning | Only if `defaultOwnerUserId` is configured | `assign_lead_owner` (requires approval) |
| `reservation_capacity.v1` | tonight's booked covers reach `warningPercentage` (default 90%) of `capacity` (default 80); critical at ≥100% | warning / critical | Always | `navigate` (no approval) |
| `reservation_attrition.v1` | cancellations + no-shows in the last 14 days exceed `maxRecentCancellations` (default 3) | warning | Always | `navigate` (no approval) |
| `stalled_orders.v1` | an order is `payment_status = 'unpaid'` longer than `maxUnpaidAgeHours` (default 24) | warning | Always (up to 5 at a time) | `navigate` (no approval), finance-sensitive evidence — never auto-marks paid |
| `delayed_orders.v1` | an order has sat in `preparing` past `maxPreparingMinutes` (default 30) or `ready` past `maxReadyMinutes` (default 15) | warning | Always (up to 5 at a time) | `navigate` (no approval) |
| `revenue_target.v1` | today's `daily_kpi_snapshots.revenue` is below `dailyTarget` (default 500) | info | Always | `navigate` (no approval), finance-sensitive evidence |
| `average_ticket.v1` | today's `average_ticket` is below `targetAverageTicket` (default 25) | info | Always | `navigate` (no approval), finance-sensitive evidence |
| `kpi_staleness.v1` | the latest KPI snapshot is more than `maxStaleDays` (default 2) old, or none exists | warning | Always | `regenerate_kpi_snapshot` (requires approval) |

A tenth signal, `operational_provider_failure`, is not a rule at all — `lib/ai/evaluate.ts::evaluateOrganization()` synthesizes it directly (severity `critical`, `rule_version: "provider-failure.v1"`) when `get_ai_evaluation_facts()` itself throws, then re-throws so the caller can surface a real error. This is a deliberate honesty guarantee: a facts-gathering failure is recorded as a visible signal, never silently swallowed or papered over with a fabricated recommendation.

## Why some rules never propose an action, only `navigate`

`stalled_orders.v1` and `delayed_orders.v1` are structurally incapable of mutating payment or fulfillment state, by design: a rule only sees the last-known database facts, not real-world confirmation that a payment actually arrived or that a kitchen ticket actually moved. Auto-marking an order paid or advancing its status based on staleness alone would be encoding a guess as a fact. Every recommendation these two rules propose is `recommendedActionType: "navigate"` with `requiresApproval: false` — the "approval" for a pure navigation link is trivial, since executing it never mutates anything (the action router refuses to execute `navigate` recommendations at all; see `docs/AI_APPROVAL_AND_ACTION_SECURITY.md`).

## Why some rules are conditionally silent on recommendations

`unanswered_leads.v1` and `aging_leads.v1` both propose an `assign_lead_owner` recommendation *only* when the organization has configured a `defaultOwnerUserId` in `ai_rule_configs`. Without one, the rule still fires its signal (so the condition is visible on the dashboard and in the priority feed) but proposes no recommendation — there is no default owner to assign, and guessing one would be worse than surfacing nothing. This is the same "recommend only what's actually actionable" principle as the `navigate`-only rules above, applied to a different failure mode (missing configuration rather than missing certainty).

## Finance-sensitive evidence

`revenue_target.v1`, `average_ticket.v1`, and `stalled_orders.v1` mark their evidence `isFinanceSensitive: true`. This flag isn't cosmetic — `ai_recommendation_evidence`'s RLS SELECT policy adds `AND (NOT is_finance_sensitive OR has_permission(organization_id, 'finance.read'))`, so a caller who holds `ai.executive.read` but not `finance.read` sees the recommendation itself (title, summary, severity) but not the specific revenue/average-ticket/order-total numbers backing it. The redaction happens at the RLS layer, not in application code — `components/ai/evidence-panel.tsx` renders whatever rows RLS actually returned and does not re-implement the check.

**A standing rule-authoring constraint, not just a one-time fix:** RLS redaction only ever applies to `ai_recommendation_evidence` rows marked `isFinanceSensitive: true` — it does *not* apply to `ai_signals.facts`, or to any other field on `ai_recommendations` itself (`title`, `executive_summary`, `recommended_action_payload`, `expected_benefit`). A Phase 4B security review found exactly this gap: `revenue_target.v1` and `average_ticket.v1` put the raw dollar figure directly into their signal's `facts`, and `stalled_orders.v1` additionally interpolated the order total straight into its recommendation's `executive_summary` — both fully visible to any `ai.executive.read` holder regardless of `finance.read`. Fixed by removing every raw amount from non-evidence fields; the only place a finance-sensitive number may ever appear is inside an evidence row with `isFinanceSensitive: true`. Any new rule touching money must follow the same discipline — unit tests for all three rules now assert the figure never appears in `signals[].facts`, `title`, `executiveSummary`, or `recommendedActionPayload`.

## Dedupe keys, briefly

Every signal and recommendation carries a `dedupeKey` used as the upsert conflict target inside `apply_ai_evaluation()`. Two shapes recur across the catalog:

- **Per-entity** (`unpaid_order:${order.id}`, `aging_lead:${lead.id}`, `delayed_order:${order.id}`): one row per concrete entity, independent of when the evaluation ran.
- **Per-org/location/day** (`revenue_below_target:${locationId ?? "org"}:${dateKey}`, `reservation_capacity:${locationId ?? "org"}:${dateKey}`): one row per tenant-scoped condition per day, so "today's revenue is low" doesn't accumulate a new recommendation on every evaluation run within the same day, but a genuinely new day starts a fresh one.

## Local skill seam

`lib/ai/plugins/registry.ts::runLocalSkills()` runs alongside the rule registry, on the same `EvaluationFacts`, contributing recommendations into the exact same `apply_ai_evaluation()` call — see `docs/HOSPITALITY_PLUGIN_SKILL_ADAPTER.md` for the skill boundary and the one reference skill shipped in this phase (`vipReservationConciergeSkill`).

## Extending the catalog

Adding a tenth rule requires: a new `lib/ai/rules/<name>.ts` exporting a `RuleDefinition` via `defineRule()`, one line registering it in `RULE_REGISTRY`, and unit tests under `tests/unit/ai/rules/<name>.test.ts`. No migration, RLS policy, or grant changes are needed — a new rule's signals/recommendations flow through the same `ai_signals`/`ai_recommendations` tables and the same `apply_ai_evaluation()` RPC every existing rule already uses.

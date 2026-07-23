# Phase 4 Implementation Report — AI Executive MVP

**Branch:** `feat/phase-4-ai-executive-mvp` · **Issue:** #18 · **Follows:** Phase 3 (PR merged)

## Scope

Turn the deterministic-rules-only priority feed Phase 3's dashboard already sketched into a real AI Executive workspace: `Signals → Analysis → Recommendation → Approval → Action → Outcome`. Facts are gathered from the same operational tables Phase 3 built (`leads`, `reservations`, `orders`, `daily_kpi_snapshots`); nine deterministic rules turn them into signals and recommendations; a human approves or rejects; approved, guarded actions execute through the *existing* `lib/operations/*` write paths; outcomes are recorded honestly, success or failure. No LLM, no external AI service, no scheduler — see `docs/AI_EXECUTIVE_ARCHITECTURE.md` for the full architecture and rationale.

## Database architecture

Seven new tables, all `organization_id`-scoped: `ai_rule_configs`, `ai_signals`, `ai_recommendations`, `ai_recommendation_evidence`, `ai_approvals`, `ai_action_attempts`, `ai_outcomes`. Full schema reference in `docs/AI_EXECUTIVE_ARCHITECTURE.md`. Nine migrations, applied in order:

| File | Contents |
| --- | --- |
| `20260723000001_ai_tables.sql` | The seven tables — composite FKs for tenant-scoped cross-references, `ai_recommendations.payload_hash` as a `GENERATED ALWAYS` sha256 column, the partial unique index on open recommendations |
| `20260723000002_ai_source_entity_validation.sql` | `validate_ai_source_entity_reference()` — one generic polymorphic-reference trigger, attached to both `ai_signals` and `ai_recommendation_evidence` |
| `20260723000003_ai_status_machines.sql` | Two new `status_transitions` machines (`recommendation_status`, `approval_status`), reusing Phase 3's `enforce_status_transition()`/`audit_status_transition()` triggers verbatim |
| `20260723000004_ai_permissions_catalog.sql` | Two new permission keys (`ai.executive.read`, `ai.recommendations.manage`) added to Phase 2's existing catalog |
| `20260723000005_ai_rls_policies.sql` | RLS enabled + forced on all seven tables, including the finance-evidence redaction clause on `ai_recommendation_evidence` |
| `20260723000006_ai_table_grants.sql` | Base `GRANT`s to `authenticated` — SELECT everywhere, INSERT/UPDATE only on `ai_rule_configs` |
| `20260723000007_ai_approval_functions.sql` | Six `SECURITY DEFINER` functions: `approve_ai_recommendation`, `reject_ai_recommendation`, `dismiss_ai_recommendation`, `begin_ai_recommendation_execution`, `record_ai_action_attempt`, `record_ai_outcome` |
| `20260723000008_ai_evaluation_facts_rpc.sql` | `get_ai_evaluation_facts()` — the one `SECURITY INVOKER` fact-gathering RPC |
| `20260723000009_apply_ai_evaluation.sql` | `apply_ai_evaluation()` — the one transactional apply RPC, including reopening logic |

Three further Phase 4B migrations (post-merge security hardening, see below): `20260724000001_ai_execution_concurrency.sql` (atomic approve/reject/dismiss/execute, execution-claim columns, duplicate-success index, crash recovery), `20260724000002_ai_source_entity_location_validation.sql` (complete same-location checks for `lead`/`order_item`), `20260724000003_ai_evaluation_scope_and_immutability.sql` (exact evaluation scope, executing-recommendation immutability).

## Architecture decisions (locked before implementation)

1. **Canonical routes.** `/[organizationSlug]/ai-executive` (priority feed), `/ai-executive/approvals` (approval queue), `/ai-executive/recommendations/[id]` (detail + evidence + decision).
2. **Approval writes are function-mediated, not RLS-INSERT-permitted.** No `authenticated` INSERT/UPDATE grant exists on `ai_approvals` or `ai_recommendations` at all — every transition happens through a `SECURITY DEFINER` function.
3. **Approval and execution are two distinct durable operations**, not one collapsed state change — see `docs/AI_APPROVAL_AND_ACTION_SECURITY.md`.
4. **Evaluation applies transactionally through one RPC** (`apply_ai_evaluation`) — never a sequence of independent client-side writes that could partially apply.
5. **Payload hashes are server-controlled** — a `GENERATED ALWAYS AS (...) STORED` column, never client-suppliable, anchoring the entire tamper-detection chain.
6. **Polymorphic evidence/signal references are validated by one generic trigger function**, not five separate per-type triggers.
7. **Every `SECURITY DEFINER` function is hardened uniformly**: pinned `search_path`, revoke-all-then-grant-to-authenticated, actor from `auth.uid()`, tenant resolved from the row itself.
8. **The action router allow-list is exact and compile-time exhaustive**: `assign_lead_owner, change_lead_status, confirm_reservation, cancel_reservation, change_order_status, change_order_payment_status, regenerate_kpi_snapshot, navigate`.
9. **`ai_action_attempts` is append-only**, mirroring `audit_logs`'s immutability guarantee.
10. **The Hospitality OS plugin seam is implemented locally and inertly** — no real cross-repository dependency this phase. See `docs/HOSPITALITY_PLUGIN_SKILL_ADAPTER.md`.
11. **Mock mode stays a read-only, explicitly labeled demo** — static fixtures, no approve/execute controls, and the recommendation-detail route 404s (mirroring Phase 3's order-detail precedent).
12. **CI delivery gate**: open the PR as **draft** first; watch CI to green without weakening any Phase 1–3 assertion, RLS policy, money-integrity guarantee, status machine, audit guarantee, or tenant isolation.

## Deterministic evaluation pipeline

Three layers, each independently testable — see `docs/AI_EXECUTIVE_ARCHITECTURE.md` for the full design:

1. **Fact gathering** — `get_ai_evaluation_facts()`, one `SECURITY INVOKER` RPC, a small fixed number of aggregate queries.
2. **Rule evaluation** — nine pure TypeScript rule modules (`lib/ai/rules/*.ts`) plus the local skill registry (`lib/ai/plugins/registry.ts`), zero database access. Full catalog in `docs/AI_RULES_AND_SIGNALS.md`.
3. **Transactional apply** — `apply_ai_evaluation()`, one `SECURITY DEFINER` RPC applying the combined, Zod-validated output atomically.

`scripts/evaluate-ai-executive.ts` (`npm run ai:evaluate -- --org=<slug> --as-of=<iso>`) is the manual CLI entry point, following the same pattern as Phase 3's `generate-kpi-snapshots.ts` — no scheduler is enabled.

## Approval and guarded-action security

Full detail in `docs/AI_APPROVAL_AND_ACTION_SECURITY.md`. Highlights: the guarded action router (`lib/ai/action-router.ts`) is exhaustive over the eight-action allow-list at the type level; every action module wraps an *existing* `lib/operations/*` function rather than introducing a new mutation path; `begin_ai_recommendation_execution()` re-verifies `ai.actions.approve` and the approval's snapshotted `payload_hash_at_decision` against the recommendation's *live* `payload_hash` before anything executes; retry-safety comes from the status machine itself (`completed` is terminal, `failed → executing` is a legal retry origin), not a separate lookup.

## A design gap found and fixed during implementation: reopening

Traced by hand (no live database in this sandbox — see "Validation results" below), not caught by a failing test run: the original design had no path back from `approved` once a recommendation's underlying facts changed materially. Fixed properly, not worked around — `apply_ai_evaluation()` now compares a recommendation's pre- and post-upsert `payload_hash`, and if an `approved` recommendation's payload actually changed, resets it to `proposed` and its approval to `pending` (`version` incremented, decision fields cleared). Two new status-transition rows make this legal (`approved → proposed`, `approved → pending`). Full reasoning in `docs/AI_EXECUTIVE_ARCHITECTURE.md`'s "Reopening" section.

## Dashboard integration

`lib/dashboard/supabase-provider.ts`'s `aiPriorities`, `liveAlerts`, and `approvalQueue` now source from `ai_recommendations`/`ai_signals`/`ai_approvals` instead of being derived ad hoc from operational tables directly. `DashboardData`'s shape is unchanged, per decision #1's route scope.

## Application routes and components

`/[organizationSlug]/ai-executive`, `/ai-executive/approvals`, `/ai-executive/recommendations/[id]` — permission-gated (`ai.executive.read` to view, `ai.actions.approve` to decide, `ai.recommendations.manage` to dismiss), deterministic-mode banner on every page, mock-mode read-only notice with static fixtures (`lib/ai/mock-fixtures.ts`) and no approve/execute controls rendered. New components: `components/ai/{severity-badge,recommendation-card,evidence-panel,approval-actions,dismiss-button}.tsx`.

## Hospitality OS plugin seam

One reference skill, `vipReservationConciergeSkill`, proves the boundary end-to-end using only repository fixtures — no cross-repository dependency. Full design in `docs/HOSPITALITY_PLUGIN_SKILL_ADAPTER.md`.

## Cross-tenant security results

40 pgTAP assertions in `supabase/tests/ai_executive_security.test.sql` (tenant/permission-scoped visibility, finance-evidence redaction, function-mediated writes on six of seven tables, the full approve → reopen-on-tamper → re-approve → execute → outcome happy path, optimistic-concurrency single-use approvals, append-only action attempts) plus 10 integration tests in `tests/integration/ai-executive.test.ts` (deterministic evaluation isolation, tenant-switch isolation, evidence linking, full approve+execute with real domain-effect verification, duplicate-approval rejection, tamper/reopening detection, honest failure recording, unauthorized-approval rejection, provider-failure surfacing) and 9 new Playwright specs in `tests/e2e/ai-executive.spec.ts` (mock-mode read-only demo, tenant isolation, no detail links, approval-queue absent, recommendation detail 404s, no approve/reject controls rendered). Full reasoning in `docs/AI_APPROVAL_AND_ACTION_SECURITY.md`.

## Validation results

Local (no Docker in this sandbox — the database-specific steps below only run in CI, see `docs/SUPABASE_OPERATIONS.md`):

```text
npm run lint         → clean
npm run typecheck    → clean (strict mode)
npm run test          → 19 files, 75 tests passed (11 new AI files, 8 from Phase 1-3)
npm run test:e2e      → 44 specs, 41 passed / 3 mobile-only-skip, including 9 new AI Executive specs
npm run build          → succeeds
```

`npm run test:integration` and `supabase test db` (the new 40-assertion pgTAP file) could not be run locally — both need a live Postgres instance via `supabase start`, unavailable without Docker in this sandbox. `tests/integration/ai-executive.test.ts` was confirmed to collect and fail identically to the pre-existing Phase 3 integration suites (`fetch failed` at sign-in against no live Supabase instance) before pushing — a structural confirmation the file itself had no import-time or type errors, not a substitute for actually running it.

Manually smoke-tested via `npm run dev` (mock mode): `/bossa/ai-executive`, `/bossa/ai-executive/approvals`, and `/papai/ai-executive` all render correctly with the deterministic-mode banner, the "Demo mode — read-only" notice, and correct tenant-isolated fixtures (BOSSA's "Maria F." never appears on Papai's page or vice versa); `/bossa/ai-executive/recommendations/mock-rec-bossa-1` correctly 404s. No console or server errors.

**CI — real run, all green:** [PR #19](https://github.com/sahidattaf/bossa-ai-os/pull/19), after 6 fix-forward iterations against real infrastructure (see "Bugs found by CI" below):

```text
validate: lint, typecheck, unit test (19 files/75 tests), build         → PASS
database job:
  supabase start (Docker, real local stack)                              → boots clean
  supabase db reset (all migrations + seed.sql)                          → applies clean from empty
  supabase test db (pgTAP: rls_cross_tenant + operational_security + ai_executive_security) → PASS — 96/96 (29 + 27 + 40)
  regenerate lib/supabase/database.types.ts + re-typecheck                → clean against the real schema
  git diff --exit-code -- lib/supabase/database.types.ts                 → zero drift (hard failure, passing)
  npm run test:integration (4 files, including ai-executive.test.ts)      → PASS
  supabase stop                                                          → clean shutdown
e2e job: Playwright                                                      → PASS — 44 specs (41 run, 3 platform-skipped)
```

## Bugs found by CI (each fixed as its own commit, in order)

1. **`audit_ai_rule_config_change()` called `record_audit_event()` unconditionally.** Unlike every other audit path in this schema (`apply_ai_evaluation()`, `calculate_daily_kpi_snapshot()`), the one trigger added for `ai_rule_configs` had no `auth.uid() is not null` guard — `record_audit_event()`'s own "caller must belong to this organization" check rejected the null actor in seed.sql's raw psql context, breaking seeding before a single AI migration test could run. Fixed by adding the same guard every other trusted-service-context write in this project already uses.
2. **An unpaired `source_entity_type` in a seeded evidence row.** `ai_recommendation_evidence`'s `check((source_entity_type is null) = (source_entity_id is null))` rejected the `revenue_below_target` fixture's evidence, which set `source_entity_type` without a matching `source_entity_id` (no literal UUID was available for the seed-generated snapshot row). Fixed by dropping the unpaired field from the fixture.
3. **Three pgTAP test bugs**, none in the schema itself: (a) a dedupe_key `LIKE` pattern in the finance-redaction assertions didn't match what the hand-authored seed fixture actually inserts; (b) two cross-tenant assertions resolved the target row via a live subquery evaluated *while authenticated as the tenant that shouldn't see it* — RLS filtered it to zero rows, so the uuid cast failed with the wrong kind of error rather than the `PERMISSION_DENIED` being asserted (fixed by capturing both ids into a temp table before the first `authenticate_as()` call, since — unlike Phase 3's fixed literal seed UUIDs — `ai_approvals`/`ai_recommendations` rows are `gen_random_uuid()`'d, not literal); (c) a reopening-test call reused the seed's own `rule_version` while only re-sending one of BOSSA's two recommendations, and `apply_ai_evaluation()`'s rule-version-scoped expiry step treated the *other* seeded recommendation as stale and expired it — fixed by giving that test its own `rule_version`, the same isolation the idempotency tests already used.
4. **A second, unrelated `navigate`-type recommendation created by an idempotency test** (test 14) made a later assertion's `... and recommended_action_type = 'navigate' limit 1` query non-deterministic once that probe recommendation was expired by a subsequent test — it could resolve to either row depending on physical row order. Fixed by reusing the same captured-id temp table instead of a fresh, ambiguous query.
5. **Hand-authored `database.types.ts` drift** once pgTAP and seeding both passed: `Relationships` array ordering on two tables, two `isOneToOne` flags, a 63-char-truncated FK constraint name, `payload_hash` needing to be nullable/optional (it's a `GENERATED` column, same precedent as Phase 3's `order_items.line_total`), and Args formatting. Resolved by committing the real regenerated artifact directly, never hand-patching around it — the same resolution Phase 3 used for its own whole-file drift.
6. **`apply_ai_evaluation`'s `p_location_id` generated as a required, non-nullable `string`** (no SQL default exists for it, so the generator doesn't account for its actual nullability) — a narrower version of the exact generator quirk Phase 3 hit with `calculate_daily_kpi_snapshot`'s optional `p_location_id`. Fixed with a documented type-only cast at both call sites, since neither `null` nor `undefined` satisfies the generated type.

## Risks and decisions

1. **`ai_rule_configs` has no nullable-organization "platform default" row.** Secure per-rule defaults live in `lib/ai/rules/*.ts`'s `defaultConfig`, keeping RLS uniform across all seven tables rather than introducing a special-cased global-config row.
2. **`stalled_orders.v1` / `delayed_orders.v1` only ever propose `navigate`, never an auto-mutation.** A rule cannot safely infer that a payment actually arrived or a kitchen ticket actually moved from staleness alone — documented explicitly in `docs/AI_RULES_AND_SIGNALS.md` as a deliberate scope limit.
3. **`unanswered_leads.v1` / `aging_leads.v1` propose no recommendation without a configured `defaultOwnerUserId`** — the signal still fires, but assigning a guessed owner would be worse than surfacing nothing.
4. **No learning/memory loop.** `ai_outcomes` records results for human review; nothing feeds them back into rule weighting yet. Explicitly out of scope for Phase 4A.
5. **Playwright coverage of AI Executive is entirely mock-mode, negative-assertion-heavy** (no approve/execute controls, no detail links, 404 on detail routes) — the same trade-off Phase 3 made for lead conversion, since the `e2e` CI job runs against `next start` with no live Supabase. True approve→execute round-trips are exercised by the integration suite against a real database instead.

## Phase 4B: post-merge security hardening

A principal-engineer security review of PR #19 (after Phase 4A's CI was fully green) found five categories of merge-blocking defects — all genuine gaps in the original design, not test bugs. Fixed forward with four new migrations (`20260724000001`–`20260724000004`), without weakening any Phase 4A assertion. Full design in `docs/AI_APPROVAL_AND_ACTION_SECURITY.md` and `docs/AI_EXECUTIVE_ARCHITECTURE.md`.

1. **Non-atomic decisions.** `approve_ai_recommendation()`, `reject_ai_recommendation()`, and (found during the fix, not named by the review — the identical defect) `dismiss_ai_recommendation()` each read status/version in one statement and updated a *different* statement later, keyed only by `id` — two concurrent decisions could both believe they'd won. Fixed by folding every precondition into the single deciding `UPDATE ... WHERE ...`, relying on Postgres's default READ COMMITTED isolation to guarantee at most one of two racing statements matches. A diagnostic-only re-read after a failed CAS preserves precise error messages (`INVALID_STATUS_TRANSITION` vs. version-mismatch `CONFLICT` vs. expired) without reintroducing the race.
2. **Non-atomic execution claim.** `begin_ai_recommendation_execution()`'s `approved`/`failed → executing` transition had the same defect. Fixed the same way, and extended with a genuine execution-claim contract: `ai_recommendations.execution_token` (minted fresh, atomically, by the winning claim), `executing_at`, and `execution_attempt_number`.
3. **Unguarded finalization.** `record_ai_action_attempt()`/`record_ai_outcome()` required only that the recommendation be `executing` (or, for outcomes, nothing at all) — nothing tied a finalize call to the specific claim that produced it. Fixed by requiring the exact current `execution_token` (for outcomes, the token stamped on the `ai_action_attempts` row itself, since the recommendation has typically already moved past `executing` by the time an outcome is recorded).
4. **No duplicate-success backstop.** Added `idx_ai_action_attempts_success_once`, a partial unique index on `(recommendation_id, payload_hash) WHERE result_status = 'succeeded'` — a database-level guarantee beyond the token CAS that at most one successful attempt can ever exist per recommendation/payload.
5. **No crash-recovery path.** A process crashing between claiming execution and finalizing it left a recommendation stuck `executing` forever. Added `recover_stalled_ai_execution()` — requires `ai.recommendations.manage` (not the broader `ai.actions.approve`) and an execution older than `ai_execution_lease_duration()` (15 minutes), atomically resets to `failed` and invalidates the token, and is audited (`ai_recommendation.execution_recovered`) without ever touching `ai_action_attempts` history.
6. **Executing recommendations weren't immutable.** `apply_ai_evaluation()`'s upsert could overwrite an `executing` row's payload/evidence/approval relationship out from under an in-flight execution. Fixed by pre-checking the existing row's status and, if `executing`, redirecting the new intent to a separate `<dedupe_key>:pending-reevaluation` recommendation instead (chosen behavior — a documented alternative to deferring the intent until the active execution finishes) — the executing row is left completely untouched, and the changed intent is never lost.
7. **Evaluation scope wasn't exact.** Stale-signal-resolution and obsolete-recommendation-expiry predicates used `p_location_id is null or location_id = p_location_id or location_id is null` — a location-specific run could resolve/expire organization-wide or sibling-location rows. Fixed by replacing every such predicate with NULL-safe exact equality (`location_id is not distinct from p_location_id`), applied to stale-signal resolution, obsolete-recommendation expiry, and approval expiry (via a join to the recommendation's own location).
8. **Incomplete location validation.** `validate_ai_source_entity_reference()` never populated a source location for `lead` or `order_item` at all, so the location-mismatch branch could never fire for either type (only `reservation`, `order`, and `daily_kpi_snapshot` were actually checked). Fixed by resolving `lead.location_id` directly and `order_item`'s location via a join to its parent `order`.
9. **Finance-sensitive values leaking outside evidence.** RLS redaction only ever covers `ai_recommendation_evidence` rows marked `isFinanceSensitive: true` — `revenue_target.v1`/`average_ticket.v1` put the raw figure directly into their signal's `facts` (which RLS never redacts), and `stalled_orders.v1` additionally interpolated the order total straight into its recommendation's `executive_summary`. Fixed by removing every raw amount from any field outside an evidence row; documented as a standing rule-authoring constraint in `docs/AI_RULES_AND_SIGNALS.md`.

**New test coverage:** 27 new pgTAP assertions in `supabase/tests/ai_executive_concurrency.test.sql` (location validation, exact scope with a second BOSSA location, immutability, the duplicate-success constraint, the full recovery lifecycle — all proven sequentially, since pgTAP's single-transaction model can't express true concurrency) plus 5 new integration tests in `tests/integration/ai-executive.test.ts` (10 → 15), three of them genuine concurrent-race tests via real `Promise.allSettled` network calls (approve-vs-approve, approve-vs-reject, execute-vs-execute), one live immutability-during-execution test, and one full crash/recovery/retry cycle. 7 new unit-test assertions across three rule files confirm no finance-sensitive value leaks outside evidence. `ai_executive_security.test.sql`'s original 40 assertions are unchanged in count — only their `record_ai_action_attempt`/`record_ai_outcome` call sites were adapted for the new required `execution_token` parameter.

### Validation results (Phase 4B)

Local: `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run test` (19 files, 78 tests), `npm run build`, and the full local Playwright suite (44 specs, 41 run / 3 platform-skipped) all clean before pushing.

**CI — real run, all green:** after 3 fix-forward iterations against real infrastructure:

```text
validate: lint, typecheck, unit test (19 files/78 tests), build          → PASS
database job:
  supabase db reset (all 13 migrations + seed.sql)                        → applies clean from empty
  supabase test db (pgTAP: rls_cross_tenant + operational_security +
    ai_executive_security + ai_executive_concurrency)                     → PASS — 123/123 (29 + 27 + 40 + 27)
  regenerate lib/supabase/database.types.ts + re-typecheck                 → clean against the real schema
  git diff --exit-code -- lib/supabase/database.types.ts                  → zero drift (hard failure, passing)
  npm run test:integration (4 files, ai-executive.test.ts now 15 tests)    → PASS — 37/37
  supabase stop                                                           → clean shutdown
e2e job: Playwright                                                       → PASS — 44 specs (41 run, 3 platform-skipped)
Vercel – bossa-ai-os (preview)                                            → PASS
Vercel – bossa-ai-os-yanz (preview)                                       → PASS
```

### Bugs found by CI (Phase 4B, each fixed as its own commit)

1. **`database.types.ts` drift for the new `ai_execution_lease_duration()` function.** The hand-authored guess (`Args: Record<PropertyKey, never>; Returns: unknown`) didn't match the real generator's single-line `{ Args: never; Returns: string }` for a niladic SQL function returning `interval`. Fixed by committing the exact real output — the only diff in the entire regenerated file, after all 123 pgTAP assertions across all four suites already passed cleanly on the very first real run.
2. **`service_role` had no table-level grant on `ai_recommendations` at all.** Every prior service-role use in this project went through a `SECURITY DEFINER` function (which runs with the *definer's* privileges regardless of caller), so no direct grant was ever needed before — the new recovery integration test is the first to need `service_role` to backdate `executing_at` directly (the only deterministic way to simulate an execution lease elapsing without a real 15-minute wait). Postgres's own error named the exact fix (`GRANT SELECT, UPDATE ON public.ai_recommendations TO service_role`); added in a dedicated migration with reasoning for why this doesn't expand what `service_role` can effectively do (it already bypasses RLS and is never used on any real request path).
3. **A test bug in the immutability integration test, not a schema defect.** It asserted a lead's `owner_user_id` had been updated after finalizing a claim taken directly via the `begin_ai_recommendation_execution` RPC — but that path deliberately bypasses `executeAiRecommendation()` (to hold the recommendation open for the re-evaluation the test is actually about), so the real `lib/operations/*` domain action never ran. Fixed the assertion to check what the test actually exercises (the claim finalizes cleanly and the recommendation reaches `completed`) — the real domain-effect round trip is already covered by the pre-existing "approves and executes a recommendation..." test.

## Phase 4C: transactional execution, decision concurrency, and evaluation-scope orchestration

A further principal-engineer review of PR #19 (after Phase 4B's CI was fully green) found three more merge-blocking defects, all genuine design gaps rather than test bugs. Fixed forward with three new migrations (`20260725000001`–`20260725000003`), without weakening any Phase 4A or 4B assertion. Full design in `docs/AI_APPROVAL_AND_ACTION_SECURITY.md` and `docs/AI_EXECUTIVE_ARCHITECTURE.md`.

1. **Crash window between domain mutation and attempt recording.** `executeAiRecommendation()`'s sequence — claim execution → `actionModule.execute()` (an existing `lib/operations/*` write) → `record_ai_action_attempt()` — left a real gap: a process crash or lost response after the domain mutation committed but before the attempt was recorded left the recommendation stuck `executing` with no record the mutation had actually happened, and `recover_stalled_ai_execution()` had no way to know a retry would re-run an already-applied mutation. Fixed by folding the entire sequence into one new `SECURITY DEFINER` function, `finalize_ai_recommendation_execution(p_recommendation_id, p_execution_token)` (`20260725000001_ai_transactional_action_execution.sql`): inside a single transaction, it re-validates the execution token and the recommendation's live status, loads the action type and payload from `ai_recommendations` itself (never trusting a client-supplied tenant, payload, action type, hash, or actor), checks the exact domain permission for the action type (`crm.write`, `reservations.write`, `orders.write`, or `finance.read`), performs the domain mutation directly in SQL (an `UPDATE` on `leads`/`reservations`/`orders`, or a call to the existing `calculate_daily_kpi_snapshot()`), inserts the `ai_action_attempts` row, transitions the recommendation to `completed`/`failed`, and writes the audit event — all in one atomic call. The mutation itself runs inside a nested `begin...exception when others...end` block (an implicit savepoint): a *business-logic* failure there (illegal transition, row not found) is caught and recorded as an honest `failed` attempt without aborting the outer transaction, but a failure in either of the two steps *after* it (the `ai_action_attempts` insert, the status-transition `UPDATE`) is left uncaught, so it aborts the whole call — including the mutation that appeared to succeed moments earlier. The eight action modules (`lib/ai/actions/*.ts`) no longer implement `execute()` at all; the TypeScript router (`lib/ai/action-router.ts`) remains the compiled, exhaustive allow-list, but each action now calls this one narrow, token-aware RPC rather than a bespoke code path — no arbitrary database function name is ever introduced. `record_ai_action_attempt()` itself is unchanged and un-removed: it remains the primitive for recording an externally-computed result, reserved for a future outbox-backed external/network action, since a network call's success (unlike a local mutation) can't be rolled back by a Postgres transaction abort — documented explicitly as a requirement for any future Phase 5 network-calling action.
2. **Inconsistent lock order between approval and re-evaluation.** `approve_ai_recommendation()` CAS-updated `ai_approvals` and then updated `ai_recommendations` in a separate statement; `apply_ai_evaluation()` could concurrently update the same recommendation and reopen its approval. Two transactions each locking rows in a different order can deadlock, and a caller that reads recommendation and approval state at different times can observe a torn combination (an approved approval next to a recommendation whose payload has already moved on). Fixed (`20260725000002_ai_approval_evaluation_lock_order.sql`) by giving `approve_ai_recommendation()` and `reject_ai_recommendation()` the same fixed lock order `apply_ai_evaluation()` already uses: `SELECT ... FOR UPDATE` on the recommendation row first, then the approval decision, with the recommendation's organization, `proposed` status, and live `payload_hash` re-verified against the snapshotted decision hash before anything commits — so no committed state can ever contain an approved recommendation, an approved approval, and a `payload_hash_at_decision` that no longer matches the recommendation's current hash. `dismiss_ai_recommendation()` needed no change: it already updates its own `ai_recommendations` row before touching `ai_approvals` in its cascade-expire step, the same order. A fixed lock order across both paths means two concurrent transactions can never deadlock against each other — whichever commits first is authoritative for whatever the other reads next.
3. **Evaluation scope not enforced at the orchestration level.** The Phase 4B fix made `apply_ai_evaluation()`'s own mutations exact-scoped (`location_id is not distinct from p_location_id`), but nothing above it guaranteed that a rule *emitting* a location-tagged intent could only ever do so during a location-scoped run, or that an organization-wide run's facts and rules were actually organization-only. Fixed with explicit rule scope metadata (`RuleScope = "organization" | "location" | "both"` on every `RuleDefinition` and `SkillManifest`) and a new orchestrator, `lib/ai/orchestrate.ts::evaluateOrganizationAcrossLocations()`, which discovers an organization's active locations dynamically and runs one location-scoped evaluation per location plus one organization-scoped evaluation containing only organization/`both`-scoped rules — `scripts/evaluate-ai-executive.ts` now calls this instead of the bare single-scope `evaluateOrganization()`. As a second, independent layer of defense, `apply_ai_evaluation()` itself now validates every signal/recommendation intent's `location_id` (`20260725000003_ai_evaluation_scope_validation.sql`): an intent that omits the field defers to the run's own scope, but one that states a location different from `p_location_id` — including an explicit `null` during a location-scoped run — is rejected outright with `VALIDATION_FAILED`, before any row is written. The database itself, not just the orchestrator's wiring, refuses a mixed-scope payload.

**New test coverage:** 14 new pgTAP assertions in `supabase/tests/ai_executive_transactional.test.sql` (the rollback proof — a sabotage trigger installed on `ai_action_attempts` that deliberately raises during the attempt insert, proving the RPC fails, the domain mutation rolls back, no attempt row is stored, the recommendation is left safely recoverable, and a retry after recovery performs the domain mutation exactly once — plus `change_lead_status` and `regenerate_kpi_snapshot` dispatch-coverage tests) and 11 new pgTAP assertions in `supabase/tests/ai_executive_orchestration.test.sql` (mixed-scope rejection in both directions, matching-scope acceptance, a location-scoped signal resolving correctly on a later empty run for that exact location, and rule-config-override coexistence). Three new integration tests in `tests/integration/ai-executive.test.ts` (15 → 18): a repeated approve-vs-evaluation race (5 iterations against a live database, asserting every outcome is either "evaluation wins, new payload approved with matching hash" or "approval wins, evaluation reopens to proposed/pending," never a deadlock or stale approved state), a test proving the orchestrator discovers a newly added location with zero code changes, and a test proving rule-config resolution still falls back correctly from a location-specific override to the organization-wide row. One new unit-test file, `tests/unit/ai/rules/scope.test.ts`, directly tests `ruleAppliesToScope()` and confirms every registered rule declares an explicit scope.

### Validation results (Phase 4C)

Local: `npm run lint` (clean), `npx tsc --noEmit` (clean, strict mode), `npm run test` (20 files, 82 tests, all passing), `npm run build` (succeeds), and the full local Playwright suite (44 specs, 41 run / 3 platform-skipped) — all clean before pushing.

**CI — real run:** see the top-level final validation summary for the exact green run, bug-fix iterations, and Vercel preview results for this round.

### Phase 4C follow-up: location-scoped provider-failure signal regression

A final review found one more location-scoped regression introduced by the Phase 4C scope-validation migration (`20260725000003_ai_evaluation_scope_validation.sql`): `evaluateOrganization()`'s catch block writes an honest `operational_provider_failure` signal when `get_ai_evaluation_facts()` itself fails, but that signal object never set its own `locationId`, and `toSnakeCaseIntents()` unconditionally serialized any omitted `locationId` as explicit `null`. During a location-scoped run this meant the provider-failure signal always submitted `location_id: null` while `p_location_id` was a real location — `apply_ai_evaluation()`'s (correct) mixed-scope guard then rejected the write, and the resulting `VALIDATION_FAILED` scope error replaced the original fact-gathering error the caller actually needed to see.

Fixed by making intent serialization scope-aware: `toSnakeCaseIntents(intents, evaluationLocationId)` now takes the run's own scope and falls back to it — `intent.locationId ?? evaluationLocationId` — instead of always falling back to `null`. An intent that omits its own location now inherits the run's exact scope (matching what every real rule already does explicitly); an intent that states a genuinely different non-null location is untouched by the fallback and is still rejected by the database guard, so no scope validation was weakened. The provider-failure signal itself also now explicitly sets `locationId: locationId ?? undefined` for clarity, though the fallback alone is sufficient to fix the bug.

Three new integration tests in `tests/integration/ai-executive.test.ts` (18 → 21) prove: a location-scoped fact-gathering failure writes exactly one `operational_provider_failure` signal whose `location_id` equals the requested location, and rethrows the original provider error unmasked; an organization-scoped fact-gathering failure writes a `location_id: null` signal; and a genuinely mismatched non-null intent location is still rejected by `apply_ai_evaluation()` with `VALIDATION_FAILED`, proving the inheritance fallback never overrides an explicit, different location.

## Phase 5 readiness

Everything Phase 5 (Integrations) needs is already reusable: the composite-FK tenant-scoping technique, the generic `status_transitions` + trigger mechanism (new machines are new rows, not new trigger functions), the typed `OperationalError` model, the `SECURITY DEFINER` hardening checklist, and — specifically for anything Phase 5 wants to surface as an AI-driven recommendation — a new rule is one file plus one registry line, with zero migration or RLS changes required.

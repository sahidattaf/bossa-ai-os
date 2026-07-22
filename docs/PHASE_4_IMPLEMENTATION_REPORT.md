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

## Phase 5 readiness

Everything Phase 5 (Integrations) needs is already reusable: the composite-FK tenant-scoping technique, the generic `status_transitions` + trigger mechanism (new machines are new rows, not new trigger functions), the typed `OperationalError` model, the `SECURITY DEFINER` hardening checklist, and — specifically for anything Phase 5 wants to surface as an AI-driven recommendation — a new rule is one file plus one registry line, with zero migration or RLS changes required.

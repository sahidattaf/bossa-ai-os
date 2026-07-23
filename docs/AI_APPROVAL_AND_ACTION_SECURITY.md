# AI Approval and Action Security

How a recommendation goes from `proposed` to an executed, audited domain change — and every guard that stands in the way of a forged, replayed, unauthorized, or *duplicated* action along the way. Written for anyone reviewing or extending `lib/ai/action-router.ts`, `lib/ai/approvals.ts`, or the approval/execution RPCs in `supabase/migrations/20260723000007_ai_approval_functions.sql`, `20260724000001_ai_execution_concurrency.sql`, `20260725000001_ai_transactional_action_execution.sql`, and `20260725000002_ai_approval_evaluation_lock_order.sql`. Complements `docs/SECURITY_MODEL.md`'s Phase 4 section and `docs/AI_EXECUTIVE_ARCHITECTURE.md`'s payload-hashing/reopening/immutability discussion.

**Phase 4B note:** a post-merge principal-engineer security review of PR #19 found that several "decision" functions here read status/version in one statement and updated a *different* statement later, keyed only by `id` — a time-of-check-to-time-of-use gap that let two concurrent callers both believe they'd won a decision. Every section below describing "the atomic guard" reflects the *fixed* Phase 4B behavior; the "Concurrency: compare-and-swap, not read-then-write" section explains the defect and the fix directly.

**Phase 4C note:** a second review pass found three further merge-blocking gaps, closed below: (1) the domain mutation itself still happened as a separate round trip *outside* the transaction that recorded it — "Atomic business-action execution" explains the fix; (2) approval decisions and re-evaluation could still race each other with no consistent lock order — "Lock order between approval decisions and re-evaluation" explains the fix; (3) evaluation scope was enforced by convention, not validated — see `docs/AI_EXECUTIVE_ARCHITECTURE.md`'s "Rule scope and the evaluation orchestrator" section.

---

## Concurrency: compare-and-swap, not read-then-write

The pattern every decision function in this file now follows, without exception: **the single UPDATE statement that makes the decision carries every precondition in its own `WHERE` clause** (status, version, expiry, execution token — whichever apply), and the function checks `if not found` on that statement's own result, not on a prior `SELECT`. Under Postgres's default READ COMMITTED isolation, a second concurrent UPDATE targeting the same row blocks until the first commits, then re-evaluates its *own* WHERE clause against the now-committed row — so of two racing statements, at most one can ever match. This is the exact compare-and-swap technique Phase 3's `claimLeadConversion()` already established for reservation/order conversion (`.eq("status", expectedStatus)`), applied here to every AI decision point:

- `approve_ai_recommendation()` / `reject_ai_recommendation()` — `WHERE status = 'pending' AND version = p_expected_version AND (expires_at is null or expires_at >= now())`.
- `dismiss_ai_recommendation()` — `WHERE status IN ('proposed', 'approved')` (this one wasn't named by the review but had the identical defect — a status check in an `if`, then an unguarded `UPDATE ... WHERE id = ...` — fixed the same way for consistency).
- `begin_ai_recommendation_execution()` — `WHERE status IN ('approved', 'failed')`, atomically minting a fresh `execution_token` in the same statement (see below).
- `record_ai_action_attempt()` — `WHERE status = 'executing' AND execution_token = p_execution_token`.
- `recover_stalled_ai_execution()` — `WHERE status = 'executing' AND executing_at = <the exact value just read>`.

Where a function needs a *precise* error message (e.g. distinguishing "already expired" from "wrong version" from "a concurrent decision already won"), it performs a **diagnostic-only re-read** after a failed CAS — this never changes the outcome (the CAS has already, definitively, not applied), it only makes the raised exception more specific. `begin_ai_recommendation_execution()` uses this to preserve the exact `INVALID_STATUS_TRANSITION` message for a genuinely-terminal recommendation (e.g. already `completed`) while raising a distinct `CONFLICT` specifically when the race was against another live claim.

Real concurrent races (two overlapping network calls) can't be expressed inside pgTAP's single-transaction model — `tests/integration/ai-executive.test.ts` fires genuine `Promise.allSettled` pairs against a live Postgres instance for approve-vs-approve, approve-vs-reject, and execute-vs-execute; `supabase/tests/ai_executive_concurrency.test.sql` proves the sequential logic (necessary but not sufficient on its own) for every guard above, plus the immutability, duplicate-success, and location-scope fixes below.

## The execution-claim lifecycle and the execution_token

`ai_recommendations` carries three execution-claim columns: `execution_token uuid`, `executing_at timestamptz`, `execution_attempt_number integer`. `begin_ai_recommendation_execution()`'s atomic claim (`approved`/`failed` → `executing`) mints a fresh `execution_token` and stamps `executing_at = now()` in the same statement that wins the race — the token is the caller's proof of holding the *current* claim, returned to `lib/ai/action-router.ts::executeAiRecommendation()` and threaded through everything that finalizes it.

**`record_ai_action_attempt()` and `record_ai_outcome()` are token-guarded, not just status-guarded:**

- `record_ai_action_attempt(p_recommendation_id, p_execution_token, p_result_status, ...)` refuses to finalize unless the recommendation is currently `executing` *and* `execution_token` matches exactly what the caller presents — a missing token, a stale token (from a completed or recovered claim), or a token that simply doesn't match is rejected before anything is written. `action_type`/`action_payload`/`payload_hash` for the resulting `ai_action_attempts` row are read from the recommendation itself under definer privileges — never taken from a client-supplied argument, so a caller cannot misattribute an attempt or tamper with what it claims to have executed.
- `record_ai_outcome(p_recommendation_id, p_action_attempt_id, p_execution_token, p_status, ...)` is called well after the recommendation itself has typically already moved to `completed`/`failed`, so it validates the token against the **action attempt's own stored `execution_token`** (stamped by `record_ai_action_attempt()`), not the recommendation's current one. The attempt lookup is also tenant- and recommendation-scoped (`id = p_action_attempt_id AND recommendation_id = p_recommendation_id AND organization_id = ...`), so an attempt id belonging to a different recommendation or a different tenant is simply never found, regardless of what token is presented.

Neither function trusts a client-supplied organization, actor, payload hash, or action type — every one of those is resolved from the recommendation/attempt row itself.

## Duplicate-success prevention

A database-level backstop beyond the token compare-and-swap: `idx_ai_action_attempts_success_once`, a partial unique index on `(recommendation_id, payload_hash) WHERE result_status = 'succeeded'`. By construction, the atomic claim/finalize CAS already ensures at most one caller's `record_ai_action_attempt()` invocation ever reaches the insert with a given execution's token — this index exists so that even a future bug in that logic couldn't produce two `'succeeded'` rows for the same recommendation and authoritative payload hash. Failed attempts are unrestricted (retries must remain possible); `completed` is terminal (no transition back to `executing` exists), so a legitimate second `'succeeded'` insert for the same payload can never arise through normal use — `supabase/tests/ai_executive_concurrency.test.sql` proves the constraint directly with a raw insert that bypasses the function entirely.

## Crash and abandoned-execution recovery

A process that calls `begin_ai_recommendation_execution()` and then crashes before ever calling `record_ai_action_attempt()` leaves a recommendation stuck `executing` forever — the normal retry path only accepts `approved`/`failed` as claimable starting points, and nothing else can reach `executing`. `recover_stalled_ai_execution(p_recommendation_id)` is the one narrow, permissioned, audited way back:

- Requires **`ai.recommendations.manage`** (organization_owner/general_manager only) — deliberately a higher bar than the `ai.actions.approve` an ordinary approver holds, since resetting an in-flight claim is an administrative action, not a normal decision.
- Requires `executing_at` to be older than `ai_execution_lease_duration()` (currently 15 minutes, defined once in SQL as the single source of truth) — recovery attempted before the lease elapses is refused with `CONFLICT`.
- Atomically (CAS-guarded on the exact `executing_at` just read) resets the recommendation to `failed` — an existing, legal retry-starting status — and **clears `execution_token`**, so any stale token from before recovery can never again match a live claim.
- Records an explicit `ai_recommendation.execution_recovered` audit event (with the invalidated token and how long it had been stale) *in addition to* the generic `ai_recommendation.status_changed` event the existing status-transition trigger already fires — the same dual-audit pattern `dismiss_ai_recommendation()` already used.
- Never touches `ai_action_attempts` — no deletion, no rewriting of history. A recovered recommendation is simply eligible for a brand-new claim (a fresh token, a new `execution_attempt_number`) the same way any `failed` recommendation already was.

Both pgTAP and the integration suite cover: recovery attempted too early (rejected), an unauthorized user attempting recovery (rejected regardless of lease age — the permission check runs before the age check), authorized recovery after the lease elapses (succeeds), a stale pre-recovery token failing to finalize afterward, and a fresh post-recovery claim executing cleanly.

## Atomic business-action execution

Before Phase 4C, `executeAiRecommendation()` performed three separate steps: claim execution (`begin_ai_recommendation_execution()`), call the domain mutation (a plain `lib/operations/*` round trip over the caller's own session), then record the result (`record_ai_action_attempt()`). A crash or lost network response *after* the domain mutation committed but *before* the attempt was recorded left the mutation durably applied with nothing to show for it — the recommendation stayed `executing` forever, and lease recovery could then permit a retry with no way to know the business action had already happened once.

`finalize_ai_recommendation_execution(p_recommendation_id, p_execution_token)` closes this gap by folding everything from "validate the token" through "write audit history" into one `SECURITY DEFINER` transaction:

1. Validates the execution token and that the recommendation is genuinely `executing` (same guard as `record_ai_action_attempt()`).
2. Loads the **authoritative** `recommended_action_type` and `recommended_action_payload` from the row itself — never a client-supplied action type or payload.
3. Verifies the **exact domain permission** for that action type (`crm.write` for lead actions, `reservations.write` for reservation actions, `orders.write` for order actions, `finance.read` for `regenerate_kpi_snapshot`) — the same permission RLS would require of a human performing the equivalent write directly. A missing permission raises immediately, uncaught — no attempt is recorded for an authorization failure, the same behavior as the `ai.actions.approve` check above it.
4. Performs the domain mutation itself — a plain `UPDATE leads`/`reservations`/`orders`, or (for `regenerate_kpi_snapshot`) a direct call to `calculate_daily_kpi_snapshot()`, which runs inside this same transaction because PL/pgSQL function calls always do.
5. Inserts `ai_action_attempts` and transitions the recommendation to `completed`/`failed`.
6. Writes the `ai_recommendation.executed`/`ai_recommendation.execution_failed` audit event.

Step 4 is wrapped in its own exception-catching block — an implicit savepoint. A **business-logic failure** there (the row wasn't found, the domain's own status-transition trigger rejected an illegal change) is caught, parsed into the project's `"CODE: message"` convention, and recorded as an honest `'failed'` attempt; the call still completes and commits normally. A failure **after** that block — the `ai_action_attempts` insert, or the recommendation-status update — is *not* caught anywhere, so it aborts the entire call and rolls back whatever the mutation just did moments earlier in the same transaction. `supabase/tests/ai_executive_transactional.test.sql` proves this directly: a trigger installed on `ai_action_attempts` that deliberately raises during the insert causes the whole `finalize_ai_recommendation_execution()` call to fail, the domain mutation it just performed to roll back, no attempt to be stored, and the recommendation to remain exactly as it was (still `executing`, same token) — a safe retry once the sabotage is removed performs the mutation exactly once.

`lib/ai/action-router.ts::executeAiRecommendation()` calls this one well-known RPC name for every database-native action type — never a dynamically-constructed function name. `record_ai_action_attempt()` (the older, more general function) is not removed: it remains the primitive for recording an *externally-computed* result, used by tests exercising the token/status contract in isolation and reserved for a future external/network action. **A future external/network action cannot be made atomic this way** — a third-party API call can succeed while the local transaction that would record it fails, and no local rollback can un-send an HTTP request already on the wire. That requires a transactional outbox (durably record "attempt this call" in the same transaction as everything else, with a separate worker making the call and a stable idempotency key proving a retry is safe) — out of scope until the guarded-action allow-list actually includes one.

## Lock order between approval decisions and re-evaluation

`approve_ai_recommendation()` used to CAS-update `ai_approvals` and then update `ai_recommendations` in a second, separate statement, with no lock held on the recommendation row in between. `apply_ai_evaluation()`'s reopening logic (see `docs/AI_EXECUTIVE_ARCHITECTURE.md`) could concurrently upsert or reopen that same recommendation between those two statements — under READ COMMITTED, a plain `SELECT` join (no `FOR UPDATE`) doesn't lock the row it reads, so each side could act on a read of the other's not-yet-committed (or already-superseded) state. The risk: a committed approval whose `payload_hash_at_decision` no longer matches its recommendation's live `payload_hash` — exactly the tamper condition `begin_ai_recommendation_execution()` is supposed to catch, reached through a race instead of a stale client.

The fix is a **consistent lock order, recommendation row first, approval row second, everywhere**:

- `approve_ai_recommendation()` / `reject_ai_recommendation()` now resolve the approval's `recommendation_id` with a plain read, then take `SELECT * FROM ai_recommendations WHERE id = ... FOR UPDATE` *before* touching `ai_approvals` at all. The CAS that follows adds `AND v_recommendation.status = 'proposed'` to its `WHERE` clause — read from that locked row, not a live subquery — so a decision can only ever apply while the recommendation is genuinely still `proposed` at that exact instant.
- `apply_ai_evaluation()`'s pre-upsert check (is this dedupe_key's existing row `executing`, warranting the immutability redirect?) is now also `SELECT ... FOR UPDATE` — it already touched `ai_approvals` second (in the reopening branch), so this is the missing half of the same order.

Two transactions taking locks in a fixed order can never deadlock waiting on each other — whichever acquires the recommendation-row lock first fully commits (or rolls back) before the other proceeds, so the other's subsequent reads are always of a fully-resolved, never a half-applied, state. This makes the approve-vs-evaluate race resolve to exactly one of two documented outcomes, never a third: **(A)** the evaluation's new payload commits first, and the approval decision that follows matches it exactly (`payload_hash_at_decision = recommendation.payload_hash`); or **(B)** the approval commits first, and a later evaluation with a materially different payload reopens it to `proposed`/`pending` (the existing reopening mechanism). `tests/integration/ai-executive.test.ts` runs this exact race, repeatedly, and asserts every result is A or B — never a stale approved state, a deadlock, or an orphaned decision.

---

## Two distinct durable operations, never one collapsed step

Approving a recommendation and executing it are two separate database calls, with a real, inspectable state in between — not one client action that happens to look atomic:

1. **`approveRecommendation()` (`lib/ai/approvals.ts`)** calls `approve_ai_recommendation(p_approval_id, p_expected_version)`. This *only* flips `ai_approvals.status` to `approved` and `ai_recommendations.status` to `approved`, snapshotting the recommendation's current `payload_hash` into `ai_approvals.payload_hash_at_decision`. Nothing executes yet.
2. **`executeAiRecommendation()` (`lib/ai/action-router.ts`)** is a completely separate call, only ever invoked after step 1 is durable. It re-verifies eligibility (see below), performs the underlying domain mutation, and records the result — success or failure — as its own row.

`approveAndExecuteRecommendation()` (`lib/ai/approvals.ts`) calls both in sequence for the UI's one-click "Approve & Execute" button, but they remain two calls, two audit events, and two independently-recoverable states. If execution fails, the approval is untouched — it's still `approved` — and the recommendation lands in `failed`, a legal retry-starting point (`failed → executing` is a valid transition). A failed execution never silently reverts or hides the fact that a human approved the underlying decision.

## The guarded action router allow-list

`lib/ai/action-router.ts::ACTION_MODULES` is a `Record<AiActionType, AiActionModule<never>>` — exhaustive at the type level over the eight-value `AI_ACTION_TYPES` allow-list (`lib/ai/status.ts`):

```
assign_lead_owner, change_lead_status, confirm_reservation, cancel_reservation,
change_order_status, change_order_payment_status, regenerate_kpi_snapshot, navigate
```

Adding a new value to `AI_ACTION_TYPES` without a matching entry in `ACTION_MODULES` is a compile error — the router can never silently fall through to "unknown action type" for something that was actually meant to be supported. At runtime, `executeAiRecommendation()` additionally checks the *stored* `recommended_action_type` against this same list before doing anything else, rejecting arbitrary function names, SQL, URLs, prompts, or tool names outright. `navigate` is explicitly refused at execution time — it is a read-only recommendation type by construction, and the router throws rather than silently no-op'ing if one is ever passed in.

Each of the eight action modules (`lib/ai/actions/*.ts`) now declares only its `actionType` and versioned Zod `payloadSchema` — no `execute()` function. The domain mutation for the seven database-native types lives inside `finalize_ai_recommendation_execution()` (see "Atomic business-action execution" above), dispatched via a `CASE` on the recommendation's own authoritative `recommended_action_type`; it is subject to exactly the same status-machine and money-integrity guarantees a human clicking the equivalent button in the Orders/Reservations/CRM UI would be, because the same triggers fire regardless of which role performs the `UPDATE`.

## Payload re-validation at execution time, not just at proposal time

Before calling `begin_ai_recommendation_execution()`, the router re-parses the recommendation's *currently stored* `recommended_action_payload` against the target action module's own versioned Zod schema (`payloadSchema.safeParse(...)`) — a fast, client-side pre-check. `finalize_ai_recommendation_execution()` re-extracts the same fields itself from the authoritative row when it actually performs the mutation, so the payload's shape is never trusted without being checked fresh, at both layers, every time.

## What `begin_ai_recommendation_execution()` re-verifies, server-side

This function (not the TypeScript router) is where execution eligibility is actually enforced — the router calls it and only proceeds on success:

- **Re-checks `ai.actions.approve`** against the *currently authenticated* caller, not whoever approved it earlier. Approval-time and execution-time can be different actors, and both must independently hold the permission.
- **Confirms a live `approved` approval actually exists** for the recommendation (`ai_approvals.status = 'approved'`).
- **Compares `payload_hash_at_decision` against the recommendation's current `payload_hash`.** A mismatch means the recommendation's payload changed since it was approved (see the reopening mechanism in `docs/AI_EXECUTIVE_ARCHITECTURE.md`) — execution is refused with `CONFLICT`, forcing re-approval rather than silently executing a payload nobody actually reviewed.
- **Enforces the status machine**: only `approved` or `failed` (a legal retry origin) can transition to `executing`.

All of this happens inside one `SECURITY DEFINER` function call, atomically — there's no window between "check eligibility" and "mark executing" where a second concurrent call could sneak through.

## Retry-safety comes from the status machine itself, not a separate lookup

`completed` is a terminal status — no transition exists to re-enter `executing` from it — so a second execution attempt after a genuine success is rejected by the exact same status-transition guard that protects every other status machine in this schema (`enforce_status_transition()`, reused verbatim from Phase 3), reinforced by the token compare-and-swap and the duplicate-success index above. A failed attempt leaves the recommendation in `failed`, which *is* a legal `→ executing` origin — intentionally, so a transient failure (a downstream `lib/operations/*` call throwing) or a crashed-and-recovered execution can be retried without fabricating a new recommendation for the same underlying condition.

## `SECURITY DEFINER` hardening, applied uniformly

Every function in `20260723000007_ai_approval_functions.sql`, `20260724000001_ai_execution_concurrency.sql`, and `20260725000001_ai_transactional_action_execution.sql` (`approve_ai_recommendation`, `reject_ai_recommendation`, `dismiss_ai_recommendation`, `begin_ai_recommendation_execution`, `record_ai_action_attempt`, `record_ai_outcome`, `recover_stalled_ai_execution`, `finalize_ai_recommendation_execution`) follows the same rules:

1. `set search_path = public, pg_temp` — never relies on the caller's search_path.
2. `revoke all ... from public` followed by `grant execute ... to authenticated` — least privilege, nothing runnable by `anon`.
3. **Actor derived from `auth.uid()`**, never a client-supplied parameter — a caller cannot attribute a decision to someone else.
4. **Tenant ownership resolved by loading the row itself** (`select ... into v_approval where id = p_approval_id`, then reading `v_approval.organization_id`) — never a client-supplied `p_organization_id` for an existing row, so a caller cannot claim an id belongs to a different tenant than it actually does.
5. **Every other AI function never touches a domain table directly** — they only ever write `ai_approvals`/`ai_recommendations`/`ai_action_attempts`/`ai_outcomes`. `finalize_ai_recommendation_execution()` is the sole, deliberate exception (Phase 4C): it performs the `leads`/`reservations`/`orders` mutation itself, specifically so that mutation, the attempt record, and the status transition are one atomic transaction (see "Atomic business-action execution" above). It re-implements, explicitly and per action type, the exact permission check RLS would otherwise enforce for that table — the trade-off this exception makes is deliberate and narrow, not a general license for AI functions to bypass RLS on domain tables.

## Optimistic concurrency on approval decisions

`ai_approvals.version` (an integer, starting at 1) guards `approve_ai_recommendation`/`reject_ai_recommendation` against two concurrent decisions on the same approval: both functions require `p_expected_version` to match the row's current `version` before proceeding, raising `CONFLICT` otherwise — the same `.eq("status", expectedStatus)` pattern Phase 3's `claimLeadConversion()` established, generalized to an explicit version column since an approval's meaningful state is `status` *and* who/when decided it, not `status` alone.

## Append-only history

`ai_action_attempts` has no `authenticated` UPDATE/DELETE policy at all — the same pattern as `audit_logs`. The only way a row is created is `record_ai_action_attempt()`, called by the action router immediately after (successful or failed) execution. Nobody can edit or delete execution history through the API, and a recommendation's full attempt history — including every failed retry — remains a permanent, truthful record.

## Audit coverage

Every approval-lifecycle function calls `record_audit_event()` before returning: `ai_recommendation.approved`, `ai_recommendation.rejected`, `ai_recommendation.dismissed`, `ai_recommendation.executed`, `ai_recommendation.execution_failed`. `apply_ai_evaluation()` itself records exactly one `ai_evaluation.applied` event per run (skipped when called with no authenticated actor, i.e. a service-role/seed-context evaluation — mirroring the precedent `calculate_daily_kpi_snapshot()` set in Phase 3).

## Guarded-action security results

40 pgTAP assertions in `supabase/tests/ai_executive_security.test.sql` (unchanged assertion count from Phase 4A — only adapted call sites for the new `execution_token` parameter) cover: tenant/permission-scoped visibility on all seven tables, finance-evidence redaction at the row level, `ai_rule_configs` as the one directly-writable table (everything else function-mediated), `apply_ai_evaluation`'s permission gate, idempotency, stale-signal resolution, and evidence-validation-trigger rejection (both cross-tenant and nonexistent-id cases), the full approve → reopen-on-tamper → re-approve → execute → outcome happy path, single-use approval/rejection via the version guard, retry-safety via the status machine, append-only `ai_action_attempts`, and `dismiss_ai_recommendation`'s permission/tenant checks.

A further 27 pgTAP assertions in `supabase/tests/ai_executive_concurrency.test.sql` (Phase 4B) cover: same-location evidence validation for `lead` and `order_item` (both previously unchecked), exact organization-wide-vs-location-specific evaluation scope across signals and recommendations, executing-recommendation immutability during a materially-changed re-evaluation (including the deferred `:pending-reevaluation` recommendation and the original execution finalizing cleanly against its untouched token/hash), the duplicate-success unique index, and the full recovery lifecycle (too-early rejection, permission check, successful recovery, stale-token rejection, fresh-claim-after-recovery).

Phase 4C adds two more pgTAP files: **14 assertions** in `supabase/tests/ai_executive_transactional.test.sql` (the rollback proof via a sabotaged `ai_action_attempts` insert, an honest `'failed'` attempt for an illegal domain status transition, and `regenerate_kpi_snapshot`'s dispatch to `calculate_daily_kpi_snapshot()`) and **11 assertions** in `supabase/tests/ai_executive_orchestration.test.sql` (mixed-scope intent rejection in both directions, a matching-scope intent accepted, and a location-scoped signal correctly resolving on a later empty run for that exact location).

`tests/integration/ai-executive.test.ts` covers the same flows against a real Supabase instance, including verifying the actual domain effect of a guarded action (a lead's `owner_user_id` genuinely changing after `assign_lead_owner` executes), an intentionally-illegal `change_lead_status` transition to confirm a failure is recorded honestly rather than fabricated as a success, three genuine concurrent-race tests (approve-vs-approve, approve-vs-reject, execute-vs-execute, each via real `Promise.allSettled` network calls), an executing-recommendation immutability test against a live re-evaluation, a full crash/recovery/retry cycle, and — Phase 4C — a repeated real approve-vs-evaluation race (asserting every outcome is one of the two documented cases), a dynamically-added-location discovery test, and a rule-config-fallback test.

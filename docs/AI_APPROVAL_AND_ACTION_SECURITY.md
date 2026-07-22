# AI Approval and Action Security

How a recommendation goes from `proposed` to an executed, audited domain change — and every guard that stands in the way of a forged, replayed, or unauthorized action along the way. Written for anyone reviewing or extending `lib/ai/action-router.ts`, `lib/ai/approvals.ts`, or the approval RPCs in `supabase/migrations/20260723000007_ai_approval_functions.sql`. Complements `docs/SECURITY_MODEL.md`'s Phase 4 section and `docs/AI_EXECUTIVE_ARCHITECTURE.md`'s payload-hashing/reopening discussion.

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

Each of the eight action modules (`lib/ai/actions/*.ts`) wraps an **existing** `lib/operations/*` function — the router never introduces a new mutation path of its own. A guarded action executes exactly the same code (and is subject to exactly the same RLS, status-machine, and money-integrity guarantees) as a human clicking the equivalent button in the Orders/Reservations/CRM UI.

## Payload re-validation at execution time, not just at proposal time

Before calling `begin_ai_recommendation_execution()`, the router re-parses the recommendation's *currently stored* `recommended_action_payload` against the target action module's own versioned Zod schema (`payloadSchema.safeParse(...)`). This guards against the payload having become stale or malformed between when the recommendation was created and when it's finally executed — the router trusts nothing about the payload's shape without checking it fresh, every time.

## What `begin_ai_recommendation_execution()` re-verifies, server-side

This function (not the TypeScript router) is where execution eligibility is actually enforced — the router calls it and only proceeds on success:

- **Re-checks `ai.actions.approve`** against the *currently authenticated* caller, not whoever approved it earlier. Approval-time and execution-time can be different actors, and both must independently hold the permission.
- **Confirms a live `approved` approval actually exists** for the recommendation (`ai_approvals.status = 'approved'`).
- **Compares `payload_hash_at_decision` against the recommendation's current `payload_hash`.** A mismatch means the recommendation's payload changed since it was approved (see the reopening mechanism in `docs/AI_EXECUTIVE_ARCHITECTURE.md`) — execution is refused with `CONFLICT`, forcing re-approval rather than silently executing a payload nobody actually reviewed.
- **Enforces the status machine**: only `approved` or `failed` (a legal retry origin) can transition to `executing`.

All of this happens inside one `SECURITY DEFINER` function call, atomically — there's no window between "check eligibility" and "mark executing" where a second concurrent call could sneak through.

## Retry-safety comes from the status machine itself, not a separate lookup

A simplification found during action-router design, not a workaround: no dedicated "has this payload_hash already succeeded" query is needed, because `completed` is a terminal status — no transition exists to re-enter `executing` from it. A second execution attempt after a genuine success is rejected by the exact same status-transition guard that protects every other status machine in this schema (`enforce_status_transition()`, reused verbatim from Phase 3). A failed attempt leaves the recommendation in `failed`, which *is* a legal `→ executing` origin — intentionally, so a transient failure (a downstream `lib/operations/*` call throwing) can be retried without fabricating a new recommendation for the same underlying condition.

## `SECURITY DEFINER` hardening, applied uniformly

Every function in `20260723000007_ai_approval_functions.sql` (`approve_ai_recommendation`, `reject_ai_recommendation`, `dismiss_ai_recommendation`, `begin_ai_recommendation_execution`, `record_ai_action_attempt`, `record_ai_outcome`) follows the same five rules:

1. `set search_path = public, pg_temp` — never relies on the caller's search_path.
2. `revoke all ... from public` followed by `grant execute ... to authenticated` — least privilege, nothing runnable by `anon`.
3. **Actor derived from `auth.uid()`**, never a client-supplied parameter — a caller cannot attribute a decision to someone else.
4. **Tenant ownership resolved by loading the row itself** (`select ... into v_approval where id = p_approval_id`, then reading `v_approval.organization_id`) — never a client-supplied `p_organization_id` for an existing row, so a caller cannot claim an id belongs to a different tenant than it actually does.
5. **Never touches a domain table directly.** These functions only ever write `ai_approvals`/`ai_recommendations`/`ai_action_attempts`/`ai_outcomes`. The actual `leads`/`reservations`/`orders` mutation happens through the ordinary RLS-scoped `lib/operations/*` path, called from the TypeScript action router — never from inside a `SECURITY DEFINER` AI function. This keeps every domain mutation subject to the exact same RLS and status-machine checks it would face if a human triggered it directly.

## Optimistic concurrency on approval decisions

`ai_approvals.version` (an integer, starting at 1) guards `approve_ai_recommendation`/`reject_ai_recommendation` against two concurrent decisions on the same approval: both functions require `p_expected_version` to match the row's current `version` before proceeding, raising `CONFLICT` otherwise — the same `.eq("status", expectedStatus)` pattern Phase 3's `claimLeadConversion()` established, generalized to an explicit version column since an approval's meaningful state is `status` *and* who/when decided it, not `status` alone.

## Append-only history

`ai_action_attempts` has no `authenticated` UPDATE/DELETE policy at all — the same pattern as `audit_logs`. The only way a row is created is `record_ai_action_attempt()`, called by the action router immediately after (successful or failed) execution. Nobody can edit or delete execution history through the API, and a recommendation's full attempt history — including every failed retry — remains a permanent, truthful record.

## Audit coverage

Every approval-lifecycle function calls `record_audit_event()` before returning: `ai_recommendation.approved`, `ai_recommendation.rejected`, `ai_recommendation.dismissed`, `ai_recommendation.executed`, `ai_recommendation.execution_failed`. `apply_ai_evaluation()` itself records exactly one `ai_evaluation.applied` event per run (skipped when called with no authenticated actor, i.e. a service-role/seed-context evaluation — mirroring the precedent `calculate_daily_kpi_snapshot()` set in Phase 3).

## Guarded-action security results

40 pgTAP assertions in `supabase/tests/ai_executive_security.test.sql` cover: tenant/permission-scoped visibility on all seven tables, finance-evidence redaction at the row level, `ai_rule_configs` as the one directly-writable table (everything else function-mediated), `apply_ai_evaluation`'s permission gate, idempotency, stale-signal resolution, and evidence-validation-trigger rejection (both cross-tenant and nonexistent-id cases), the full approve → reopen-on-tamper → re-approve → execute → outcome happy path, single-use approval/rejection via the version guard, retry-safety via the status machine, append-only `ai_action_attempts`, and `dismiss_ai_recommendation`'s permission/tenant checks. `tests/integration/ai-executive.test.ts` covers the same flows against a real Supabase instance, including verifying the actual domain effect of a guarded action (a lead's `owner_user_id` genuinely changing after `assign_lead_owner` executes) and an intentionally-illegal `change_lead_status` transition to confirm a failure is recorded honestly rather than fabricated as a success.

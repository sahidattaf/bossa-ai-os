# Security Model

How Hospitality OS enforces tenant isolation, authentication, and role-based access. Written for anyone reviewing or extending the Supabase schema in `supabase/migrations/`. Covers Phase 2 (tenancy/auth/RBAC), Phase 3 (operational data), and Phase 4 (AI Executive) — the RLS pattern is identical across all three; Phase 3 and Phase 4 additions are called out in their own sections below.

---

## Threat model

**In scope:**
- One authenticated user of Organization A reading, writing, or inferring the existence of Organization B's operational data.
- A member of an organization escalating their own role or permissions beyond what was granted to them.
- A route slug or a client-submitted UUID being trusted as an access grant.
- Forged or edited audit history.
- The service-role (RLS-bypassing) key being exposed to the browser or used on a request path.

**Explicitly out of scope for Phase 2** (tracked for later phases): self-serve organization signup, cross-tenant data sharing/collaboration features, rate limiting, DoS protection, session fixation beyond what Supabase Auth's cookie handling already provides.

---

## Core principle: access comes from authenticated membership, never from the URL

`app/(workspace)/[organizationSlug]/layout.tsx` resolves the `[organizationSlug]` route param to a tenant, but **the param itself grants nothing**. Every query that follows is scoped by Postgres RLS reading `auth.uid()` from the request's own JWT — a user cannot see or affect a different organization's data by editing the URL, because the database, not the route, is what's checking.

```
Route param (organizationSlug)
        │  (used only to look up which org to attempt)
        ▼
get_organization_summary(slug)   ── SECURITY DEFINER, returns {id, slug, name} for ANY org
        │
        ├─ no row  ──────────────────────────────► 404 (not-found)
        │
        └─ row found
                │
                ▼
        SELECT organizations WHERE id = ...   ── RLS-scoped, using is_org_member(id)
                │
                ├─ 0 rows (not a member) ───────► permission-state page (not 404 — the org
                │                                  is real, the user just can't see it)
                │
                └─ 1 row (active member) ───────► real TenantConfig + real permission list,
                                                    built from organization_branding /
                                                    organization_settings / get_my_permissions()
```

## Why two lookups, not one

A plain `SELECT * FROM organizations WHERE slug = $1` under RLS returns **zero rows** both when the organization doesn't exist and when it exists but the caller isn't a member — RLS can't be told to "return the row but redact the columns," it just filters rows out. Distinguishing those two cases (required by issue #13: unknown org → 404, known org → permission state) needs a query that isn't membership-gated. `get_organization_summary(slug)` is that query: a `SECURITY DEFINER` function returning only `{id, slug, name}` for *any* organization to *any authenticated* user, regardless of membership.

This is a **deliberate, narrow exception** to "access comes from membership," reasoned about explicitly:
- What it exposes: an organization's existence and its display name. Comparable in sensitivity to a company name being publicly knowable (BOSSA's or Papai's existence isn't a secret).
- What it never exposes: branding, settings, membership, financials, or anything else — those all stay behind the real `organizations`/`organization_settings`/etc. RLS-scoped queries.
- Who can call it: `authenticated` only (not `anon`) — you still have to sign in first.

`get_my_permissions(org_id)` and `get_my_role_names(org_id)` are the same pattern for a narrower purpose: they let the app read *the caller's own* effective grants without the app needing to independently re-implement the membership→role→permission join (and risk getting the security-relevant join wrong twice).

---

## RLS policy inventory

Every tenant-owned table has `organization_id`, and every table below has **RLS enabled and forced**.

RLS restricts *which rows* a role can see or change; it does not by itself grant permission to query the table at all — Postgres checks ordinary `GRANT`s first. `20260721230008_table_grants.sql` grants `authenticated` exactly the operations each table's policies below actually allow (nothing more), and grants `anon` nothing anywhere. This was found missing by the CI `database` job running against a real, freshly-reset database — every query failed with "permission denied for table X" until it was added.

| Table | SELECT | INSERT / UPDATE / DELETE |
| --- | --- | --- |
| `organizations` | `is_org_member(id)` | none for `authenticated` — provisioning is service-role only in Phase 2 |
| `locations` | `is_org_member(organization_id)` | `has_permission(organization_id, 'settings.write')` |
| `organization_memberships` | `is_org_member(organization_id)` | `has_permission(organization_id, 'organization.manage')` |
| `membership_roles` | `is_org_member(organization_id)` | `has_permission(organization_id, 'organization.manage')` |
| `organization_branding` | `is_org_member(organization_id)` | UPDATE only: `has_permission(organization_id, 'settings.write')` |
| `organization_settings` | `is_org_member(organization_id)` | UPDATE only: `has_permission(organization_id, 'settings.write')` |
| `audit_logs` | `has_permission(organization_id, 'audit.read')`, or platform admin for platform-level (`organization_id is null`) rows | **none at all** — see below |
| `roles` / `permissions` / `role_permissions` | `true` for any `authenticated` user (global, read-only catalog) | none for `authenticated` — migration-managed |
| `profiles` | own row, or a co-member's (shares an active membership with the caller) | UPDATE: own row only |
| `platform_admins` | own row only | none for `authenticated` — service-role only |

`is_org_member()` and `has_permission()` (`supabase/migrations/20260721230004_authorization_functions.sql`) are the only things any policy reads. Both are `SECURITY DEFINER`, `STABLE`, with `search_path = public, pg_temp` set explicitly (never relying on the caller's search_path), and `REVOKE ALL ... FROM public` followed by an explicit `GRANT EXECUTE ... TO authenticated` (least privilege — nothing is runnable by `anon`).

## Staff cannot escalate role or organization access

Two independent mechanisms, each doing one job:

1. **RLS on `membership_roles`.** Inserting, updating, or deleting a role grant requires `has_permission(organization_id, 'organization.manage')`, held only by `organization_owner` (and platform admins). A `staff`-role member's attempt to insert *any* `membership_roles` row — including one that would just grant themselves `viewer`, not just `organization_owner` — is rejected by the database itself (`42501`), before application code is even involved. Covered by pgTAP tests 10–11.
2. **`protect_last_organization_owner` trigger** (`BEFORE UPDATE OR DELETE ON membership_roles`). Independent of the permission check above: even an `organization_owner` — who *does* hold `organization.manage` — cannot remove the organization's last active `organization_owner` grant. This is what "immutable organization ownership" means here: it's not about who can attempt the change, it's about the organization never being left ownerless. Covered by pgTAP test 12.

`membership_roles.organization_id` is denormalized from `membership_id` by a `BEFORE INSERT OR UPDATE` trigger (`sync_membership_roles_organization_id`), not accepted from the client — otherwise a client could submit a mismatched `organization_id` to fool a policy that reads it directly off the row.

## Audit log immutability

`audit_logs` has **no INSERT/UPDATE/DELETE policy for `authenticated` at all** — not even for organization owners. The only way to write a row is `record_audit_event(...)`, a `SECURITY DEFINER` function that verifies the caller actually belongs to the organization they're logging against, then inserts with definer privileges. Nobody can forge an audit entry attributing an action to someone else, and nobody can edit or delete history through the API. Covered by pgTAP tests 13–16.

## Cross-tenant denial, concretely

- **SELECT**: RLS filters the row out entirely — the query succeeds, returns zero rows. No error, no information about whether the row "exists but is hidden" vs. "doesn't exist" (that's what `get_organization_summary` is for, deliberately, only for organizations).
- **INSERT**: the `WITH CHECK` clause evaluates `has_permission(organization_id, ...)` against the row being inserted; if false, Postgres raises `42501` (`insufficient_privilege`) and the insert never happens.
- **UPDATE / DELETE**: the `USING` clause hides rows the caller isn't authorized for *before* the statement can touch them — a cross-tenant UPDATE/DELETE affects zero rows silently (matches ordinary SQL semantics: `UPDATE ... WHERE <false>` isn't an error), which is why the pgTAP suite verifies "zero rows affected" for those, and `42501` specifically for INSERT.

## Service-role key

`lib/supabase/service-role.ts` is the only place `SUPABASE_SECRET_KEY` is ever read, guarded by `import "server-only"` (an accidental client-side import is a build error, not a runtime leak). **No user request path uses it**, in Phase 2 or Phase 3 — its only caller is `scripts/generate-kpi-snapshots.ts` (see `docs/KPI_SNAPSHOT_OPERATIONS.md`), an explicit, offline, server-only administration script, never something a browser request reaches. `.env.example` documents it as server-only and never-committed.

---

## Phase 3 additions

Five new tenant-owned tables (`leads`, `reservations`, `orders`, `order_items`, `daily_kpi_snapshots`) plus a global `status_transitions` rulebook — full schema in `docs/OPERATIONAL_DATA_MODEL.md`. The RLS pattern is identical to Phase 2's (`is_org_member()`/`has_permission()`, enabled + forced, least-privilege `GRANT`s), with three additions worth calling out specifically:

### Tenant scoping via composite foreign keys, not just RLS

`reservations.location_id`, `orders.location_id`/`lead_id`/`reservation_id`, and `order_items.order_id` each use a composite FK against `(organization_id, id)` on the referenced table, so "does this row belong to the same organization as the row it references" is a schema-level guarantee (`23503` on violation) rather than a trigger or app-level check that something could forget to add. Detailed in `docs/OPERATIONAL_DATA_MODEL.md`.

### Money integrity as a privilege-layer guarantee

`orders.subtotal`/`orders.total` have **no `authenticated` GRANT at all** (`20260722000005_operational_table_grants.sql`) — not even column-restricted UPDATE. Only `SECURITY DEFINER` trigger functions ever write them. This matters beyond defense-in-depth: without the grant restriction, a bare `UPDATE orders SET subtotal = ...` wouldn't touch the `discount_total`/`tax_total`/`delivery_fee` recalculation trigger (which only fires `BEFORE UPDATE OF` those three columns) and could silently desync the stored total from reality.

### `get_dashboard_snapshot()` is SECURITY INVOKER, deliberately

Unlike every other function in this schema (all `SECURITY DEFINER`, needed to read across RLS-restricted membership/role tables safely), the dashboard aggregate RPC runs as the **calling user** — every query inside it is still filtered by each table's own RLS. The function adds its own narrower gate on top (`dashboard.read` to call it at all; `finance.read` to see revenue-shaped fields), but never bypasses tenant isolation the way a `SECURITY DEFINER` implementation would have to be very carefully written not to.

### Status machines: two triggers, not one

`enforce_status_transition()` (BEFORE, validates) and `audit_status_transition()` (AFTER, records) are separate, generic, reusable across every status column in the schema — see `docs/ORDER_RESERVATION_LEAD_WORKFLOWS.md` for the full rulebook and reasoning.

## Phase 4 additions

Seven new tenant-owned tables (`ai_rule_configs`, `ai_signals`, `ai_recommendations`, `ai_recommendation_evidence`, `ai_approvals`, `ai_action_attempts`, `ai_outcomes`) power the AI Executive workspace — full schema in `docs/AI_EXECUTIVE_ARCHITECTURE.md`. The RLS pattern is identical to Phase 2/3's, with four additions worth calling out specifically:

### Six of seven tables are entirely function-mediated, not just RLS-restricted

`ai_rule_configs` is the only one of the seven with an `authenticated` INSERT/UPDATE grant at all. `ai_signals` and `ai_recommendation_evidence` are written exclusively by `apply_ai_evaluation()`; `ai_recommendations` and `ai_approvals` only ever change through the `SECURITY DEFINER` functions in `20260723000007_ai_approval_functions.sql` and `20260724000001_ai_execution_concurrency.sql` (`approve_ai_recommendation`, `reject_ai_recommendation`, `dismiss_ai_recommendation`, `begin_ai_recommendation_execution`, `record_ai_action_attempt`, `record_ai_outcome`, `recover_stalled_ai_execution`); `ai_action_attempts` is append-only, the same immutability guarantee `audit_logs` has. Full reasoning in `docs/AI_APPROVAL_AND_ACTION_SECURITY.md`.

### Server-controlled payload hashing as a tamper-detection anchor

`ai_recommendations.payload_hash` is a `GENERATED ALWAYS AS (...) STORED` column — Postgres computes it, no client or application code can ever supply it. `approve_ai_recommendation()` snapshots it at decision time; `begin_ai_recommendation_execution()` compares that snapshot against the recommendation's *current* hash before allowing execution to start, refusing to proceed on a mismatch. This is what makes "the payload changed after approval" a structurally detectable condition rather than something a careful reviewer has to notice by eye.

### Polymorphic reference validation via one generic trigger

`ai_signals` and `ai_recommendation_evidence` can each reference one of five domain tables (`lead`, `reservation`, `order`, `order_item`, `daily_kpi_snapshot`) through `source_entity_type`/`source_entity_id` — no single foreign key can express that. `validate_ai_source_entity_reference()` (one `BEFORE INSERT/UPDATE` trigger function, attached to both tables) reads the row generically via `to_jsonb(new)` and checks existence + organization match, and — for all five types, including `lead` and `order_item` (via a join to its parent order) — location match, against whichever table `source_entity_type` names, raising `RELATED_ENTITY_MISMATCH` on a cross-tenant, cross-location, or nonexistent reference — the same "schema-level impossibility" property Phase 3's composite FKs give single-table references, extended to a polymorphic case via a trigger.

### Finance redaction: RLS for evidence, rule-authoring discipline for everything else

`ai_recommendation_evidence`'s SELECT policy adds `AND (NOT is_finance_sensitive OR has_permission(organization_id, 'finance.read'))` on top of the ordinary `ai.executive.read` gate. A caller without `finance.read` sees a recommendation's title and summary but not the specific revenue/average-ticket/order-total evidence rows backing it — the redaction happens at the database layer, so no UI component can accidentally leak it by skipping a check. This RLS clause only covers `ai_recommendation_evidence`, though — a Phase 4B review found raw dollar figures leaking into `ai_signals.facts` and one recommendation's `executive_summary`, neither of which RLS redacts. Fixed by removing every finance-sensitive raw value from any field outside an `isFinanceSensitive` evidence row — see `docs/AI_RULES_AND_SIGNALS.md`.

## Phase 4B additions: concurrency, execution-claim, and location-scope hardening

A post-merge principal-engineer security review of PR #19 found several concurrency and scope defects, all fixed forward without weakening any existing test. Full design in `docs/AI_APPROVAL_AND_ACTION_SECURITY.md` and `docs/AI_EXECUTIVE_ARCHITECTURE.md`; summarized here as security-model-relevant facts:

- **Every AI decision function is now an atomic compare-and-swap**, not a read-then-write: `approve_ai_recommendation()`, `reject_ai_recommendation()`, `dismiss_ai_recommendation()`, `begin_ai_recommendation_execution()`, and `record_ai_action_attempt()` each carry every precondition (status, version, expiry, execution token) inside the single `UPDATE ... WHERE ...` that makes the decision, relying on Postgres's default READ COMMITTED isolation to guarantee at most one of two racing statements can ever match.
- **Execution claims are token-guarded.** `ai_recommendations.execution_token`/`executing_at`/`execution_attempt_number` track who currently holds the claim to execute a recommendation; `record_ai_action_attempt()`/`record_ai_outcome()` refuse to finalize anything without the exact current token, rejecting missing, stale, or mismatched tokens before touching any row.
- **A database-level duplicate-success constraint** (`idx_ai_action_attempts_success_once`, a partial unique index on `(recommendation_id, payload_hash) WHERE result_status = 'succeeded'`) backstops the token compare-and-swap — at most one successful action attempt can ever exist per recommendation and authoritative payload.
- **Crash recovery is narrow, permissioned, and audited.** `recover_stalled_ai_execution()` requires `ai.recommendations.manage` (not the broader `ai.actions.approve`) and an execution older than `ai_execution_lease_duration()` (15 minutes) — an ordinary approver cannot reset an in-flight claim, and a recovery attempted before the lease elapses is refused regardless of who calls it.
- **Executing recommendations are immutable.** `apply_ai_evaluation()` never overwrites a recommendation's payload/evidence/approval relationship while it is `executing` — a materially changed re-evaluation is parked as a separate `:pending-reevaluation` recommendation instead.
- **Evaluation scope is exact, not best-effort.** A location-specific evaluation run can no longer resolve or expire an organization-wide or sibling-location signal/recommendation/approval — every scope-gating predicate uses NULL-safe exact equality (`location_id is not distinct from p_location_id`).

## Phase 4C additions: atomic action finalization, decision lock order, and evaluation-scope orchestration

A further post-merge review of PR #19 found three more merge-blocking gaps, fixed forward without weakening any existing test. Full design in `docs/AI_APPROVAL_AND_ACTION_SECURITY.md` and `docs/AI_EXECUTIVE_ARCHITECTURE.md`; summarized here as security-model-relevant facts:

- **A domain mutation and its attempt record are now one atomic unit, not two.** `finalize_ai_recommendation_execution(p_recommendation_id, p_execution_token)` performs, in a single transaction: execution-token and status re-validation, loading the action type and payload authoritatively from `ai_recommendations` (never from the client), the exact domain-permission check for that action type, the domain mutation itself, the `ai_action_attempts` insert, the recommendation's `completed`/`failed` transition, and the audit event. A crash or failure at any point after the mutation begins either lands as an honestly-recorded `failed` attempt (a caught business-logic error) or rolls the mutation back entirely (an uncaught failure in the attempt-insert or status-transition step) — there is no window where a mutation can commit with nothing recorded. Proven directly by a rollback test that installs a trigger which deliberately raises during the attempt insert.
- **The TypeScript action router stays the compiled allow-list; the database stays the authority.** Action modules no longer implement their own `execute()` — each calls the same narrow, token-aware RPC, so no action can introduce an arbitrary database function name or bypass the transactional guarantee above.
- **Approval decisions and re-evaluation now share one lock order.** `approve_ai_recommendation()` and `reject_ai_recommendation()` lock the recommendation row (`FOR UPDATE`) before deciding the approval, the same order `apply_ai_evaluation()`'s reopening logic already used — two transactions taking locks in a fixed, consistent order can never deadlock against each other, and the approval decision re-verifies the recommendation's organization, `proposed` status, and live payload hash before committing, so no committed state can ever pair an approved approval with a recommendation whose payload has since changed.
- **Evaluation scope is enforced by rule metadata and the database, not just convention.** Every rule and skill now declares `scope: "organization" | "location" | "both"`; a new orchestrator (`evaluateOrganizationAcrossLocations()`) runs one evaluation per active location plus one organization-scoped evaluation, discovering locations dynamically so a newly added one needs no code change. `apply_ai_evaluation()` independently rejects any signal or recommendation intent whose own `location_id` doesn't exactly match the run's scope — including an explicit `null` during a location-scoped run — before writing anything, so a rule-authoring mistake or an orchestration bug can never produce a mixed-scope row.

## What's still not covered

- Rate limiting / brute-force protection on `/login` (Supabase Auth's own defaults apply; nothing additional was added).
- Self-serve organization creation — provisioning a new organization is still a manual, service-role administrative action.
- Phase 3B domains (inventory, suppliers, menu costing, reviews, staff/tasks, finance) — no tables, policies, or screens exist for any of them yet.
- A learning/memory loop for the AI Executive — `ai_outcomes` records results for human review, but nothing yet feeds them back into rule weighting or priority scoring.

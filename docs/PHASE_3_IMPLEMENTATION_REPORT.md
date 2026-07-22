# Phase 3 Implementation Report — Operational Data Layer and Live Tenant Dashboard

**Branch:** `feat/phase-3-operational-data-dashboard` · **Issue:** #16 (part of #9) · **Follows:** Phase 2 (PR #15)

## Scope

Turn the authenticated, RLS-protected Phase 2 foundation into a live operational system: `leads` → `reservations`/`orders` → status changes → `daily_kpi_snapshots` → the live dashboard → owner action → audit. Phase 3A (this PR) ships that full loop end-to-end for BOSSA and Papai. Phase 3B domains (Inventory, Suppliers, Menu Costing, Reviews, Staff/Tasks, Finance) get no new tables, screens, or placeholder schema — see "What's deliberately not built" in `docs/ORDER_RESERVATION_LEAD_WORKFLOWS.md`.

## Database architecture

Five new tables, all `organization_id`-scoped: `leads`, `reservations`, `orders`, `order_items`, `daily_kpi_snapshots`, plus a global `status_transitions` rulebook table (not tenant-owned, same pattern as Phase 2's `roles`/`permissions` catalog). Full schema reference in `docs/OPERATIONAL_DATA_MODEL.md`. Seven migrations, applied in order:

| File | Contents |
| --- | --- |
| `20260722000001_operational_tables.sql` | The five tables — composite FKs for tenant-scoped cross-references, `order_items.line_total` as a `GENERATED ALWAYS` column, the expression unique index on `daily_kpi_snapshots` |
| `20260722000002_operational_status_machines.sql` | `status_transitions` rulebook, `enforce_status_transition()` / `audit_status_transition()` generic triggers, wired to `leads.status`, `reservations.status`, `orders.status`, `orders.payment_status` |
| `20260722000003_money_integrity.sql` | `recalculate_order_totals()`, the `order_items` recalculation trigger, the `orders` fee-field recalculation trigger |
| `20260722000004_operational_rls_policies.sql` | RLS enabled + forced, every policy, on all five tables |
| `20260722000005_operational_table_grants.sql` | Base `GRANT`s to `authenticated`, including the column-restricted grants on `orders`/`order_items` that make money integrity a privilege-layer guarantee, not just a trigger one |
| `20260722000006_kpi_snapshot_function.sql` | `calculate_daily_kpi_snapshot()` — idempotent upsert |
| `20260722000007_dashboard_aggregate_rpc.sql` | `get_dashboard_snapshot()` — the live dashboard's one aggregate RPC |

## Architecture decisions (locked before implementation)

1. **Audit guarantee via database triggers.** Material lead/reservation/order/payment status transitions are audited by `audit_status_transition()`, fired only after `enforce_status_transition()` has validated the change — an audited transition is, by construction, a legal one. The service layer records distinct *non-transition* events (`lead.created`, `lead.converted_to_reservation`, `order.created`, etc.) and never duplicates a trigger-created status event.
2. **KPI execution without a scheduler.** `calculate_daily_kpi_snapshot()` is a reusable, idempotent database function; `scripts/generate-kpi-snapshots.ts` is the documented manual CLI invocation. No Vercel Cron / Supabase scheduled job is enabled.
3. **Dashboard aggregation via one SECURITY INVOKER RPC.** `get_dashboard_snapshot()` requires `dashboard.read` to call at all, gates revenue-shaped fields behind `finance.read`, stays organization-scoped by running as the caller (RLS still applies to every query inside it), accepts a deterministic `p_as_of`, and issues a small fixed number of aggregate queries — never N+1.
4. **Money integrity at both the trigger and privilege layer.** `order_items.line_total` is a generated column (Postgres itself refuses a client-supplied value); `orders.subtotal`/`total` have no `authenticated` grant at all, so even an `UPDATE` that never touches a recalculation trigger's watched columns can't desync them.
5. **Status machines enforced at the database layer**, not just fenced in by `CHECK` — see `docs/ORDER_RESERVATION_LEAD_WORKFLOWS.md` for the full rulebook.
6. **Mock mode stays a read-only, explicitly labeled demo.** The three new pages render a "Demo mode — read-only" notice and static fictional fixtures (`lib/operations/mock-fixtures.ts`) in mock mode; no create/status forms render, and no order detail route exists in mock mode at all.
7. **Generated type drift is now a hard CI failure** (`.github/workflows/ci.yml`'s `database` job runs `git diff --exit-code -- lib/supabase/database.types.ts` after regenerating), not the informational warning it was in Phase 2.
8. **One typed operational error model** (`lib/errors.ts`) — every server-side operation surfaces one of ten `OperationalErrorCode`s, mapped from Postgres SQLSTATEs and this project's `"CODE: message"` raise-exception convention, never a raw driver error.

## Live dashboard

`SupabaseDashboardDataProvider` (`lib/dashboard/supabase-provider.ts`) calls `get_dashboard_snapshot()` once per render for every "today"/"tonight" figure, then layers two small, deterministic, rule-based derivations on top — **not** an LLM or external service, matching the issue's "AI priorities generated from deterministic rules only in this phase":

- **`aiPriorities`**: unanswered leads, zero reservations tonight, cancellations today
- **`liveAlerts`**: unanswered-lead threshold, no-shows today, cancellations today
- **`revenueForecast`**: the trailing 7 days of actual `daily_kpi_snapshots` revenue — an honest historical trend line, explicitly *not* a predictive model. Only populated when the caller has `finance.read`; otherwise an honest empty array.

Reviews, product-KPI-to-order-item mapping, and food-cost/labor percentages have no source tables yet in Phase 3A and remain the same honest zero/empty states Phase 2 shipped. The `DashboardDataProvider` interface itself is unchanged.

## Application routes

`/[organizationSlug]/{orders,reservations,crm}` are now functional, not `ComingSoonState` placeholders — permission/loading/empty/error states, status filters, create flows, and (for orders specifically, since items are inherently a detail-level concept) a dedicated `/orders/[orderId]` detail page for item management and status/payment control. Mock mode renders the same routes as a labeled, read-only demo per architecture decision #6.

## Cross-tenant security results

27 new pgTAP assertions (`supabase/tests/operational_security.test.sql`), complementing Phase 2's 29 (`rls_cross_tenant.test.sql`, unchanged): permission-scoped SELECT narrower than plain org membership, cross-tenant composite-FK rejection (order_items→order, reservation→location), status-machine enforcement + exact audit trail, money integrity (both the computed values and the direct-write rejection), KPI snapshot idempotency, and the dashboard RPC's finance.read gating. Plus 8 new integration tests (`tests/integration/operations.test.ts`) and 6 new Playwright specs (`tests/e2e/operations.spec.ts`, plus one existing spec updated for the no-longer-coming-soon Orders route).

## Validation results

Run locally in this sandbox (no Docker, so the database-specific steps below only run in CI — see `docs/SUPABASE_OPERATIONS.md`):

```text
npm run lint        → clean
npm run typecheck   → clean (strict mode)
npm run test         → 8 files, 43 tests passed
npm run build         → succeeds, 21 routes (20 from Phase 2 + /orders/[orderId])
```

Manually smoke-tested via `npm run dev` (mock mode): `/bossa/orders`, `/bossa/reservations`, `/bossa/crm`, and `/papai/orders` all return 200 with the "Demo mode — read-only" notice and the correct tenant-isolated fixtures (BOSSA's fixtures never appear on Papai's pages or vice versa); order numbers render as plain text, not links, in mock mode; `/bossa/orders/<id>` (mock mode) correctly 404s since mock mode has no real order records; `/bossa/dashboard` is unaffected by the `SupabaseDashboardDataProvider` rewrite. No console or server errors in any of these requests.

CI `database`/`e2e` jobs (migrations, seed, pgTAP — including the 27 new operational assertions — type-drift hard-fail, integration tests, Playwright): **not yet run** — this report will be updated with the real CI run link once the branch is pushed, following the same practice as Phase 2's report.

## Risks and decisions

1. **`Relationships: []` left empty for every new table in `lib/supabase/database.types.ts`**, matching the existing (Phase 1/2) convention in that file, even though several new tables have real foreign keys. None of this codebase's queries use embedded/nested `.select("*, other_table(*)")` syntax, so this doesn't affect typechecking either way — but it means the hand-authored file's exact match against the real generator's `Relationships` output is unverified until CI runs (same caveat Phase 2 already carried for its own tables).
2. **`cancellation_count` on `daily_kpi_snapshots` tracks only order cancellations**, not reservation cancellations (only reservation *no-shows* are tracked separately) — documented explicitly in `docs/KPI_SNAPSHOT_OPERATIONS.md` as a deliberate scope limit rather than an oversight.
3. **Order creation is two round trips** (insert the order, then bulk-insert its items), not one atomic RPC. Each item insert's recalculation is transactional on its own, but a failure partway through item insertion leaves an order with only the items that succeeded rather than none at all. Accepted as a reasonable trade-off against the complexity of a combined `create_order_with_items` RPC, given Phase 3A's scope.
4. **UI scope for leads/reservations is list + status-change, not full field editing or lead-conversion buttons.** `convertLeadToReservation`/`convertLeadToOrder` exist and are tested in the service layer and pgTAP, but aren't yet wired into the CRM page's UI — a deliberate scope cut to avoid an unfinished conversion flow, not a forgotten one.
5. **`tsx` added as a new devDependency** to run `scripts/generate-kpi-snapshots.ts` — the smallest addition that gives the manual-invocation script a real, documented entry point without adding a build step.

## Phase 4 readiness

The seams Phase 3B named (Inventory, Suppliers, Menu Costing, Reviews, Staff/Tasks, Finance) can all reuse: the `has_permission()`/RLS/`GRANT` pattern, the composite-FK tenant-scoping technique, the generic `status_transitions` + trigger mechanism (new machines are just new rows plus two trigger declarations), the typed `OperationalError` model, and `get_dashboard_snapshot()`'s pattern for adding new aggregate fields without introducing N+1 queries.

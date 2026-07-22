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

## CRM lead conversion

"Convert to Reservation" / "Convert to Order" are wired into the CRM list (`app/(workspace)/[organizationSlug]/crm/page.tsx`, `crm/actions.ts`, `components/operations/lead-conversion-actions.tsx`):

- The Convert column/buttons render only in `supabase` mode, only when the caller holds the target permission (`reservations.write` / `orders.write`), and only when the lead's current status is convertible (`isLeadConvertible()` — `"contacted"` or `"qualified"`, mirroring the `lead_status` transition rulebook).
- **Duplicate conversion is prevented server-side, not just hidden in the UI.** `claimLeadConversion()` (`lib/operations/conversions.ts`) flips the lead to `"converted"` with an optimistic-concurrency `.eq("status", expectedStatus")` guard *before* creating the reservation/order: two concurrent conversion attempts both read `"contacted"`, but Postgres row-locking means only one UPDATE can match; the loser gets a typed `CONFLICT` and never creates an orphaned reservation/order. Sequential re-conversion attempts fail the same way against the now-`"converted"` status.
- The created reservation/order retains the source lead relationship (`reservation.lead_id` / `order.lead_id`) and organization scope, structurally guaranteed by the composite FK `(organization_id, lead_id) references leads(organization_id, id)` — not an application-level convention.
- Each conversion records its own audit event (`lead.converted_to_reservation` / `lead.converted_to_order`), distinct from the status trigger's own `lead.status_changed` entry for the "converted" transition.
- Both server actions call `revalidateOperationalRoutes()`, refreshing the CRM, reservations, orders, and dashboard routes together.
- Covered by 5 integration tests (`tests/integration/lead-conversions.test.ts`: both conversion types, an inconvertible-status rejection, sequential duplicate rejection, and a genuine concurrent-race duplicate rejection via `Promise.allSettled`) and a Playwright assertion (`tests/e2e/operations.spec.ts`) that the conversion buttons never render in the read-only mock demo.

## Cross-tenant security results

56 total pgTAP assertions across two files, all passing: Phase 2's 29 (`rls_cross_tenant.test.sql`, unchanged) + Phase 3's 27 (`supabase/tests/operational_security.test.sql`) — permission-scoped SELECT narrower than plain org membership, cross-tenant composite-FK rejection (order_items→order, reservation→location), status-machine enforcement + exact audit trail, money integrity (both the computed values and the direct-write rejection), KPI snapshot idempotency, and the dashboard RPC's finance.read gating. Plus 22 integration tests across 3 files (`tenancy.test.ts`: 9, `operations.test.ts`: 8, `lead-conversions.test.ts`: 5) and 23 Playwright specs, all green in CI.

## Validation results

Local (no Docker in this sandbox — the database-specific steps below only run in CI, see `docs/SUPABASE_OPERATIONS.md`):

```text
npm run lint        → clean
npm run typecheck   → clean (strict mode)
npm run test         → 8 files, 43 tests passed
npm run build         → succeeds, 21 routes (20 from Phase 2 + /orders/[orderId])
```

Manually smoke-tested via `npm run dev` (mock mode): `/bossa/orders`, `/bossa/reservations`, `/bossa/crm`, and `/papai/orders` all return 200 with the "Demo mode — read-only" notice and the correct tenant-isolated fixtures (BOSSA's fixtures never appear on Papai's pages or vice versa); order numbers render as plain text, not links, in mock mode; `/bossa/orders/<id>` (mock mode) correctly 404s since mock mode has no real order records; `/bossa/dashboard` is unaffected by the `SupabaseDashboardDataProvider` rewrite. No console or server errors in any of these requests.

**CI — real run, all green:** [run 29951858858](https://github.com/sahidattaf/bossa-ai-os/actions/runs/29951858858), after 8 fix-forward iterations against real infrastructure (see "Bugs found by CI" below):

```text
validate: lint, typecheck, unit test (8 files/43 tests), build      → PASS (1m6s)
database job:
  supabase start (Docker, real local stack)                          → boots clean
  supabase db reset (all 15 migrations + seed.sql)                    → applies clean from empty
  supabase test db (pgTAP: rls_cross_tenant.test.sql + operational_security.test.sql) → PASS — 56/56 (29 + 27)
  regenerate lib/supabase/database.types.ts + re-typecheck            → clean against the real schema
  git diff --exit-code -- lib/supabase/database.types.ts             → zero drift (hard failure, passing)
  npm run test:integration (3 files)                                 → PASS — 22/22 (9 + 8 + 5)
  supabase stop                                                      → clean shutdown
                                                                        (job total: 1m48s)
e2e job: Playwright                                                   → PASS — 23/23 specs (39.4s)
Vercel – bossa-ai-os (preview)                                        → PASS
Vercel – bossa-ai-os-yanz (preview)                                   → PASS
```

## Bugs found by CI (each fixed as its own commit, in order)

1. **Missing `locations(organization_id, id)` unique constraint.** The composite FKs in `20260722000001_operational_tables.sql` referencing `locations(organization_id, id)` failed on a fresh `db reset` — Phase 2's `locations` table only had a plain `id` primary key. Fixed by adding the constraint at the top of that migration.
2. **Stale Playwright assertion.** `tests/e2e/tenant-switcher.spec.ts`/`dashboard.spec.ts` still asserted the Phase 1 "Orders is coming in Phase 3" placeholder text, now replaced by the live route.
3. **Missing `GRANT SELECT` on `status_transitions` to `authenticated`.** The RLS policy allowing any authenticated user to read the rulebook existed, but the base table grant needed for that policy to ever be reached was missing — the same class of bug Phase 2's CI caught for its own tables (RLS restricts which rows, it doesn't grant permission to query the table at all).
4. **Incorrect pgTAP assertion.** One assertion expected SQLSTATE 42501 from an RLS-denied `UPDATE`; Postgres instead resolves a denied UPDATE's `USING` clause by making the row invisible, so the statement succeeds and affects zero rows — no error at all (that's standard Postgres RLS behavior, and exactly how `rls_cross_tenant.test.sql` already tests the equivalent case elsewhere). Corrected to the same `WITH ... UPDATE ... RETURNING` + zero-rows-affected pattern.
5. **Hand-authored `database.types.ts` drift** in two places once pgTAP itself started passing: `order_items.line_total` (a `GENERATED` column) is nullable in the real generator's output; `calculate_daily_kpi_snapshot`'s optional `p_location_id` RPC argument only accepts `undefined`, not `null`, in the real generated type.
6. **Whole-file `database.types.ts` format drift**, exposed only once decision #7 turned the diff check from a warning into a hard failure: the file predated a newer `supabase gen types` template (`DefaultSchema`, `DatabaseWithoutInternals`, per-table `Relationships` arrays, a `Constants` export) that this project's installed CLI version actually produces. Resolved by uploading the real regenerated file as a CI artifact and committing that exact output, then restoring the read-only diff-only step — never hand-editing around the generator.
7. **Integration tests failing to collect (`0 test`).** `tests/integration/operations.test.ts` and `lead-conversions.test.ts` both import `lib/operations/*` modules, each guarded by `import "server-only"`. That package only swaps in its no-op `empty.js` under Next's `"react-server"` resolve condition, which Vitest's plain Node/Vite resolution never sets — so the import always threw "This module cannot be imported from a Client Component module" before a single test could run. Fixed by aliasing `server-only` to its own `empty.js` in `vitest.integration.config.ts`, reproducing exactly what Next's server build already does.

## Risks and decisions

1. **`cancellation_count` on `daily_kpi_snapshots` tracks only order cancellations**, not reservation cancellations (only reservation *no-shows* are tracked separately) — documented explicitly in `docs/KPI_SNAPSHOT_OPERATIONS.md` as a deliberate scope limit rather than an oversight.
2. **Order creation is two round trips** (insert the order, then bulk-insert its items), not one atomic RPC. Each item insert's recalculation is transactional on its own, but a failure partway through item insertion leaves an order with only the items that succeeded rather than none at all. Accepted as a reasonable trade-off against the complexity of a combined `create_order_with_items` RPC, given Phase 3A's scope.
3. **`tsx` added as a new devDependency** to run `scripts/generate-kpi-snapshots.ts` — the smallest addition that gives the manual-invocation script a real, documented entry point without adding a build step.
4. **Playwright coverage of lead conversion is a negative assertion only** (buttons never render in the mock-mode demo) — this project's `e2e` CI job runs against `next start` in mock mode with no live Supabase, so a true end-to-end conversion round-trip is exercised by the integration suite instead, which does run against a real database.

## Phase 4 readiness

The seams Phase 3B named (Inventory, Suppliers, Menu Costing, Reviews, Staff/Tasks, Finance) can all reuse: the `has_permission()`/RLS/`GRANT` pattern, the composite-FK tenant-scoping technique, the generic `status_transitions` + trigger mechanism (new machines are just new rows plus two trigger declarations), the typed `OperationalError` model, and `get_dashboard_snapshot()`'s pattern for adding new aggregate fields without introducing N+1 queries.

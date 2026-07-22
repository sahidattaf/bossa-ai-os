# Operational Data Model — Phase 3A

Schema reference for `leads`, `reservations`, `orders`, `order_items`, and `daily_kpi_snapshots` — the tables added in `supabase/migrations/20260722000001_operational_tables.sql` through `20260722000007_dashboard_aggregate_rpc.sql`. Written for anyone extending these tables or adding a new operational domain in a later phase.

---

## Tenant scoping: composite foreign keys, not triggers

Every operational table carries `organization_id` directly (denormalized, never inferred via a join). Cross-references between operational tables — `reservations.location_id`, `orders.location_id`/`lead_id`/`reservation_id`, `order_items.order_id` — use a **composite foreign key** against `(organization_id, id)` on the referenced table, instead of a plain single-column FK plus an app-level or trigger-level check:

```sql
-- locations carries its own uniqueness on (organization_id, id) in addition to its plain PK...
unique (organization_id, id)

-- ...so a referencing table can require the pair to match, not just the id:
foreign key (organization_id, location_id) references public.locations (organization_id, id)
```

If a reservation's `organization_id` is BOSSA's but `location_id` points at a Papai location, Postgres itself rejects the row with `23503` (`foreign_key_violation`) — there is no `(bossa_org_id, papai_location_id)` row in `locations` to satisfy the constraint. This is why "order_items cannot reference a cross-tenant order" and "location belongs to the same organization" (issue #16 scope B) are schema-level guarantees here, not application checks: nothing server-side needs to remember to verify this, and nothing can forget to.

A `NULL` referencing column (e.g. `leads.location_id`, `orders.lead_id`) always satisfies the constraint trivially (`MATCH SIMPLE`), so the nullable cross-references stay optional.

## Tables

### `leads`

Intake for reservation/order/catering inquiries before they become a real booking or order. `lead_type` and `source` are free-form-but-constrained via `CHECK`; `status` follows the `lead_status` machine (see `docs/ORDER_RESERVATION_LEAD_WORKFLOWS.md`). `unique (organization_id, id)` exists purely so `reservations`/`orders` can composite-FK against it.

### `reservations`

`confirmation_code` is unique per organization (`unique (organization_id, confirmation_code)`), generated server-side by the service layer, never client-supplied. `duration_minutes` defaults to 90. `status` follows the `reservation_status` machine.

### `orders` and `order_items`

The money-integrity pair (issue #16 rule 4):

- `order_items.line_total` is a **`GENERATED ALWAYS AS (quantity * unit_price) STORED`** column — Postgres itself refuses any INSERT/UPDATE that names this column, regardless of grants.
- `orders.subtotal`/`orders.total` are ordinary columns, but `authenticated` has no UPDATE (or INSERT) grant on either (`20260722000005_operational_table_grants.sql`) — only `public.recalculate_order_totals()` (`SECURITY DEFINER`) ever writes them, fired by a trigger on `order_items` (`recalculate_order_totals_on_item_change`, `AFTER INSERT OR UPDATE OR DELETE`) and by `recalculate_order_total_fields` on `orders` itself (`BEFORE INSERT OR UPDATE OF discount_total, tax_total, delivery_fee`).
- `total = subtotal - discount_total + tax_total + delivery_fee`, always recomputed transactionally as part of whichever statement changed an item or a fee field — never computed client-side and trusted.

`orders.status` and `orders.payment_status` are two independent status machines (`order_status`, `order_payment_status`) on the same table — see the workflows doc.

### `daily_kpi_snapshots`

One row per `(organization_id, location_id, snapshot_date)` — `location_id` may be `NULL` for an organization-wide rollup alongside per-location rows. Because a plain multi-column `UNIQUE` constraint can't fold `NULL` into a single comparable value, uniqueness is a **unique index over an expression**:

```sql
create unique index ... on public.daily_kpi_snapshots (
  organization_id,
  coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
  snapshot_date
);
```

Rows are written exclusively by `public.calculate_daily_kpi_snapshot()` (see `docs/KPI_SNAPSHOT_OPERATIONS.md`) — there is no authenticated INSERT/UPDATE policy on this table at all, the same append-only-via-function pattern Phase 2 established for `audit_logs`.

## Status machines: CHECK constraints are necessary, not sufficient

Every status column has a `CHECK` fencing in its *value set*. That alone doesn't stop an illegal *transition* (e.g. a completed order silently reverting to pending), so a second, table-driven mechanism enforces valid transitions — see `docs/ORDER_RESERVATION_LEAD_WORKFLOWS.md` for the full rulebook and how it's wired.

## Permissions

No new permission keys were needed — Phase 2's catalog already had exactly what Phase 3A requires:

| Table | SELECT | INSERT / UPDATE / DELETE |
| --- | --- | --- |
| `leads` | `crm.read` | `crm.write` |
| `reservations` | `reservations.read` | `reservations.write` |
| `orders` | `orders.read` | `orders.write` |
| `order_items` | `orders.read` | `orders.write` (governed by the *parent order's* permission, via `order_items.organization_id` directly — never a join back to `orders`) |
| `daily_kpi_snapshots` | `finance.read` (revenue-sensitive) | none for `authenticated` — function-mediated only |
| `status_transitions` | any `authenticated` user (global, read-only rulebook) | none — migration-managed |

## Seed data

`supabase/seed.sql` pins every Phase 3A fixture to **2026-07-20**, not `now()`/`current_date`, so dashboard/KPI assertions in pgTAP and integration tests stay deterministic regardless of when the suite actually runs — tests pass this same date as `calculate_daily_kpi_snapshot()`'s / `get_dashboard_snapshot()`'s explicit `p_as_of`/`p_snapshot_date` argument instead of relying on "today". The seeded `daily_kpi_snapshots` rows are generated by calling the real function, not hand-computed, so seed data can never drift from what the function itself would produce.

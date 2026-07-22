-- Phase 3A: base table privileges for `authenticated` on the operational
-- tables. Same rationale as 20260721230008_table_grants.sql: RLS restricts
-- which rows, not whether the operation is even attempted — Postgres checks
-- ordinary GRANTs first.
--
-- orders and order_items additionally use *column-level* grants to enforce
-- money integrity (rule 4) at the privilege layer, not just by convention:
-- `authenticated` never receives INSERT/UPDATE on orders.subtotal/total or on
-- order_items.line_total (line_total is also a STORED generated column,
-- which Postgres refuses to accept a value for regardless of grants — the
-- column grant is omitted here for clarity, not because it would do
-- anything). This matters most for UPDATE: the recalculation trigger in
-- 20260722000003 only fires on `update of discount_total, tax_total,
-- delivery_fee` — a bare `update orders set subtotal = ...` would otherwise
-- never touch that trigger and would silently corrupt the total.

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.leads to authenticated;
grant select, insert, update, delete on public.reservations to authenticated;

grant select, delete on public.orders to authenticated;
grant insert (
  id, organization_id, location_id, lead_id, reservation_id, order_number,
  channel, fulfillment_type, customer_name, phone, discount_total, tax_total,
  delivery_fee, currency, requested_for, status, payment_status, notes,
  created_at, updated_at
) on public.orders to authenticated;
grant update (
  location_id, lead_id, reservation_id, order_number, channel,
  fulfillment_type, customer_name, phone, discount_total, tax_total,
  delivery_fee, currency, requested_for, status, payment_status, notes
) on public.orders to authenticated;

grant select, delete on public.order_items to authenticated;
grant insert (
  id, organization_id, order_id, item_name, item_sku, quantity, unit_price,
  metadata, created_at
) on public.order_items to authenticated;
grant update (item_name, item_sku, quantity, unit_price, metadata) on public.order_items to authenticated;

-- daily_kpi_snapshots: select-only for authenticated (see RLS policy);
-- written exclusively by the SECURITY DEFINER KPI snapshot function.
grant select on public.daily_kpi_snapshots to authenticated;

-- status_transitions: select-only, global read-only rulebook (see RLS
-- policy in 20260722000002) — migration-managed, no authenticated write.
grant select on public.status_transitions to authenticated;

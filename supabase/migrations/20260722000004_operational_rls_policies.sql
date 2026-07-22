-- Phase 3A: RLS for the operational tables (issue #16 scope B). Same
-- pattern as 20260721230006_rls_policies.sql: every table enabled + forced,
-- every policy derived from is_org_member()/has_permission() — never a route
-- slug or client-submitted organization_id.

-- leads ------------------------------------------------------------------

alter table public.leads enable row level security;
alter table public.leads force row level security;

create policy "leads_select_authorized" on public.leads
for select to authenticated
using (public.has_permission(organization_id, 'crm.read'));

create policy "leads_insert_authorized" on public.leads
for insert to authenticated
with check (public.has_permission(organization_id, 'crm.write'));

create policy "leads_update_authorized" on public.leads
for update to authenticated
using (public.has_permission(organization_id, 'crm.write'))
with check (public.has_permission(organization_id, 'crm.write'));

create policy "leads_delete_authorized" on public.leads
for delete to authenticated
using (public.has_permission(organization_id, 'crm.write'));

-- reservations -------------------------------------------------------------

alter table public.reservations enable row level security;
alter table public.reservations force row level security;

create policy "reservations_select_authorized" on public.reservations
for select to authenticated
using (public.has_permission(organization_id, 'reservations.read'));

create policy "reservations_insert_authorized" on public.reservations
for insert to authenticated
with check (public.has_permission(organization_id, 'reservations.write'));

create policy "reservations_update_authorized" on public.reservations
for update to authenticated
using (public.has_permission(organization_id, 'reservations.write'))
with check (public.has_permission(organization_id, 'reservations.write'));

create policy "reservations_delete_authorized" on public.reservations
for delete to authenticated
using (public.has_permission(organization_id, 'reservations.write'));

-- orders ---------------------------------------------------------------------

alter table public.orders enable row level security;
alter table public.orders force row level security;

create policy "orders_select_authorized" on public.orders
for select to authenticated
using (public.has_permission(organization_id, 'orders.read'));

create policy "orders_insert_authorized" on public.orders
for insert to authenticated
with check (public.has_permission(organization_id, 'orders.write'));

create policy "orders_update_authorized" on public.orders
for update to authenticated
using (public.has_permission(organization_id, 'orders.write'))
with check (public.has_permission(organization_id, 'orders.write'));

create policy "orders_delete_authorized" on public.orders
for delete to authenticated
using (public.has_permission(organization_id, 'orders.write'));

-- order_items ------------------------------------------------------------------
-- Governed by the parent order's permission (orders.read/orders.write), using
-- order_items' own denormalized organization_id — never a join back to
-- orders, so the policy stays a simple, fast has_permission() check.

alter table public.order_items enable row level security;
alter table public.order_items force row level security;

create policy "order_items_select_authorized" on public.order_items
for select to authenticated
using (public.has_permission(organization_id, 'orders.read'));

create policy "order_items_insert_authorized" on public.order_items
for insert to authenticated
with check (public.has_permission(organization_id, 'orders.write'));

create policy "order_items_update_authorized" on public.order_items
for update to authenticated
using (public.has_permission(organization_id, 'orders.write'))
with check (public.has_permission(organization_id, 'orders.write'));

create policy "order_items_delete_authorized" on public.order_items
for delete to authenticated
using (public.has_permission(organization_id, 'orders.write'));

-- daily_kpi_snapshots -----------------------------------------------------------
-- Revenue-bearing, so gated by finance.read (issue: "finance.read for
-- revenue-sensitive aggregate access where appropriate") rather than the
-- broader dashboard.read. No authenticated write policy at all: rows are
-- written exclusively by the SECURITY DEFINER KPI snapshot function
-- (20260722000006), mirroring the audit_logs append-only pattern.

alter table public.daily_kpi_snapshots enable row level security;
alter table public.daily_kpi_snapshots force row level security;

create policy "daily_kpi_snapshots_select_authorized" on public.daily_kpi_snapshots
for select to authenticated
using (public.has_permission(organization_id, 'finance.read'));

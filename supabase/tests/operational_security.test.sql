-- Phase 3A operational security suite (issue #16 scope H). Complements
-- rls_cross_tenant.test.sql: that file covers Phase 2's tenancy/RBAC
-- primitives, this one covers the new leads/reservations/orders/order_items/
-- daily_kpi_snapshots tables — permission-scoped RLS (not just org
-- membership), cross-tenant FK rejection via the composite-FK pattern,
-- status machine enforcement + audit trail, money integrity, KPI snapshot
-- idempotency, and the dashboard aggregate RPC's permission gating.
--
-- Run via `supabase test db` against the database seeded by seed.sql (fixed
-- operational data pinned to 2026-07-20 — see that file's own comment for
-- why a fixed date, not `now()`, is used throughout this suite).

create extension if not exists pgtap with schema extensions;

begin;
select plan(30);

-- Fixed seed UUIDs (see supabase/seed.sql).
-- BOSSA org:              00000000-0000-0000-0000-000000000001
-- Papai org:              00000000-0000-0000-0000-000000000002
-- BOSSA location:         00000000-0000-0000-0001-000000000001
-- Papai location:         00000000-0000-0000-0001-000000000002
-- owner@bossa.test:       00000000-0000-0000-0002-000000000001
-- staff@bossa.test:       00000000-0000-0000-0002-000000000002
-- owner@papai.test:       00000000-0000-0000-0002-000000000003
-- outsider@example.test:  00000000-0000-0000-0002-000000000004
-- BOSSA reservation R002: 00000000-0000-0000-0005-000000000002 (seeded 'pending')
-- BOSSA order 1 (paid):   00000000-0000-0000-0006-000000000001
-- BOSSA order 2 (pending):00000000-0000-0000-0006-000000000002

create or replace function pg_temp.authenticate_as(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$;

-- Runs p_sql and returns the caught error message, or null if it succeeded —
-- lets us assert on this project's "CODE: message" convention exactly,
-- without depending on a specific pgTAP throws_* variant being available.
create or replace function pg_temp.expect_error_message(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- 1-2: permission-scoped SELECT is narrower than plain org membership — BOSSA
-- staff belongs to BOSSA but has no crm.read, so leads are invisible to them
-- even though orders (which staff does have orders.read for) are visible.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select is(
  (select count(*)::int from public.leads where organization_id = '00000000-0000-0000-0000-000000000001'),
  3,
  'BOSSA owner (crm.read) sees all 3 seeded BOSSA leads'
);

select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000002');
select is(
  (select count(*)::int from public.leads where organization_id = '00000000-0000-0000-0000-000000000001'),
  0,
  'BOSSA staff (no crm.read) sees zero BOSSA leads despite active membership'
);
select is(
  (select count(*)::int from public.orders where organization_id = '00000000-0000-0000-0000-000000000001'),
  2,
  'BOSSA staff (orders.read) does see BOSSA orders'
);

-- 3: BOSSA staff cannot write an order (lacks orders.write).
select throws_ok(
  $$ insert into public.orders (organization_id, location_id, order_number, channel, fulfillment_type, customer_name)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'BOSSA-9001', 'dine_in', 'dine_in', 'Test') $$,
  '42501',
  null::text,
  'BOSSA staff cannot insert an order (lacks orders.write)'
);

-- 4: BOSSA staff cannot change a lead's status either (crm.write required by
-- RLS on the UPDATE itself, independent of the status-transition trigger).
-- Unlike INSERT's WITH CHECK (which raises 42501 outright — see test 3
-- above and test 6/7 below), an UPDATE's USING clause makes the row
-- invisible before the statement can touch it: the UPDATE succeeds but
-- affects zero rows, exactly the "cross-tenant/unauthorized UPDATE is a
-- silent no-op" behavior already documented in docs/SECURITY_MODEL.md and
-- exercised the same way in rls_cross_tenant.test.sql.
with attempted as (
  update public.leads set status = 'contacted'
  where id = '00000000-0000-0000-0004-000000000001'
  returning id
)
select is(
  count(*)::int, 0, 'BOSSA staff cannot update a lead status (lacks crm.write) — zero rows affected'
) from attempted;

-- 5: the owner (crm.write) can create a lead in their own org.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select lives_ok(
  $$ insert into public.leads (organization_id, lead_type, source, contact_name, phone)
     values ('00000000-0000-0000-0000-000000000001', 'general', 'phone', 'PgTAP Test Lead', '+5990000000') $$,
  'BOSSA owner can insert a lead in their own organization'
);

-- 6: ...but not into Papai (cross-tenant INSERT denied by RLS, same as
-- every other tenant-owned table).
select throws_ok(
  $$ insert into public.leads (organization_id, lead_type, source, contact_name, phone)
     values ('00000000-0000-0000-0000-000000000002', 'general', 'phone', 'Forged', '+5990000000') $$,
  '42501',
  null::text,
  'BOSSA owner cannot insert a lead into Papai'
);

-- 7: order_items cannot reference a cross-tenant order — the composite FK
-- (organization_id, order_id) references orders(organization_id, id) fails
-- because no BOSSA order exists under the Papai organization_id supplied.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000003');
select throws_ok(
  format(
    $$ insert into public.order_items (organization_id, order_id, item_name, quantity, unit_price)
       values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0006-000000000001', 'Forged item', 1, 1.00) $$
  ),
  '23503',
  null::text,
  'A Papai-scoped order_item cannot reference a BOSSA order (composite FK rejects the cross-tenant reference)'
);

-- 8: reservations.location_id must belong to the same organization — the
-- composite FK rejects a BOSSA reservation pointed at Papai's location.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select throws_ok(
  $$ insert into public.reservations (organization_id, location_id, confirmation_code, guest_name, phone, party_size, reservation_at, source)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000002', 'BOSSA-BAD', 'Test', '+5990000000', 2, now(), 'phone') $$,
  '23503',
  null::text,
  'A BOSSA reservation cannot reference Papai''s location (composite FK rejects the org mismatch)'
);

-- 9-11: status machine — a legal transition succeeds, is audited exactly
-- once, and an illegal reverse transition is rejected with this project's
-- typed "INVALID_STATUS_TRANSITION:" message.
select lives_ok(
  $$ update public.reservations set status = 'confirmed' where id = '00000000-0000-0000-0005-000000000002' $$,
  'BOSSA owner can move reservation R002 pending -> confirmed (legal transition)'
);
select is(
  (select count(*)::int from public.audit_logs
   where entity_type = 'reservation' and entity_id = '00000000-0000-0000-0005-000000000002' and action = 'reservation.status_changed'),
  1,
  'Exactly one audit_logs row was written for that transition, by the trigger, not the (nonexistent, in this pgTAP context) service layer'
);
select is(
  pg_temp.expect_error_message(
    $$ update public.reservations set status = 'pending' where id = '00000000-0000-0000-0005-000000000002' $$
  ),
  'INVALID_STATUS_TRANSITION: reservation_status cannot go from "confirmed" to "pending"',
  'Reversing confirmed -> pending is rejected with the typed INVALID_STATUS_TRANSITION message'
);

-- 12-13: re-setting a status to its current value is a no-op for both the
-- transition check (old = new is never validated against the rulebook) and
-- the audit trigger (no second audit_logs row gets written for it).
select lives_ok(
  $$ update public.reservations set status = 'confirmed' where id = '00000000-0000-0000-0005-000000000002' $$,
  'Re-setting a reservation to its current status is always allowed'
);
select is(
  (select count(*)::int from public.audit_logs
   where entity_type = 'reservation' and entity_id = '00000000-0000-0000-0005-000000000002' and action = 'reservation.status_changed'),
  1,
  'Re-setting the same status did not write a second audit_logs row'
);

-- 13: global status_transitions rulebook is readable by any authenticated
-- user (needed by the app layer to render valid next-status options).
select ok(
  (select count(*)::int from public.status_transitions where machine = 'order_status') >= 7,
  'Any authenticated user can read the order_status transition rulebook'
);

-- 14-15: money integrity — the seeded BOSSA order's subtotal/total already
-- reflect its two order_items (2x28.00 + 1x6.50 = 62.50; +5.00 tax = 67.50),
-- computed entirely by the database, never supplied by seed.sql directly.
select is(
  (select subtotal from public.orders where id = '00000000-0000-0000-0006-000000000001'),
  62.50::numeric(12,2),
  'BOSSA order 1 subtotal was computed from its order_items, not hand-seeded'
);
select is(
  (select total from public.orders where id = '00000000-0000-0000-0006-000000000001'),
  67.50::numeric(12,2),
  'BOSSA order 1 total = subtotal - discount + tax + delivery, computed by the database'
);

-- 16: a client cannot set orders.subtotal directly — no UPDATE grant on that
-- column exists for `authenticated` (20260722000005), so this fails before
-- any trigger even runs.
select throws_ok(
  $$ update public.orders set subtotal = 999.99 where id = '00000000-0000-0000-0006-000000000001' $$,
  '42501',
  null::text,
  'A client cannot directly set orders.subtotal (no column grant)'
);

-- 17: adding an order item transactionally recalculates the parent order's
-- subtotal/total (BOSSA order 2 starts at one $32.00 item + $2.56 tax = $34.56).
select lives_ok(
  $$ insert into public.order_items (organization_id, order_id, item_name, quantity, unit_price)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0006-000000000002', 'Fried Plantains', 2, 5.00) $$,
  'BOSSA owner can add an item to their own order'
);
select is(
  (select subtotal from public.orders where id = '00000000-0000-0000-0006-000000000002'),
  42.00::numeric(12,2),
  'Adding the item recalculated subtotal to 32.00 + (2 x 5.00) = 42.00'
);
select is(
  (select total from public.orders where id = '00000000-0000-0000-0006-000000000002'),
  44.56::numeric(12,2),
  'Adding the item recalculated total to the new subtotal + the unchanged 2.56 tax'
);

-- 18: KPI snapshot generation is idempotent — calling it twice for the same
-- (organization, null location, date) upserts the same row rather than
-- inserting a second one (seed.sql already called it once for this org/date).
-- Wrapped in a DO block purely so the composite return value never prints
-- into the TAP output stream — this call is for its side effect only.
do $$ begin perform public.calculate_daily_kpi_snapshot('00000000-0000-0000-0000-000000000001'::uuid, '2026-07-20'::date, null); end $$;
select is(
  (select count(*)::int from public.daily_kpi_snapshots
   where organization_id = '00000000-0000-0000-0000-000000000001' and location_id is null and snapshot_date = '2026-07-20'),
  1,
  'Calling calculate_daily_kpi_snapshot twice for the same day still leaves exactly one row'
);
select is(
  (select revenue from public.daily_kpi_snapshots
   where organization_id = '00000000-0000-0000-0000-000000000001' and location_id is null and snapshot_date = '2026-07-20'),
  67.50::numeric(12,2),
  'Revenue only counts the one completed order that day (67.50), unaffected by the still-pending order 2'
);

-- 19-21: dashboard aggregate RPC permission gating (finance.read gates
-- revenue-shaped fields; dashboard.read gates the call at all).
select ok(
  (public.get_dashboard_snapshot('00000000-0000-0000-0000-000000000001', '2026-07-20 18:00:00+00'::timestamptz) ->> 'revenue_today') is not null,
  'BOSSA owner (finance.read) sees a non-null revenue_today from get_dashboard_snapshot'
);

select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000002');
select is(
  public.get_dashboard_snapshot('00000000-0000-0000-0000-000000000001', '2026-07-20 18:00:00+00'::timestamptz) -> 'revenue_today',
  'null'::jsonb,
  'BOSSA staff (no finance.read) gets a null revenue_today, never a fabricated number'
);
select is(
  (public.get_dashboard_snapshot('00000000-0000-0000-0000-000000000001', '2026-07-20 18:00:00+00'::timestamptz) ->> 'orders_today')::int,
  2,
  'BOSSA staff still sees the non-revenue orders_today figure'
);

select is(
  (public.get_dashboard_snapshot('00000000-0000-0000-0000-000000000001', '2026-07-20 18:00:00+00'::timestamptz) ->> 'active_orders')::int,
  1,
  'BOSSA active_orders counts the one seeded non-terminal order'
);

select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
insert into public.orders (id, organization_id, location_id, order_number, channel, fulfillment_type, customer_name, status, payment_status, created_at) values
  ('00000000-0000-0000-0006-000000009001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'BOSSA-PGTAP-COMPLETE', 'takeout', 'pickup', 'Completed PgTAP', 'completed', 'paid', '2026-07-20 14:00+00'),
  ('00000000-0000-0000-0006-000000009002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'BOSSA-PGTAP-CANCELLED', 'takeout', 'pickup', 'Cancelled PgTAP', 'cancelled', 'unpaid', '2026-07-20 14:05+00');
select is(
  (public.get_dashboard_snapshot('00000000-0000-0000-0000-000000000001', '2026-07-20 18:00:00+00'::timestamptz) ->> 'active_orders')::int,
  1,
  'completed and cancelled BOSSA orders are excluded from active_orders'
);

select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000003');
select is(
  (public.get_dashboard_snapshot('00000000-0000-0000-0000-000000000002', '2026-07-20 18:00:00+00'::timestamptz) ->> 'active_orders')::int,
  0,
  'Papai active_orders excludes completed orders and stays tenant-scoped'
);

select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000004');
select ok(
  pg_temp.expect_error_message(
    $$ select public.get_dashboard_snapshot('00000000-0000-0000-0000-000000000001', now()) $$
  ) like 'PERMISSION_DENIED:%',
  'An outsider with no BOSSA membership at all is rejected by get_dashboard_snapshot with PERMISSION_DENIED'
);

select * from finish();
rollback;

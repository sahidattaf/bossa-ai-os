-- Phase 3A: money integrity (issue #16 rule 4). order_items.line_total is
-- already a STORED generated column (20260722000001) — Postgres itself
-- refuses any INSERT/UPDATE that names that column. This migration covers
-- the other half: orders.subtotal and orders.total are *derived* values that
-- must always equal sum(order_items.line_total) and
-- subtotal - discount_total + tax_total + delivery_fee, respectively, and
-- must recompute transactionally whenever an item or a fee field changes.
-- 20260722000005 additionally revokes UPDATE(subtotal, total) from
-- `authenticated` entirely, so no direct client write can desync them even
-- before a trigger would recompute over it.

-- Recomputes one order's subtotal/total from its current order_items. Used
-- both by the order_items trigger below and available for ad-hoc repair.
create or replace function public.recalculate_order_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal numeric(12, 2);
begin
  select coalesce(sum(line_total), 0) into v_subtotal
  from public.order_items
  where order_id = p_order_id;

  update public.orders
  set subtotal = v_subtotal,
      total = v_subtotal - discount_total + tax_total + delivery_fee
  where id = p_order_id;
end;
$$;

revoke all on function public.recalculate_order_totals(uuid) from public;

comment on function public.recalculate_order_totals(uuid) is
  'Recomputes orders.subtotal/total from order_items. SECURITY DEFINER so it can write orders.subtotal/total regardless of the authenticated column-grant restriction in 20260722000005.';

create or replace function public.trigger_recalculate_order_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.recalculate_order_totals(coalesce(new.order_id, old.order_id));
  return coalesce(new, old);
end;
$$;

revoke all on function public.trigger_recalculate_order_totals() from public;

drop trigger if exists recalculate_order_totals_on_item_change on public.order_items;
create trigger recalculate_order_totals_on_item_change
after insert or update or delete on public.order_items
for each row execute function public.trigger_recalculate_order_totals();

-- Keeps `total` consistent whenever the fee fields change directly on the
-- order (no order_items involved), and gives a freshly inserted order a
-- correct total even before any order_items exist (subtotal forced to 0 on
-- INSERT — items, added afterward in the same transaction by the service
-- layer, trigger the recalculation above).
create or replace function public.recalculate_order_total_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.subtotal := 0;
  end if;

  new.total := new.subtotal - new.discount_total + new.tax_total + new.delivery_fee;
  return new;
end;
$$;

revoke all on function public.recalculate_order_total_fields() from public;

drop trigger if exists recalculate_order_total_fields on public.orders;
create trigger recalculate_order_total_fields
before insert or update of discount_total, tax_total, delivery_fee on public.orders
for each row execute function public.recalculate_order_total_fields();

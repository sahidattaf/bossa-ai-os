-- Issue #25: extend the existing dashboard aggregate with a real active-order
-- count. Active means the canonical non-terminal order_status values from
-- public.status_transitions: pending, confirmed, preparing, ready, and
-- out_for_delivery. completed and cancelled remain terminal and excluded.
create or replace function public.get_dashboard_snapshot(
  p_organization_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_has_finance boolean;
  v_as_of_date date := p_as_of::date;
  v_revenue_today numeric(12, 2) := 0;
  v_orders_today integer := 0;
  v_active_orders integer := 0;
  v_orders_cancelled_today integer := 0;
  v_reservations_tonight integer := 0;
  v_reservations_capacity_tonight integer := 0;
  v_reservations_no_show_today integer := 0;
  v_unanswered_leads integer := 0;
  v_new_leads_today integer := 0;
  v_average_ticket numeric(12, 2) := 0;
begin
  if not public.has_permission(p_organization_id, 'dashboard.read') then
    raise exception 'PERMISSION_DENIED: dashboard.read is required for organization %', p_organization_id;
  end if;

  v_has_finance := public.has_permission(p_organization_id, 'finance.read');

  select
    count(*),
    coalesce(sum((status = 'cancelled')::int), 0)
  into v_orders_today, v_orders_cancelled_today
  from public.orders
  where organization_id = p_organization_id
    and created_at::date = v_as_of_date;

  select count(*)
  into v_active_orders
  from public.orders
  where organization_id = p_organization_id
    and status in (
      select distinct from_status
      from public.status_transitions
      where machine = 'order_status'
    );

  select
    count(*),
    coalesce(sum(party_size), 0)
  into v_reservations_tonight, v_reservations_capacity_tonight
  from public.reservations
  where organization_id = p_organization_id
    and reservation_at::date = v_as_of_date
    and status not in ('cancelled', 'no_show');

  select count(*)
  into v_reservations_no_show_today
  from public.reservations
  where organization_id = p_organization_id
    and reservation_at::date = v_as_of_date
    and status = 'no_show';

  select
    count(*) filter (where status = 'new'),
    count(*)
  into v_unanswered_leads, v_new_leads_today
  from public.leads
  where organization_id = p_organization_id
    and created_at::date = v_as_of_date;

  if v_has_finance then
    select coalesce(sum(total), 0)
    into v_revenue_today
    from public.orders
    where organization_id = p_organization_id
      and status = 'completed'
      and created_at::date = v_as_of_date;

    v_average_ticket := case when v_orders_today > 0 then round(v_revenue_today / v_orders_today, 2) else 0 end;
  end if;

  return jsonb_build_object(
    'as_of', p_as_of,
    'orders_today', v_orders_today,
    'active_orders', v_active_orders,
    'orders_cancelled_today', v_orders_cancelled_today,
    'reservations_tonight', v_reservations_tonight,
    'reservations_capacity_tonight', v_reservations_capacity_tonight,
    'reservations_no_show_today', v_reservations_no_show_today,
    'new_leads_today', v_new_leads_today,
    'unanswered_leads', v_unanswered_leads,
    'finance_visible', v_has_finance,
    'revenue_today', case when v_has_finance then to_jsonb(v_revenue_today) else 'null'::jsonb end,
    'average_ticket_today', case when v_has_finance then to_jsonb(v_average_ticket) else 'null'::jsonb end
  );
end;
$$;

revoke all on function public.get_dashboard_snapshot(uuid, timestamptz) from public;
grant execute on function public.get_dashboard_snapshot(uuid, timestamptz) to authenticated;

comment on function public.get_dashboard_snapshot(uuid, timestamptz) is
  'SECURITY INVOKER dashboard aggregate snapshot. Requires dashboard.read; revenue_today/average_ticket_today are null unless the caller also has finance.read. active_orders counts canonical non-terminal order statuses: pending, confirmed, preparing, ready, out_for_delivery.';

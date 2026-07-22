-- Phase 3A: live dashboard aggregate RPC (issue #16 scope E, architecture
-- decision #3). One SECURITY INVOKER function computing every "today"/
-- "tonight" aggregate SupabaseDashboardDataProvider needs, in a small fixed
-- number of aggregate queries (never N+1). SECURITY INVOKER (the default,
-- stated explicitly) means every query inside runs as the calling user and
-- is still bounded by each table's own RLS — this function is an additional,
-- narrower gate (dashboard.read to call it at all, finance.read to see
-- revenue-shaped numbers), never a bypass of RLS the way a SECURITY DEFINER
-- function would be.
--
-- p_as_of makes "today"/"tonight" a deterministic parameter instead of an
-- implicit now() baked into the query, so the same function is reusable for
-- historical backfill/testing without needing a second code path.
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
  'SECURITY INVOKER dashboard aggregate snapshot. Requires dashboard.read; revenue_today/average_ticket_today are null unless the caller also has finance.read. See lib/dashboard/supabase-provider.ts.';

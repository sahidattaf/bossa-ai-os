-- Phase 4A: fact-gathering for the deterministic rule engine. One
-- SECURITY INVOKER RPC, mirroring get_dashboard_snapshot()'s shape exactly —
-- runs as the caller (RLS still applies to every query inside it), gated by
-- dashboard.read's AI-Executive analogue (ai.executive.read), a small fixed
-- number of queries (never N+1).
--
-- Threshold *decisions* (how old is "aging", how many minutes is "delayed",
-- what revenue counts as "below target") deliberately do NOT live here —
-- they're read from ai_rule_configs and applied by the pure TypeScript rule
-- functions in lib/ai/rules/*.ts, so changing a threshold never requires a
-- migration. The lookback windows below (30/14/3 days) are generous
-- performance/data-volume bounds only, not business thresholds — they exist
-- so this function never has to scan a tenant's entire history, not to
-- pre-decide what counts as "stale".
create or replace function public.get_ai_evaluation_facts(
  p_organization_id uuid,
  p_as_of timestamptz default now(),
  p_location_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.has_permission(p_organization_id, 'ai.executive.read') then
    raise exception 'PERMISSION_DENIED: ai.executive.read is required for organization %', p_organization_id;
  end if;

  select jsonb_build_object(
    'as_of', p_as_of,
    -- Feeds both "unanswered leads" (status = new) and "aging leads without
    -- owner" (owner_user_id is null, any open status) — the TS rule layer
    -- computes age itself from created_at against its own configured threshold.
    'open_leads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'contact_name', contact_name, 'created_at', created_at,
        'status', status, 'owner_user_id', owner_user_id, 'location_id', location_id
      ))
      from public.leads
      where organization_id = p_organization_id
        and status in ('new', 'contacted')
        and created_at >= p_as_of - interval '30 days'
        and (p_location_id is null or location_id = p_location_id)
    ), '[]'::jsonb),

    'reservations_tonight', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'party_size', party_size, 'reservation_at', reservation_at,
        'status', status, 'location_id', location_id
      ))
      from public.reservations
      where organization_id = p_organization_id
        and reservation_at::date = p_as_of::date
        and status not in ('cancelled', 'no_show')
        and (p_location_id is null or location_id = p_location_id)
    ), '[]'::jsonb),

    -- Recent attrition (cancelled/no_show), generously bounded to 14 days —
    -- the rule layer applies whatever window its config actually specifies.
    'recent_reservation_attrition', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'reservation_at', reservation_at, 'location_id', location_id))
      from public.reservations
      where organization_id = p_organization_id
        and status in ('cancelled', 'no_show')
        and reservation_at >= p_as_of - interval '14 days'
        and (p_location_id is null or location_id = p_location_id)
    ), '[]'::jsonb),

    -- Unpaid and/or stuck-in-kitchen orders, bounded to 3 days — an order
    -- older than that lingering unpaid/undelivered is already a bigger
    -- problem than a threshold rule needs to catch.
    'open_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'order_number', order_number, 'status', status, 'payment_status', payment_status,
        'total', total, 'created_at', created_at, 'updated_at', updated_at, 'location_id', location_id
      ))
      from public.orders
      where organization_id = p_organization_id
        and status not in ('completed', 'cancelled')
        and created_at >= p_as_of - interval '3 days'
        and (p_location_id is null or location_id = p_location_id)
    ), '[]'::jsonb),

    'latest_kpi_snapshot', (
      select to_jsonb(s) from public.daily_kpi_snapshots s
      where organization_id = p_organization_id
        and ((p_location_id is null and s.location_id is null) or s.location_id = p_location_id)
      order by snapshot_date desc
      limit 1
    ),

    'today_kpi_snapshot', (
      select to_jsonb(s) from public.daily_kpi_snapshots s
      where organization_id = p_organization_id
        and snapshot_date = p_as_of::date
        and ((p_location_id is null and s.location_id is null) or s.location_id = p_location_id)
      limit 1
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_ai_evaluation_facts(uuid, timestamptz, uuid) from public;
grant execute on function public.get_ai_evaluation_facts(uuid, timestamptz, uuid) to authenticated;

-- Phase 3A: idempotent daily KPI snapshot calculation (issue #16 scope F).
-- Safe to rerun for the same (organization, location, date) any number of
-- times — it always fully recomputes and upserts, never accumulates. No
-- Vercel Cron / Supabase scheduled job is enabled in this phase (explicit
-- architecture decision); invocation is manual only — see
-- docs/KPI_SNAPSHOT_OPERATIONS.md and scripts/generate-kpi-snapshots.ts.
--
-- p_location_id = null computes an organization-wide rollup snapshot (all
-- locations combined); a specific location_id computes a per-location one.
-- Both are legal rows under the expression unique index from
-- 20260722000001 (coalesce(location_id, all-zero sentinel)).
create or replace function public.calculate_daily_kpi_snapshot(
  p_organization_id uuid,
  p_snapshot_date date default current_date,
  p_location_id uuid default null
)
returns public.daily_kpi_snapshots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revenue numeric(12, 2);
  v_order_count integer;
  v_cancellation_count integer;
  v_reservation_count integer;
  v_covers integer;
  v_no_show_count integer;
  v_new_leads integer;
  v_unanswered_leads integer;
  v_average_ticket numeric(12, 2);
  v_result public.daily_kpi_snapshots;
begin
  -- Invoked either by an authenticated user with finance.read (an in-app
  -- "regenerate today's snapshot" action) or by a trusted service-role
  -- script/job with no JWT at all (auth.uid() is null in that context) — see
  -- docs/KPI_SNAPSHOT_OPERATIONS.md for the manual invocation path.
  if auth.uid() is not null and not public.has_permission(p_organization_id, 'finance.read') then
    raise exception 'PERMISSION_DENIED: finance.read is required to generate KPI snapshots for organization %', p_organization_id;
  end if;

  -- Revenue and order_count count only completed orders *created* that date;
  -- cancellations are counted separately and never contribute to revenue.
  select coalesce(sum(total), 0), count(*)
  into v_revenue, v_order_count
  from public.orders
  where organization_id = p_organization_id
    and (p_location_id is null or location_id = p_location_id)
    and status = 'completed'
    and created_at::date = p_snapshot_date;

  select count(*) into v_cancellation_count
  from public.orders
  where organization_id = p_organization_id
    and (p_location_id is null or location_id = p_location_id)
    and status = 'cancelled'
    and created_at::date = p_snapshot_date;

  -- Reservation/covers/no-show figures key off reservation_at (the date of
  -- service), not created_at (the date the booking was made).
  select coalesce(sum(party_size), 0), count(*)
  into v_covers, v_reservation_count
  from public.reservations
  where organization_id = p_organization_id
    and (p_location_id is null or location_id = p_location_id)
    and reservation_at::date = p_snapshot_date
    and status not in ('cancelled', 'no_show');

  select count(*) into v_no_show_count
  from public.reservations
  where organization_id = p_organization_id
    and (p_location_id is null or location_id = p_location_id)
    and reservation_at::date = p_snapshot_date
    and status = 'no_show';

  select count(*) into v_new_leads
  from public.leads
  where organization_id = p_organization_id
    and (p_location_id is null or location_id = p_location_id)
    and created_at::date = p_snapshot_date;

  -- "Unanswered" = still sitting in the initial `new` status as of now, for
  -- leads that came in on the snapshot date.
  select count(*) into v_unanswered_leads
  from public.leads
  where organization_id = p_organization_id
    and (p_location_id is null or location_id = p_location_id)
    and created_at::date = p_snapshot_date
    and status = 'new';

  v_average_ticket := case when v_order_count > 0 then round(v_revenue / v_order_count, 2) else 0 end;

  insert into public.daily_kpi_snapshots (
    organization_id, location_id, snapshot_date, revenue, order_count,
    reservation_count, covers, new_leads, unanswered_leads, average_ticket,
    cancellation_count, no_show_count, metadata, generated_at
  ) values (
    p_organization_id, p_location_id, p_snapshot_date, v_revenue, v_order_count,
    v_reservation_count, v_covers, v_new_leads, v_unanswered_leads, v_average_ticket,
    v_cancellation_count, v_no_show_count, '{}'::jsonb, now()
  )
  on conflict (organization_id, (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)), snapshot_date)
  do update set
    revenue = excluded.revenue,
    order_count = excluded.order_count,
    reservation_count = excluded.reservation_count,
    covers = excluded.covers,
    new_leads = excluded.new_leads,
    unanswered_leads = excluded.unanswered_leads,
    average_ticket = excluded.average_ticket,
    cancellation_count = excluded.cancellation_count,
    no_show_count = excluded.no_show_count,
    generated_at = now()
  returning * into v_result;

  if auth.uid() is not null then
    perform public.record_audit_event(
      p_organization_id,
      'kpi_snapshot.generated',
      'daily_kpi_snapshot',
      v_result.id,
      jsonb_build_object('snapshot_date', p_snapshot_date, 'location_id', p_location_id)
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.calculate_daily_kpi_snapshot(uuid, date, uuid) from public;
grant execute on function public.calculate_daily_kpi_snapshot(uuid, date, uuid) to authenticated;

comment on function public.calculate_daily_kpi_snapshot(uuid, date, uuid) is
  'Idempotent upsert of one daily_kpi_snapshots row. Manual invocation only — see docs/KPI_SNAPSHOT_OPERATIONS.md.';

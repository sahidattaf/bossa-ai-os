-- BOSSA AI OS safe input write flow
-- Only authenticated allowed operators can write KPI, decision, and weekly brief rows.
-- After applying this migration, add allowed operators in Supabase SQL Editor:
-- insert into private.bossa_operator_emails (email, role)
-- values ('your-email@example.com', 'owner')
-- on conflict (email) do update set role = excluded.role;

create schema if not exists private;

create table if not exists private.bossa_operator_emails (
  email text primary key,
  role text default 'operator',
  created_at timestamp with time zone default now()
);

revoke all on schema private from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;

-- Private helper used by RLS policies only. Kept outside exposed public schema.
create or replace function private.is_bossa_operator()
returns boolean
language sql
security definer
set search_path = private, auth
as $$
  select exists (
    select 1
    from private.bossa_operator_emails allowed
    where lower(allowed.email) = lower(coalesce(auth.email(), ''))
  );
$$;

create or replace function public.set_created_by_from_auth()
returns trigger
language plpgsql
set search_path = public, auth
as $$
begin
  if new.created_by is null then
    new.created_by = auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_kpi_daily_created_by on public.kpi_daily;
create trigger set_kpi_daily_created_by
before insert on public.kpi_daily
for each row execute function public.set_created_by_from_auth();

drop trigger if exists set_decision_log_created_by on public.decision_log;
create trigger set_decision_log_created_by
before insert on public.decision_log
for each row execute function public.set_created_by_from_auth();

drop trigger if exists set_weekly_briefs_created_by on public.weekly_briefs;
create trigger set_weekly_briefs_created_by
before insert on public.weekly_briefs
for each row execute function public.set_created_by_from_auth();

-- KPI daily write policies
drop policy if exists "operator_insert_kpi_daily" on public.kpi_daily;
create policy "operator_insert_kpi_daily"
on public.kpi_daily
for insert
to authenticated
with check (private.is_bossa_operator());

drop policy if exists "operator_update_kpi_daily" on public.kpi_daily;
create policy "operator_update_kpi_daily"
on public.kpi_daily
for update
to authenticated
using (private.is_bossa_operator())
with check (private.is_bossa_operator());

-- Decision log write policies
drop policy if exists "operator_insert_decision_log" on public.decision_log;
create policy "operator_insert_decision_log"
on public.decision_log
for insert
to authenticated
with check (private.is_bossa_operator());

drop policy if exists "operator_update_decision_log" on public.decision_log;
create policy "operator_update_decision_log"
on public.decision_log
for update
to authenticated
using (private.is_bossa_operator())
with check (private.is_bossa_operator());

-- Weekly brief write policies
drop policy if exists "operator_insert_weekly_briefs" on public.weekly_briefs;
create policy "operator_insert_weekly_briefs"
on public.weekly_briefs
for insert
to authenticated
with check (private.is_bossa_operator());

drop policy if exists "operator_update_weekly_briefs" on public.weekly_briefs;
create policy "operator_update_weekly_briefs"
on public.weekly_briefs
for update
to authenticated
using (private.is_bossa_operator())
with check (private.is_bossa_operator());

drop function if exists public.is_bossa_operator();

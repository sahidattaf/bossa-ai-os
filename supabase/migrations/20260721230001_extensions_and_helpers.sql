-- Phase 2 foundation: extensions and shared helpers.

create extension if not exists pgcrypto;

-- Shared updated_at trigger, reused by every table below that has the column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Generic BEFORE UPDATE trigger that stamps updated_at = now().';

-- Small allowlist giving a user cross-organization "platform_admin" access.
-- Deliberately separate from organization_memberships: platform admin is not
-- scoped to any one tenant. Writable only by service_role (no authenticated
-- INSERT/UPDATE/DELETE policy is ever granted on this table).
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Cross-organization administrators. Membership managed by service_role only.';

-- Phase 2: append-only audit log. organization_id is nullable to allow
-- platform-level entries (e.g. a platform admin action not scoped to one
-- org); every org-scoped entry must carry it.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_organization_id on public.audit_logs(organization_id);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at desc);

comment on table public.audit_logs is
  'Append-only. No authenticated UPDATE/DELETE policy exists anywhere. Rows are written exclusively through record_audit_event().';

-- The only sanctioned way to write an audit row: validates the actor
-- actually belongs to the organization they're logging against, then
-- inserts with definer privileges (authenticated has no direct INSERT
-- policy on audit_logs at all — see 20260721230006_rls_policies.sql).
create or replace function public.record_audit_event(
  p_organization_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_organization_id is not null and not public.is_org_member(p_organization_id) then
    raise exception 'Cannot record an audit event for an organization you do not belong to';
  end if;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_audit_event(uuid, text, text, uuid, jsonb) from public;
grant execute on function public.record_audit_event(uuid, text, text, uuid, jsonb) to authenticated;

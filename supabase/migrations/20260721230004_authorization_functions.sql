-- Phase 2: membership/permission resolution functions used by every RLS
-- policy in 20260721230006_rls_policies.sql, plus the ownership safeguard.
-- Both functions are STABLE + SECURITY DEFINER with an explicit search_path
-- (rule: least privilege, no implicit schema resolution).

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
    or exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = p_organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    );
$$;

comment on function public.is_org_member(uuid) is
  'True if the current authenticated user has an active membership in the organization, or is a platform admin.';

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;

create or replace function public.has_permission(p_organization_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
    or exists (
      select 1
      from public.organization_memberships m
      join public.membership_roles mr on mr.membership_id = m.id
      join public.role_permissions rp on rp.role_id = mr.role_id
      join public.permissions p on p.id = rp.permission_id
      where m.organization_id = p_organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and p.key = p_permission_key
    );
$$;

comment on function public.has_permission(uuid, text) is
  'True if the current authenticated user holds the given permission key in the organization via an active membership role, or is a platform admin.';

revoke all on function public.has_permission(uuid, text) from public;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- Immutable organization ownership safeguard: an organization must always
-- keep at least one active organization_owner. Blocks the DELETE or the
-- role-changing UPDATE that would remove the last one.
create or replace function public.protect_last_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_role_id uuid;
  v_remaining_owners int;
begin
  select id into v_owner_role_id from public.roles where key = 'organization_owner';

  if old.role_id is distinct from v_owner_role_id then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.role_id = old.role_id then
    return new;
  end if;

  select count(*) into v_remaining_owners
  from public.membership_roles mr
  join public.organization_memberships m on m.id = mr.membership_id
  where mr.organization_id = old.organization_id
    and mr.role_id = v_owner_role_id
    and m.status = 'active'
    and mr.id <> old.id;

  if v_remaining_owners = 0 then
    raise exception 'Cannot remove the last active organization_owner from organization %', old.organization_id;
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.protect_last_organization_owner() from public;

drop trigger if exists protect_last_organization_owner on public.membership_roles;
create trigger protect_last_organization_owner
before update or delete on public.membership_roles
for each row execute function public.protect_last_organization_owner();

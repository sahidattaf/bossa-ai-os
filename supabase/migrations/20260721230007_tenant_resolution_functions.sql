-- Phase 2: two narrow, deliberate RPCs the app layer needs to resolve a
-- tenant correctly and distinguish "unknown organization" (404) from
-- "known organization, no active membership" (permission state) — a plain
-- RLS-scoped SELECT can't tell those apart, since RLS just returns zero
-- rows either way. See docs/SECURITY_MODEL.md for the reasoning.

-- Exposes ONLY {id, slug, name} for ANY organization to any authenticated
-- user, regardless of membership. This is a conscious, narrow exception to
-- "access comes from membership": an organization's existence and display
-- name are not tenant-sensitive (comparable to a company name being
-- publicly knowable); no operational or configuration data is exposed here.
create or replace function public.get_organization_summary(p_slug text)
returns table (id uuid, slug text, name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.slug, o.name
  from public.organizations o
  where o.slug = p_slug;
$$;

revoke all on function public.get_organization_summary(text) from public;
grant execute on function public.get_organization_summary(text) to authenticated;

-- The current user's effective permission keys within one organization.
-- Platform admins get the wildcard "*", matching lib/widgets/permissions.ts's
-- hasPermission() convention already established in Phase 1.
create or replace function public.get_my_permissions(p_organization_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_platform_admin boolean;
  v_permissions text[];
begin
  select exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
    into v_is_platform_admin;

  if v_is_platform_admin then
    return array['*'];
  end if;

  select coalesce(array_agg(distinct p.key), array[]::text[])
  into v_permissions
  from public.organization_memberships m
  join public.membership_roles mr on mr.membership_id = m.id
  join public.role_permissions rp on rp.role_id = mr.role_id
  join public.permissions p on p.id = rp.permission_id
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid()
    and m.status = 'active';

  return v_permissions;
end;
$$;

revoke all on function public.get_my_permissions(uuid) from public;
grant execute on function public.get_my_permissions(uuid) to authenticated;

-- The current user's role display names within one organization (for UI
-- labels like "General Manager" — not used for any access decision).
create or replace function public.get_my_role_names(p_organization_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct r.name), array[]::text[])
  from public.organization_memberships m
  join public.membership_roles mr on mr.membership_id = m.id
  join public.roles r on r.id = mr.role_id
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid()
    and m.status = 'active';
$$;

revoke all on function public.get_my_role_names(uuid) from public;
grant execute on function public.get_my_role_names(uuid) to authenticated;

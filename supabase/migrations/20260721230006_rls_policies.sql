-- Phase 2: Row-Level Security. Every table below gets RLS enabled AND
-- forced. Access is derived exclusively from is_org_member()/has_permission()
-- (which read organization_memberships + membership_roles via auth.uid()),
-- never from a route slug or a client-submitted organization_id/UUID.

-- profiles ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create policy "profiles_select_self_or_co_member" on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = profiles.id
      and theirs.status = 'active'
  )
);

create policy "profiles_update_self" on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- platform_admins -------------------------------------------------------
alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;

create policy "platform_admins_select_self" on public.platform_admins
for select to authenticated
using (user_id = auth.uid());

-- organizations -----------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.organizations force row level security;

create policy "organizations_select_members" on public.organizations
for select to authenticated
using (public.is_org_member(id));

-- No authenticated INSERT/UPDATE/DELETE policy: organization provisioning
-- is a service_role-only administrative action in Phase 2 (no self-serve
-- org creation yet).

-- locations -----------------------------------------------------------
alter table public.locations enable row level security;
alter table public.locations force row level security;

create policy "locations_select_members" on public.locations
for select to authenticated
using (public.is_org_member(organization_id));

create policy "locations_insert_authorized" on public.locations
for insert to authenticated
with check (public.has_permission(organization_id, 'settings.write'));

create policy "locations_update_authorized" on public.locations
for update to authenticated
using (public.has_permission(organization_id, 'settings.write'))
with check (public.has_permission(organization_id, 'settings.write'));

create policy "locations_delete_authorized" on public.locations
for delete to authenticated
using (public.has_permission(organization_id, 'settings.write'));

-- organization_memberships ---------------------------------------------
alter table public.organization_memberships enable row level security;
alter table public.organization_memberships force row level security;

create policy "org_memberships_select_members" on public.organization_memberships
for select to authenticated
using (public.is_org_member(organization_id));

create policy "org_memberships_insert_authorized" on public.organization_memberships
for insert to authenticated
with check (public.has_permission(organization_id, 'organization.manage'));

create policy "org_memberships_update_authorized" on public.organization_memberships
for update to authenticated
using (public.has_permission(organization_id, 'organization.manage'))
with check (public.has_permission(organization_id, 'organization.manage'));

create policy "org_memberships_delete_authorized" on public.organization_memberships
for delete to authenticated
using (public.has_permission(organization_id, 'organization.manage'));

-- roles / permissions / role_permissions (global catalog, read-only) ------
alter table public.roles enable row level security;
alter table public.roles force row level security;
create policy "roles_select_all_authenticated" on public.roles
for select to authenticated using (true);

alter table public.permissions enable row level security;
alter table public.permissions force row level security;
create policy "permissions_select_all_authenticated" on public.permissions
for select to authenticated using (true);

alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;
create policy "role_permissions_select_all_authenticated" on public.role_permissions
for select to authenticated using (true);

-- No authenticated write policy on any of the three catalog tables: the
-- catalog is migration-managed. Only service_role (which bypasses RLS
-- entirely) can change it.

-- membership_roles --------------------------------------------------------
alter table public.membership_roles enable row level security;
alter table public.membership_roles force row level security;

create policy "membership_roles_select_members" on public.membership_roles
for select to authenticated
using (public.is_org_member(organization_id));

create policy "membership_roles_insert_authorized" on public.membership_roles
for insert to authenticated
with check (public.has_permission(organization_id, 'organization.manage'));

create policy "membership_roles_update_authorized" on public.membership_roles
for update to authenticated
using (public.has_permission(organization_id, 'organization.manage'))
with check (public.has_permission(organization_id, 'organization.manage'));

create policy "membership_roles_delete_authorized" on public.membership_roles
for delete to authenticated
using (public.has_permission(organization_id, 'organization.manage'));

-- organization_branding ----------------------------------------------------
alter table public.organization_branding enable row level security;
alter table public.organization_branding force row level security;

create policy "org_branding_select_members" on public.organization_branding
for select to authenticated
using (public.is_org_member(organization_id));

create policy "org_branding_update_authorized" on public.organization_branding
for update to authenticated
using (public.has_permission(organization_id, 'settings.write'))
with check (public.has_permission(organization_id, 'settings.write'));

-- organization_settings ----------------------------------------------------
alter table public.organization_settings enable row level security;
alter table public.organization_settings force row level security;

create policy "org_settings_select_members" on public.organization_settings
for select to authenticated
using (public.is_org_member(organization_id));

create policy "org_settings_update_authorized" on public.organization_settings
for update to authenticated
using (public.has_permission(organization_id, 'settings.write'))
with check (public.has_permission(organization_id, 'settings.write'));

-- audit_logs: append-only, function-mediated ------------------------------
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

create policy "audit_logs_select_authorized" on public.audit_logs
for select to authenticated
using (
  (organization_id is not null and public.has_permission(organization_id, 'audit.read'))
  or (
    organization_id is null
    and exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
  )
);

-- Deliberately no INSERT/UPDATE/DELETE policy for `authenticated` on
-- audit_logs. Writes happen only through record_audit_event()
-- (SECURITY DEFINER), so nobody can forge or edit audit history via the API.

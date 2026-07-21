-- Phase 2: user profiles plus the global role/permission catalog.
-- roles, permissions, and role_permissions are NOT tenant-owned: they are a
-- shared, platform-wide catalog. They carry no organization_id.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per authenticated user, 1:1 with auth.users.';

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  is_platform_role boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.roles is 'Global role catalog. Assigned to a membership via membership_roles.';

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.permissions is 'Global permission catalog, dot-namespaced (e.g. finance.read).';

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- Initial role catalog (issue #13, scope E).
insert into public.roles (key, name, description, is_platform_role) values
  ('platform_admin', 'Platform Admin', 'Cross-organization platform administrator.', true),
  ('organization_owner', 'Organization Owner', 'Full access inside one organization.', false),
  ('general_manager', 'General Manager', 'Operations, staffing, finance summaries, approvals.', false),
  ('finance_manager', 'Finance Manager', 'Revenue, costs, and financial reporting.', false),
  ('operations_manager', 'Operations Manager', 'Orders, reservations, inventory, staff tasks.', false),
  ('marketing_manager', 'Marketing Manager', 'Campaigns, content, and CRM.', false),
  ('staff', 'Staff', 'Assigned tasks and limited operational views.', false),
  ('viewer', 'Viewer', 'Dashboard and reports without mutation rights.', false)
on conflict (key) do nothing;

-- Initial permission catalog (issue #13, scope E) plus organization.manage,
-- which the issue's scope F ("owner/admin membership-management policies",
-- "immutable organization ownership safeguards") requires but the listed
-- permission set has no key for.
insert into public.permissions (key, description) values
  ('dashboard.read', 'View the organization dashboard.'),
  ('orders.read', 'View orders.'),
  ('orders.write', 'Create and modify orders.'),
  ('reservations.read', 'View reservations.'),
  ('reservations.write', 'Create and modify reservations.'),
  ('crm.read', 'View guests, leads, and conversations.'),
  ('crm.write', 'Create and modify guests, leads, and conversations.'),
  ('inventory.read', 'View inventory levels.'),
  ('inventory.write', 'Adjust inventory and purchase orders.'),
  ('finance.read', 'View financial summaries.'),
  ('finance.write', 'Record financial entries.'),
  ('staff.read', 'View staff and schedules.'),
  ('staff.write', 'Manage staff and schedules.'),
  ('settings.read', 'View organization settings and branding.'),
  ('settings.write', 'Modify organization settings and branding.'),
  ('ai.actions.approve', 'Approve AI Executive recommended actions.'),
  ('audit.read', 'View the organization audit log.'),
  ('organization.manage', 'Manage organization memberships and role assignments.')
on conflict (key) do nothing;

-- Role -> permission grants.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('organization_owner', 'dashboard.read'), ('organization_owner', 'orders.read'), ('organization_owner', 'orders.write'),
  ('organization_owner', 'reservations.read'), ('organization_owner', 'reservations.write'),
  ('organization_owner', 'crm.read'), ('organization_owner', 'crm.write'),
  ('organization_owner', 'inventory.read'), ('organization_owner', 'inventory.write'),
  ('organization_owner', 'finance.read'), ('organization_owner', 'finance.write'),
  ('organization_owner', 'staff.read'), ('organization_owner', 'staff.write'),
  ('organization_owner', 'settings.read'), ('organization_owner', 'settings.write'),
  ('organization_owner', 'ai.actions.approve'), ('organization_owner', 'audit.read'),
  ('organization_owner', 'organization.manage'),

  ('general_manager', 'dashboard.read'), ('general_manager', 'orders.read'), ('general_manager', 'orders.write'),
  ('general_manager', 'reservations.read'), ('general_manager', 'reservations.write'),
  ('general_manager', 'crm.read'), ('general_manager', 'crm.write'),
  ('general_manager', 'inventory.read'), ('general_manager', 'finance.read'),
  ('general_manager', 'staff.read'), ('general_manager', 'staff.write'),
  ('general_manager', 'settings.read'), ('general_manager', 'ai.actions.approve'), ('general_manager', 'audit.read'),

  ('finance_manager', 'dashboard.read'), ('finance_manager', 'finance.read'),
  ('finance_manager', 'finance.write'), ('finance_manager', 'audit.read'),

  ('operations_manager', 'dashboard.read'), ('operations_manager', 'orders.read'), ('operations_manager', 'orders.write'),
  ('operations_manager', 'reservations.read'), ('operations_manager', 'reservations.write'),
  ('operations_manager', 'inventory.read'), ('operations_manager', 'inventory.write'),
  ('operations_manager', 'staff.read'),

  ('marketing_manager', 'dashboard.read'), ('marketing_manager', 'crm.read'),
  ('marketing_manager', 'crm.write'), ('marketing_manager', 'orders.read'),

  ('staff', 'dashboard.read'), ('staff', 'orders.read'), ('staff', 'reservations.read'),

  ('viewer', 'dashboard.read'), ('viewer', 'orders.read'), ('viewer', 'reservations.read'),
  ('viewer', 'crm.read'), ('viewer', 'inventory.read'), ('viewer', 'finance.read'),
  ('viewer', 'staff.read'), ('viewer', 'settings.read'), ('viewer', 'audit.read')
) as grants(role_key, permission_key)
join public.roles r on r.key = grants.role_key
join public.permissions p on p.key = grants.permission_key
on conflict do nothing;

-- platform_admin holds every permission too, so has_permission() never needs
-- a special case beyond checking platform_admins first (belt and suspenders).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'platform_admin'
on conflict do nothing;

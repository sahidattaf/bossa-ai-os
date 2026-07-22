-- Phase 2: organizations and everything tenant-scoped beneath them.
-- Every table in this file carries organization_id (directly or, for
-- organizations itself, as its own primary key).

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  business_type text not null default 'restaurant',
  status text not null default 'active' check (status in ('active', 'onboarding', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_primary boolean not null default true,
  timezone text not null default 'UTC',
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_locations_organization_id on public.locations(organization_id);

drop trigger if exists set_locations_updated_at on public.locations;
create trigger set_locations_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists idx_org_memberships_org_id on public.organization_memberships(organization_id);
create index if not exists idx_org_memberships_user_id on public.organization_memberships(user_id);

drop trigger if exists set_org_memberships_updated_at on public.organization_memberships;
create trigger set_org_memberships_updated_at
before update on public.organization_memberships
for each row execute function public.set_updated_at();

create table if not exists public.membership_roles (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.organization_memberships(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  -- Denormalized for direct RLS filtering; always set server-side from
  -- membership_id by the trigger below, never trusted from client input.
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (membership_id, role_id)
);

create index if not exists idx_membership_roles_org_id on public.membership_roles(organization_id);
create index if not exists idx_membership_roles_membership_id on public.membership_roles(membership_id);

create or replace function public.sync_membership_roles_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select organization_id into new.organization_id
  from public.organization_memberships
  where id = new.membership_id;

  if new.organization_id is null then
    raise exception 'membership_id % does not reference an existing membership', new.membership_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_membership_roles_organization_id() from public;

drop trigger if exists sync_membership_roles_organization_id on public.membership_roles;
create trigger sync_membership_roles_organization_id
before insert or update of membership_id on public.membership_roles
for each row execute function public.sync_membership_roles_organization_id();

create table if not exists public.organization_branding (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  logo_url text,
  logo_initials text not null default '',
  primary_color text not null default '222 47% 20%',
  accent_color text not null default '199 89% 48%',
  theme_mode text not null default 'dark' check (theme_mode in ('light', 'dark', 'system')),
  border_radius text not null default 'standard' check (border_radius in ('compact', 'standard', 'soft')),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_org_branding_updated_at on public.organization_branding;
create trigger set_org_branding_updated_at
before update on public.organization_branding
for each row execute function public.set_updated_at();

create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  locale text not null default 'en-US',
  timezone text not null default 'UTC',
  currency text not null default 'USD',
  service_status text not null default 'open' check (service_status in ('open', 'busy', 'opening_soon', 'closed')),
  ai_manager_name text not null default 'OperationsGPT',
  product_kpi_label text not null default 'Units Sold',
  product_kpi_unit text,
  dashboard_widgets jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists set_org_settings_updated_at on public.organization_settings;
create trigger set_org_settings_updated_at
before update on public.organization_settings
for each row execute function public.set_updated_at();

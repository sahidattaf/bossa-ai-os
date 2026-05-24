-- BOSSA AI OS Core Data Layer
-- Supabase project: bossa-ai-os
-- Project URL: https://oqmftkttkfktyzefswpz.supabase.co
-- Purpose: live operational data for campaigns, content, WhatsApp leads, orders, bookings, KPIs, decisions, weekly briefs, and agent logs.
-- Security posture: RLS enabled on all public tables with default-deny policies.

create table if not exists public.users_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text default 'operator',
  language_preference text default 'en',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  offer text,
  platform text,
  status text default 'draft',
  start_date date,
  end_date date,
  goal text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete set null,
  title text not null,
  content_type text,
  language text default 'en',
  caption text,
  cta text,
  status text default 'draft',
  published_at timestamp with time zone,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.whatsapp_leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,
  source text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  message text,
  status text default 'new',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text,
  phone text,
  order_items jsonb default '[]'::jsonb,
  total_amount numeric(12,2) default 0,
  payment_status text default 'pending',
  order_status text default 'new',
  source text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_name text,
  phone text,
  booking_date date,
  booking_time time,
  party_size int,
  source text,
  status text default 'new',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  price numeric(12,2),
  cost numeric(12,2),
  margin_priority text,
  active boolean default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.kpi_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  revenue numeric(12,2) default 0,
  whatsapp_inquiries int default 0,
  bookings int default 0,
  orders int default 0,
  posts_published int default 0,
  reach int default 0,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.decision_log (
  id uuid primary key default gen_random_uuid(),
  decision text not null,
  reason text,
  expected_result text,
  actual_result text,
  status text default 'active',
  owner text,
  decision_date date default current_date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.weekly_briefs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  week_end date not null,
  summary text,
  opportunities text,
  risks text,
  next_actions text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  task text,
  input jsonb default '{}'::jsonb,
  output jsonb default '{}'::jsonb,
  status text default 'completed',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone default now()
);

create index if not exists idx_campaigns_status on public.campaigns(status);
create index if not exists idx_content_items_campaign_id on public.content_items(campaign_id);
create index if not exists idx_content_items_status on public.content_items(status);
create index if not exists idx_whatsapp_leads_campaign_id on public.whatsapp_leads(campaign_id);
create index if not exists idx_whatsapp_leads_status on public.whatsapp_leads(status);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_orders_order_status on public.orders(order_status);
create index if not exists idx_bookings_booking_date on public.bookings(booking_date);
create index if not exists idx_bookings_status on public.bookings(status);
create index if not exists idx_menu_items_active on public.menu_items(active);
create index if not exists idx_kpi_daily_date on public.kpi_daily(date desc);
create index if not exists idx_decision_log_decision_date on public.decision_log(decision_date desc);
create index if not exists idx_weekly_briefs_week_start on public.weekly_briefs(week_start desc);
create index if not exists idx_agent_runs_agent_name on public.agent_runs(agent_name);
create index if not exists idx_agent_runs_created_at on public.agent_runs(created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_users_profiles_updated_at on public.users_profiles;
create trigger set_users_profiles_updated_at
before update on public.users_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_campaigns_updated_at on public.campaigns;
create trigger set_campaigns_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

drop trigger if exists set_content_items_updated_at on public.content_items;
create trigger set_content_items_updated_at
before update on public.content_items
for each row execute function public.set_updated_at();

drop trigger if exists set_whatsapp_leads_updated_at on public.whatsapp_leads;
create trigger set_whatsapp_leads_updated_at
before update on public.whatsapp_leads
for each row execute function public.set_updated_at();

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists set_bookings_updated_at on public.bookings;
create trigger set_bookings_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

drop trigger if exists set_menu_items_updated_at on public.menu_items;
create trigger set_menu_items_updated_at
before update on public.menu_items
for each row execute function public.set_updated_at();

drop trigger if exists set_kpi_daily_updated_at on public.kpi_daily;
create trigger set_kpi_daily_updated_at
before update on public.kpi_daily
for each row execute function public.set_updated_at();

drop trigger if exists set_decision_log_updated_at on public.decision_log;
create trigger set_decision_log_updated_at
before update on public.decision_log
for each row execute function public.set_updated_at();

drop trigger if exists set_weekly_briefs_updated_at on public.weekly_briefs;
create trigger set_weekly_briefs_updated_at
before update on public.weekly_briefs
for each row execute function public.set_updated_at();

alter table public.users_profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.content_items enable row level security;
alter table public.whatsapp_leads enable row level security;
alter table public.orders enable row level security;
alter table public.bookings enable row level security;
alter table public.menu_items enable row level security;
alter table public.kpi_daily enable row level security;
alter table public.decision_log enable row level security;
alter table public.weekly_briefs enable row level security;
alter table public.agent_runs enable row level security;

-- Default deny for browser/API access until explicit app policies are added.
do $$
declare
  t text;
begin
  foreach t in array array[
    'users_profiles', 'campaigns', 'content_items', 'whatsapp_leads', 'orders', 'bookings',
    'menu_items', 'kpi_daily', 'decision_log', 'weekly_briefs', 'agent_runs'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'default_deny_public_access', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (false) with check (false)', 'default_deny_public_access', t);
  end loop;
end $$;

comment on table public.campaigns is 'BOSSA AI OS campaigns and promotions.';
comment on table public.content_items is 'Campaign content assets such as captions, stories, scripts, and posts.';
comment on table public.whatsapp_leads is 'WhatsApp inquiries and campaign leads.';
comment on table public.orders is 'Restaurant orders and sales entries.';
comment on table public.bookings is 'Restaurant reservation and booking entries.';
comment on table public.menu_items is 'Menu catalog with pricing and margin priority.';
comment on table public.kpi_daily is 'Daily KPI tracker for revenue, bookings, orders, reach, and inquiries.';
comment on table public.decision_log is 'Decision log for BOSSA AI OS learning loop.';
comment on table public.weekly_briefs is 'Weekly AI Brief summaries and next actions.';
comment on table public.agent_runs is 'AI agent execution logs.';

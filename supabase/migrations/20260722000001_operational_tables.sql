-- Phase 3A: core operational schema (issue #16, scope A).
-- Every table carries organization_id. location_id/lead_id/reservation_id
-- cross-references use a *composite* FK against (organization_id, id) on the
-- referenced table (each of which also gets a `unique (organization_id, id)`
-- constraint below) rather than a single-column FK — this makes "the
-- referenced row belongs to the same organization" a schema-level guarantee
-- instead of an app-level or trigger-level check, and Postgres treats a NULL
-- referencing column as satisfied (MATCH SIMPLE), so the nullable
-- cross-references below still allow NULL.

-- Phase 2's `locations` only has a plain `id` primary key — add the
-- (organization_id, id) unique constraint the composite FKs below need to
-- reference. (Discovered by a real CI run: SQLSTATE 42830, "there is no
-- unique constraint matching given keys for referenced table 'locations'".)
alter table public.locations
  add constraint locations_organization_id_id_key unique (organization_id, id);

-- leads --------------------------------------------------------------------

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  lead_type text not null check (lead_type in ('reservation', 'order', 'catering', 'general')),
  source text not null check (source in ('whatsapp', 'phone', 'walk_in', 'website', 'referral', 'social', 'other')),
  contact_name text not null,
  phone text not null,
  email text,
  guest_count integer check (guest_count is null or guest_count > 0),
  requested_date timestamptz,
  budget numeric(12, 2) check (budget is null or budget >= 0),
  message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'converted', 'lost')),
  owner_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create index if not exists idx_leads_organization_id on public.leads(organization_id);
create index if not exists idx_leads_status on public.leads(organization_id, status);
create index if not exists idx_leads_created_at on public.leads(organization_id, created_at desc);

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

-- reservations ---------------------------------------------------------------

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  lead_id uuid,
  confirmation_code text not null,
  guest_name text not null,
  phone text not null,
  email text,
  party_size integer not null check (party_size > 0),
  reservation_at timestamptz not null,
  duration_minutes integer not null default 90 check (duration_minutes > 0),
  occasion text,
  notes text,
  source text not null check (source in ('whatsapp', 'phone', 'walk_in', 'website', 'referral', 'social', 'other')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, confirmation_code),
  foreign key (organization_id, location_id) references public.locations(organization_id, id),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id)
);

create index if not exists idx_reservations_organization_id on public.reservations(organization_id);
create index if not exists idx_reservations_status on public.reservations(organization_id, status);
create index if not exists idx_reservations_reservation_at on public.reservations(organization_id, reservation_at);

drop trigger if exists set_reservations_updated_at on public.reservations;
create trigger set_reservations_updated_at
before update on public.reservations
for each row execute function public.set_updated_at();

-- orders ---------------------------------------------------------------------

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  lead_id uuid,
  reservation_id uuid,
  order_number text not null,
  channel text not null check (channel in ('dine_in', 'takeout', 'delivery', 'whatsapp', 'phone', 'website', 'other')),
  fulfillment_type text not null check (fulfillment_type in ('dine_in', 'pickup', 'delivery')),
  customer_name text not null,
  phone text,
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  tax_total numeric(12, 2) not null default 0 check (tax_total >= 0),
  delivery_fee numeric(12, 2) not null default 0 check (delivery_fee >= 0),
  total numeric(12, 2) not null default 0,
  currency text not null default 'USD',
  requested_for timestamptz,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partially_paid', 'paid', 'refunded')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, order_number),
  foreign key (organization_id, location_id) references public.locations(organization_id, id),
  foreign key (organization_id, lead_id) references public.leads(organization_id, id),
  foreign key (organization_id, reservation_id) references public.reservations(organization_id, id)
);

create index if not exists idx_orders_organization_id on public.orders(organization_id);
create index if not exists idx_orders_status on public.orders(organization_id, status);
create index if not exists idx_orders_created_at on public.orders(organization_id, created_at desc);

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- order_items ------------------------------------------------------------------
-- line_total is a STORED generated column: Postgres itself rejects any INSERT
-- or UPDATE that tries to supply a value for it (money integrity rule 4 —
-- "clients cannot directly set line_total"), and it is always correct.

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  item_name text not null,
  item_sku text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  line_total numeric(12, 2) generated always as (quantity * unit_price) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, order_id) references public.orders(organization_id, id) on delete cascade
);

create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_order_items_organization_id on public.order_items(organization_id);

-- daily_kpi_snapshots -----------------------------------------------------------
-- location_id is nullable (an org-wide rollup row) alongside per-location rows,
-- so the natural uniqueness key needs an expression to fold NULL into a single
-- comparable value — a plain multi-column `unique` constraint can't do that,
-- hence a unique index over coalesce(location_id, all-zero sentinel).

create table if not exists public.daily_kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  snapshot_date date not null,
  revenue numeric(12, 2) not null default 0,
  order_count integer not null default 0,
  reservation_count integer not null default 0,
  covers integer not null default 0,
  new_leads integer not null default 0,
  unanswered_leads integer not null default 0,
  average_ticket numeric(12, 2) not null default 0,
  cancellation_count integer not null default 0,
  no_show_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id)
);

create unique index if not exists idx_daily_kpi_snapshots_org_loc_date on public.daily_kpi_snapshots (
  organization_id,
  coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
  snapshot_date
);

create index if not exists idx_daily_kpi_snapshots_organization_id on public.daily_kpi_snapshots(organization_id);

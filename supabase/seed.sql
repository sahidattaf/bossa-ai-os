-- Deterministic local/dev/test fixture data. NOT applied to any production
-- project. Every insert uses a fixed UUID and `on conflict do nothing` (or
-- `do update`) so re-running this file (without a full `supabase db reset`)
-- is safe, per issue #13's "seed applies twice safely" requirement.
--
-- Seeded users and passwords are LOCAL-DEV-ONLY fixtures. See
-- docs/SUPABASE_OPERATIONS.md. Never reuse these credentials anywhere real.

-- Organizations -------------------------------------------------------
insert into public.organizations (id, slug, name, business_type, status) values
  ('00000000-0000-0000-0000-000000000001', 'bossa', 'BOSSA Asado i Mar', 'restaurant', 'active'),
  ('00000000-0000-0000-0000-000000000002', 'papai', 'Papai Since 1933', 'restaurant', 'onboarding')
on conflict (id) do update set
  slug = excluded.slug, name = excluded.name, business_type = excluded.business_type, status = excluded.status;

insert into public.locations (id, organization_id, name, is_primary, timezone, currency) values
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'BOSSA Asado i Mar — Main', true, 'America/Curacao', 'USD'),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000002', 'Papai Since 1933 — Main', true, 'America/Curacao', 'ANG')
on conflict (id) do update set
  name = excluded.name, is_primary = excluded.is_primary, timezone = excluded.timezone, currency = excluded.currency;

-- Branding and settings mirror Phase 1's mock TenantConfig exactly, so
-- SupabaseDashboardDataProvider produces the same look BOSSA/Papai already
-- had in mock mode. dashboard_widgets matches lib/tenancy/tenants.ts's
-- widgetOrder() default one-for-one.
insert into public.organization_branding (organization_id, logo_initials, primary_color, accent_color, theme_mode, border_radius) values
  ('00000000-0000-0000-0000-000000000001', 'BA', '24 95% 53%', '199 89% 58%', 'dark', 'standard'),
  ('00000000-0000-0000-0000-000000000002', 'PS', '142 45% 28%', '38 75% 45%', 'light', 'soft')
on conflict (organization_id) do update set
  logo_initials = excluded.logo_initials, primary_color = excluded.primary_color,
  accent_color = excluded.accent_color, theme_mode = excluded.theme_mode, border_radius = excluded.border_radius;

insert into public.organization_settings (
  organization_id, locale, timezone, currency, service_status, ai_manager_name,
  product_kpi_label, product_kpi_unit, dashboard_widgets
) values (
  '00000000-0000-0000-0000-000000000001', 'en-CW', 'America/Curacao', 'USD', 'open', 'BossVisionGPT',
  'Fire Boxes Sold', 'boxes',
  '[
    {"key":"greeting","order":1,"size":"full","visible":true},
    {"key":"revenueToday","order":2,"size":"sm","visible":true,"requiredPermission":"finance.read"},
    {"key":"ordersToday","order":3,"size":"sm","visible":true},
    {"key":"reservationsTonight","order":4,"size":"sm","visible":true},
    {"key":"whatsappLeads","order":5,"size":"sm","visible":true},
    {"key":"reviewScore","order":6,"size":"sm","visible":true},
    {"key":"productKpi","order":7,"size":"sm","visible":true},
    {"key":"foodCostPercentage","order":8,"size":"sm","visible":true},
    {"key":"laborPercentage","order":9,"size":"sm","visible":true},
    {"key":"syncPanel","order":10,"size":"md","visible":true},
    {"key":"aiPriorities","order":11,"size":"md","visible":true},
    {"key":"approvalQueue","order":12,"size":"md","visible":true,"requiredPermission":"ai.actions.approve"},
    {"key":"liveAlerts","order":13,"size":"md","visible":true},
    {"key":"revenueForecast","order":14,"size":"lg","visible":true,"requiredPermission":"finance.read"},
    {"key":"quickActions","order":15,"size":"full","visible":true}
  ]'::jsonb
), (
  '00000000-0000-0000-0000-000000000002', 'en-CW', 'America/Curacao', 'ANG', 'opening_soon', 'PapaiLegacyGPT',
  'Heritage Platters Served', 'platters',
  '[
    {"key":"greeting","order":1,"size":"full","visible":true},
    {"key":"revenueToday","order":2,"size":"sm","visible":true,"requiredPermission":"finance.read"},
    {"key":"ordersToday","order":3,"size":"sm","visible":true},
    {"key":"reservationsTonight","order":4,"size":"sm","visible":true},
    {"key":"whatsappLeads","order":5,"size":"sm","visible":true},
    {"key":"reviewScore","order":6,"size":"sm","visible":true},
    {"key":"productKpi","order":7,"size":"sm","visible":true},
    {"key":"foodCostPercentage","order":8,"size":"sm","visible":true},
    {"key":"laborPercentage","order":9,"size":"sm","visible":true},
    {"key":"syncPanel","order":10,"size":"md","visible":true},
    {"key":"aiPriorities","order":11,"size":"md","visible":true},
    {"key":"approvalQueue","order":12,"size":"md","visible":true,"requiredPermission":"ai.actions.approve"},
    {"key":"liveAlerts","order":13,"size":"md","visible":true},
    {"key":"revenueForecast","order":14,"size":"lg","visible":true,"requiredPermission":"finance.read"},
    {"key":"quickActions","order":15,"size":"full","visible":true}
  ]'::jsonb
)
on conflict (organization_id) do update set
  locale = excluded.locale, timezone = excluded.timezone, currency = excluded.currency,
  service_status = excluded.service_status, ai_manager_name = excluded.ai_manager_name,
  product_kpi_label = excluded.product_kpi_label, product_kpi_unit = excluded.product_kpi_unit,
  dashboard_widgets = excluded.dashboard_widgets;

-- Deterministic dev auth users -----------------------------------------
-- Password for all four: "DevPassword123!" (local/dev/test only).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0002-000000000001', 'authenticated', 'authenticated',
   'owner@bossa.test', crypt('DevPassword123!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Bossa Owner"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0002-000000000002', 'authenticated', 'authenticated',
   'staff@bossa.test', crypt('DevPassword123!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Bossa Staff"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0002-000000000003', 'authenticated', 'authenticated',
   'owner@papai.test', crypt('DevPassword123!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Papai Owner"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0002-000000000004', 'authenticated', 'authenticated',
   'outsider@example.test', crypt('DevPassword123!', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"No Org Outsider"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email', now(), now(), now()
from auth.users u
where u.id in (
  '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0002-000000000002',
  '00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0002-000000000004'
)
on conflict do nothing;

-- Memberships and role grants -------------------------------------------
insert into public.organization_memberships (id, organization_id, user_id, status) values
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0002-000000000001', 'active'),
  ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0002-000000000002', 'active'),
  ('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0002-000000000003', 'active')
on conflict (id) do nothing;

insert into public.membership_roles (membership_id, role_id)
select m.id, r.id
from (values
  ('00000000-0000-0000-0003-000000000001'::uuid, 'organization_owner'),
  ('00000000-0000-0000-0003-000000000002'::uuid, 'staff'),
  ('00000000-0000-0000-0003-000000000003'::uuid, 'organization_owner')
) as grants(membership_id, role_key)
join public.organization_memberships m on m.id = grants.membership_id
join public.roles r on r.key = grants.role_key
on conflict (membership_id, role_id) do nothing;

-- outsider@example.test intentionally has no membership anywhere — used to
-- exercise the "known but inaccessible organization" permission-state path.

-- Operational data (Phase 3A, issue #16 scope G) ------------------------
-- All operational records are pinned to a fixed date (2026-07-20) rather
-- than `now()`/`current_date`, so dashboard/KPI assertions in pgTAP and
-- integration tests stay deterministic regardless of when the suite runs —
-- tests pass this same date as calculate_daily_kpi_snapshot()'s/
-- get_dashboard_snapshot()'s explicit as-of argument instead of relying on
-- "today". Every fixture is clearly fake test data; no real customer PII.

-- BOSSA leads ------------------------------------------------------------
insert into public.leads (id, organization_id, location_id, lead_type, source, contact_name, phone, email, guest_count, requested_date, status, owner_user_id, created_at) values
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'reservation', 'whatsapp', 'Maria Fernandez', '+5999000001', 'maria.f@example.test', 4, '2026-07-20 19:00+00', 'new', null, '2026-07-20 09:00+00'),
  ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'order', 'website', 'Julio Pantophlet', '+5999000002', null, null, null, 'contacted', '00000000-0000-0000-0002-000000000001', '2026-07-20 10:15+00'),
  ('00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'catering', 'phone', 'Estrella Boekhoudt', '+5999000003', null, 25, null, 'qualified', '00000000-0000-0000-0002-000000000001', '2026-07-19 16:00+00')
on conflict (id) do nothing;

-- BOSSA reservations -------------------------------------------------------
insert into public.reservations (id, organization_id, location_id, confirmation_code, guest_name, phone, party_size, reservation_at, duration_minutes, source, status, assigned_user_id, created_at) values
  ('00000000-0000-0000-0005-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'BOSSA-R001', 'Sofia Winterdal', '+5999000010', 4, '2026-07-20 19:00+00', 90, 'whatsapp', 'confirmed', '00000000-0000-0000-0002-000000000002', '2026-07-19 11:00+00'),
  ('00000000-0000-0000-0005-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'BOSSA-R002', 'Dario Croes', '+5999000011', 2, '2026-07-20 20:00+00', 90, 'website', 'pending', null, '2026-07-20 08:00+00'),
  ('00000000-0000-0000-0005-000000000003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'BOSSA-R003', 'Ingrid Statia', '+5999000012', 6, '2026-07-20 18:00+00', 120, 'phone', 'cancelled', null, '2026-07-18 09:00+00')
on conflict (id) do nothing;

-- BOSSA orders + order_items ------------------------------------------------
-- subtotal/total are intentionally omitted from these inserts: the
-- money-integrity triggers in 20260722000003 compute both (subtotal from
-- order_items via the AFTER trigger below, total from the fee columns).
insert into public.orders (id, organization_id, location_id, order_number, channel, fulfillment_type, customer_name, phone, discount_total, tax_total, delivery_fee, currency, status, payment_status, created_at) values
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'BOSSA-1001', 'dine_in', 'dine_in', 'Julio Pantophlet', '+5999000002', 0, 5.00, 0, 'USD', 'completed', 'paid', '2026-07-20 12:30+00'),
  ('00000000-0000-0000-0006-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'BOSSA-1002', 'takeout', 'pickup', 'Dario Croes', '+5999000011', 0, 2.56, 0, 'USD', 'pending', 'unpaid', '2026-07-20 13:00+00')
on conflict (id) do nothing;

insert into public.order_items (id, organization_id, order_id, item_name, quantity, unit_price) values
  ('00000000-0000-0000-0007-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0006-000000000001', 'Grilled Asado Ribs', 2, 28.00),
  ('00000000-0000-0000-0007-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0006-000000000001', 'Fried Yuca', 1, 6.50),
  ('00000000-0000-0000-0007-000000000003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0006-000000000002', 'Seafood Paella', 1, 32.00)
on conflict (id) do nothing;

-- Papai leads --------------------------------------------------------------
insert into public.leads (id, organization_id, location_id, lead_type, source, contact_name, phone, email, guest_count, status, owner_user_id, created_at) values
  ('00000000-0000-0000-0004-000000000004', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0001-000000000002', 'reservation', 'social', 'Ronnie Semeleer', '+5999000020', null, 3, 'new', null, '2026-07-20 09:30+00'),
  ('00000000-0000-0000-0004-000000000005', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0001-000000000002', 'general', 'referral', 'Chandra Milliard', '+5999000021', 'chandra.m@example.test', null, 'contacted', '00000000-0000-0000-0002-000000000003', '2026-07-20 11:00+00')
on conflict (id) do nothing;

-- Papai reservations ---------------------------------------------------------
insert into public.reservations (id, organization_id, location_id, confirmation_code, guest_name, phone, party_size, reservation_at, duration_minutes, source, status, created_at) values
  ('00000000-0000-0000-0005-000000000004', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0001-000000000002', 'PAPAI-R001', 'Ronnie Semeleer', '+5999000020', 3, '2026-07-20 19:30+00', 90, 'social', 'confirmed', '2026-07-19 10:00+00'),
  ('00000000-0000-0000-0005-000000000005', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0001-000000000002', 'PAPAI-R002', 'Bettina Kock', '+5999000022', 5, '2026-07-20 20:30+00', 90, 'phone', 'pending', '2026-07-20 09:00+00')
on conflict (id) do nothing;

-- Papai orders + order_items -------------------------------------------------
insert into public.orders (id, organization_id, location_id, order_number, channel, fulfillment_type, customer_name, phone, discount_total, tax_total, delivery_fee, currency, status, payment_status, created_at) values
  ('00000000-0000-0000-0006-000000000003', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0001-000000000002', 'PAPAI-1001', 'dine_in', 'dine_in', 'Chandra Milliard', '+5999000021', 0, 3.60, 0, 'ANG', 'completed', 'paid', '2026-07-20 12:00+00')
on conflict (id) do nothing;

insert into public.order_items (id, organization_id, order_id, item_name, quantity, unit_price) values
  ('00000000-0000-0000-0007-000000000005', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0006-000000000003', 'Heritage Platter', 1, 45.00)
on conflict (id) do nothing;

-- Daily KPI snapshots --------------------------------------------------------
-- Generated by calling the real idempotent function rather than
-- hand-computing values, so seed data can never drift from what the
-- function itself would produce for the same inputs. auth.uid() is null in
-- this raw psql/seed context, which the function treats as a trusted
-- service-context caller (see 20260722000006_kpi_snapshot_function.sql).
select public.calculate_daily_kpi_snapshot('00000000-0000-0000-0000-000000000001'::uuid, '2026-07-20'::date, null);
select public.calculate_daily_kpi_snapshot('00000000-0000-0000-0000-000000000002'::uuid, '2026-07-20'::date, null);

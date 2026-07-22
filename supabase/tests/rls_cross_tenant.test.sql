-- Cross-tenant RLS security suite (issue #13, rule 11). Run via
-- `supabase test db` (pgTAP), against the database seeded by seed.sql.
-- Simulates each actor by switching to the `authenticated` role and setting
-- the JWT claims auth.uid() reads — the same mechanism a real PostgREST
-- request uses, so these tests exercise the real policies, not a mock.

create extension if not exists pgtap with schema extensions;

begin;
select plan(26);

-- Fixed seed UUIDs (see supabase/seed.sql).
-- BOSSA org:            00000000-0000-0000-0000-000000000001
-- Papai org:             00000000-0000-0000-0000-000000000002
-- owner@bossa.test:      00000000-0000-0000-0002-000000000001
-- staff@bossa.test:      00000000-0000-0000-0002-000000000002
-- owner@papai.test:      00000000-0000-0000-0002-000000000003
-- outsider@example.test: 00000000-0000-0000-0002-000000000004

-- LANGUAGE plpgsql (not sql): a plain "SQL function" body may only contain
-- queries, not utility statements like SET LOCAL ROLE. Called as a bare
-- `select pg_temp.authenticate_as(...)` with no exception block, so it runs
-- in the caller's own transaction context — SET LOCAL persists for the rest
-- of this test file's single enclosing transaction, exactly like it would
-- for a real per-request PostgREST connection.
create or replace function pg_temp.authenticate_as(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$;

-- 1-2: a member can see their own organization, and only their own.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');

select is(
  (select count(*)::int from public.organizations where id = '00000000-0000-0000-0000-000000000001'),
  1,
  'BOSSA owner can select the BOSSA organization'
);

select is(
  (select count(*)::int from public.organizations where id = '00000000-0000-0000-0000-000000000002'),
  0,
  'BOSSA owner cannot select the Papai organization (cross-tenant SELECT denied)'
);

-- 3: cross-tenant SELECT on a child table (locations) is denied the same way.
select is(
  (select count(*)::int from public.locations where organization_id = '00000000-0000-0000-0000-000000000002'),
  0,
  'BOSSA owner cannot select Papai locations'
);

-- 4: cross-tenant INSERT is rejected outright (WITH CHECK fails: not a
-- member of the target organization at all).
select throws_ok(
  $$ insert into public.locations (organization_id, name)
     values ('00000000-0000-0000-0000-000000000002', 'Forged location') $$,
  '42501',
  null::text,
  'BOSSA owner cannot insert a location into Papai (cross-tenant INSERT denied)'
);

-- 5: cross-tenant UPDATE is a no-op (the target row is invisible under RLS,
-- not merely rejected) — verify zero rows changed by re-reading as the
-- Papai owner afterward.
select is(
  (with attempted as (
     update public.organization_settings
     set ai_manager_name = 'Hijacked'
     where organization_id = '00000000-0000-0000-0000-000000000002'
     returning organization_id
   )
   select count(*)::int from attempted),
  0,
  'BOSSA owner cross-tenant UPDATE on Papai settings affects zero rows'
);

select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000003');
select isnt(
  (select ai_manager_name from public.organization_settings where organization_id = '00000000-0000-0000-0000-000000000002'),
  'Hijacked',
  'Papai settings were not actually modified by the cross-tenant attempt'
);

-- 6: cross-tenant DELETE is likewise a no-op.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select is(
  (with attempted as (
     delete from public.locations
     where organization_id = '00000000-0000-0000-0000-000000000002'
     returning id
   )
   select count(*)::int from attempted),
  0,
  'BOSSA owner cross-tenant DELETE on Papai locations affects zero rows'
);

-- 7-9: permission grants behave as seeded — owner has broad access, staff
-- has the narrow set from the role catalog.
select ok(
  public.has_permission('00000000-0000-0000-0000-000000000001', 'finance.read'),
  'BOSSA owner has finance.read in BOSSA'
);
select ok(
  public.has_permission('00000000-0000-0000-0000-000000000001', 'organization.manage'),
  'BOSSA owner has organization.manage in BOSSA'
);

select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000002');
select is(
  public.has_permission('00000000-0000-0000-0000-000000000001', 'finance.read'),
  false,
  'BOSSA staff does NOT have finance.read (role catalog scoping)'
);
select is(
  public.has_permission('00000000-0000-0000-0000-000000000001', 'organization.manage'),
  false,
  'BOSSA staff does NOT have organization.manage'
);
select ok(
  public.has_permission('00000000-0000-0000-0000-000000000001', 'orders.read'),
  'BOSSA staff does have orders.read'
);

-- 10: staff cannot escalate their own role or grant roles to others
-- (membership_roles INSERT requires organization.manage).
select throws_ok(
  format(
    $$ insert into public.membership_roles (membership_id, role_id)
       select '00000000-0000-0000-0003-000000000002', id from public.roles where key = 'organization_owner' $$
  ),
  '42501',
  null::text,
  'BOSSA staff cannot insert a membership_roles row granting themselves organization_owner'
);

-- 11: staff cannot grant themselves a lesser role either — organization.manage
-- gates ALL membership_roles writes, not just owner escalation.
select throws_ok(
  format(
    $$ insert into public.membership_roles (membership_id, role_id)
       select '00000000-0000-0000-0003-000000000002', id from public.roles where key = 'viewer' $$
  ),
  '42501',
  null::text,
  'BOSSA staff cannot insert any membership_roles row at all, not just owner grants'
);

-- 12: immutable ownership — the sole organization_owner cannot be removed.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select throws_ok(
  $$ delete from public.membership_roles
     where membership_id = '00000000-0000-0000-0003-000000000001'
       and role_id = (select id from public.roles where key = 'organization_owner') $$,
  'P0001',
  'Cannot remove the last active organization_owner from organization 00000000-0000-0000-0000-000000000001',
  'Removing the last organization_owner of BOSSA is blocked'
);

-- 13: audit_logs is append-only — no direct authenticated INSERT policy
-- exists at all, regardless of permission level.
select throws_ok(
  $$ insert into public.audit_logs (organization_id, action, entity_type)
     values ('00000000-0000-0000-0000-000000000001', 'test.forged', 'test') $$,
  '42501',
  null::text,
  'Direct INSERT into audit_logs is rejected even for an organization_owner'
);

-- 14: the sanctioned path (record_audit_event) works and returns a row id.
select ok(
  public.record_audit_event(
    '00000000-0000-0000-0000-000000000001', 'test.recorded', 'test', null, '{}'::jsonb
  ) is not null,
  'record_audit_event() succeeds for a member of the organization'
);

-- 15: record_audit_event refuses to log against an organization the caller
-- doesn't belong to.
select throws_ok(
  $$ select public.record_audit_event(
       '00000000-0000-0000-0000-000000000002', 'test.forged', 'test', null, '{}'::jsonb
     ) $$,
  'P0001',
  'Cannot record an audit event for an organization you do not belong to',
  'record_audit_event() rejects an organization the caller is not a member of'
);

-- 16: cross-tenant audit SELECT is denied even though a real row now exists.
select is(
  (select count(*)::int from public.audit_logs where organization_id = '00000000-0000-0000-0000-000000000001' and action = 'test.recorded'),
  1,
  'BOSSA owner can read their own audit log entry'
);
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000003');
select is(
  (select count(*)::int from public.audit_logs where organization_id = '00000000-0000-0000-0000-000000000001'),
  0,
  'Papai owner cannot read BOSSA audit log entries'
);

-- 17-18: the 404-vs-permission-state distinction. get_organization_summary
-- reveals existence to ANY authenticated user (by design); the full,
-- RLS-scoped `organizations` row remains hidden without membership.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000004');
select is(
  (select count(*)::int from public.get_organization_summary('bossa')),
  1,
  'A user with zero memberships can still see that "bossa" exists via get_organization_summary'
);
select is(
  (select count(*)::int from public.organizations where slug = 'bossa'),
  0,
  'The same user cannot select the full BOSSA organizations row (no active membership)'
);
select is(
  (select count(*)::int from public.get_organization_summary('does-not-exist')),
  0,
  'get_organization_summary correctly reports a truly unknown slug as not found'
);

-- 19: a user with no memberships anywhere sees an empty permission set, not
-- an error and not a wildcard.
select is(
  public.get_my_permissions('00000000-0000-0000-0000-000000000001'),
  array[]::text[],
  'A non-member gets an empty permission array for an organization, never a default grant'
);

-- 20: global catalog tables are readable by any authenticated user...
select ok(
  (select count(*)::int from public.roles) >= 8,
  'Any authenticated user can read the global role catalog'
);

-- 21: ...but not writable.
select throws_ok(
  $$ insert into public.roles (key, name) values ('forged_role', 'Forged') $$,
  '42501',
  null::text,
  'An authenticated user cannot insert into the roles catalog'
);

-- 22-24: locations settings.write gating — staff (no settings.write) is
-- blocked from inserting a location even within their own organization.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000002');
select throws_ok(
  $$ insert into public.locations (organization_id, name)
     values ('00000000-0000-0000-0000-000000000001', 'Unauthorized location') $$,
  '42501',
  null::text,
  'BOSSA staff cannot insert a location even within their own organization (lacks settings.write)'
);

-- 25: the organization_owner, who does hold settings.write, can.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select lives_ok(
  $$ insert into public.locations (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Second Location') $$,
  'BOSSA owner can insert a second location in their own organization'
);

-- 26: platform_admins is self-select-only for a non-admin.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000004');
select is(
  (select count(*)::int from public.platform_admins),
  0,
  'A non-platform-admin sees zero rows in platform_admins, not an error'
);

select * from finish();
rollback;

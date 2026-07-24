-- Phase 4.5 Lane A (issue #20): proves supabase/production-ops/
-- legacy_schema_cleanup.sql's perform_legacy_bossa_schema_cleanup() /
-- verify_legacy_bossa_schema_cleanup() functions directly -- the exact
-- file that will eventually run against the real bossa-ai-os project, not
-- a reimplementation of its logic.
--
-- Both functions take source/target schema names as parameters specifically
-- so this test can point them at disposable, synthetic fixture schemas
-- instead of the real `public` schema -- this database's `public.orders`
-- etc. are already the REAL Phase 3 tables by the time pgTAP runs (every
-- migration has already applied), so a fixture literally named
-- `public.orders` would collide with them. Every schema this file creates
-- is rolled back with the rest of the transaction; nothing here persists.

create extension if not exists pgtap with schema extensions;

begin;
select plan(24);

create or replace function pg_temp.expect_error_message(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- Builds one complete, correct legacy fixture (all 11 documented tables,
-- the 5 documented indexes, both documented functions, and a trigger
-- wiring one of them up) inside the given schema name -- reused for both
-- the happy-path test and (with one object then dropped) each
-- precondition-failure test.
create or replace function pg_temp.create_legacy_fixture(p_schema text)
returns void
language plpgsql
as $$
begin
  execute format('create schema %I', p_schema);

  execute format('create table %I.campaigns (id serial primary key, name text)', p_schema);
  execute format('create table %I.weekly_briefs (id serial primary key, note text)', p_schema);
  execute format('create table %I.whatsapp_leads (id serial primary key)', p_schema);
  execute format('create table %I.bookings (id serial primary key)', p_schema);
  execute format('create table %I.users_profiles (id serial primary key)', p_schema);
  execute format('create table %I.kpi_daily (id serial primary key)', p_schema);
  execute format('create table %I.content_items (id serial primary key)', p_schema);
  execute format('create table %I.decision_log (id serial primary key)', p_schema);
  execute format('create table %I.agent_runs (id serial primary key)', p_schema);

  execute format(
    'create table %I.orders (id serial primary key, order_status text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())',
    p_schema
  );
  execute format('create index idx_orders_created_at on %I.orders(created_at)', p_schema);
  execute format('create index idx_orders_order_status on %I.orders(order_status)', p_schema);

  execute format('create table %I.menu_items (id serial primary key, is_active boolean not null default true)', p_schema);
  execute format('create index idx_menu_items_active on %I.menu_items(is_active)', p_schema);

  execute format(
    'create function %I.set_updated_at() returns trigger language plpgsql as %L',
    p_schema, 'begin new.updated_at = now(); return new; end;'
  );
  execute format(
    'create function %I.set_created_by_from_auth() returns trigger language plpgsql as %L',
    p_schema, 'begin return new; end;'
  );
  execute format(
    'create trigger set_orders_updated_at before update on %I.orders for each row execute function %I.set_updated_at()',
    p_schema, p_schema
  );

  execute format('insert into %I.campaigns (name) values (%L), (%L)', p_schema, 'Fixture Campaign A', 'Fixture Campaign B');
  execute format('insert into %I.orders (order_status) values (%L), (%L)', p_schema, 'requested', 'confirmed');
end;
$$;

-- Loads perform_legacy_bossa_schema_cleanup() / verify_legacy_bossa_schema_cleanup()
-- from the single canonical file -- the same file that will be run
-- directly against bossa-ai-os.
\ir ../production-ops/legacy_schema_cleanup.sql

-- ============================================================================
-- 1-4: precondition failures -- fail closed on a documented object missing
-- from the source schema, before anything is moved.
-- ============================================================================

select pg_temp.create_legacy_fixture('legacy_fixture_missing_table');
drop table legacy_fixture_missing_table.decision_log;
set local role service_role;
select ok(
  pg_temp.expect_error_message(
    $$ select public.perform_legacy_bossa_schema_cleanup('legacy_fixture_missing_table', 'legacy_bossa_missing_table_target') $$
  ) like 'PRECONDITION_FAILED: expected legacy table(s) missing%decision_log%',
  'Fails closed with a clear message when a documented legacy table is missing from the source schema'
);
reset role;
select is(
  (select count(*)::int from pg_namespace where nspname = 'legacy_bossa_missing_table_target'),
  0,
  'No target schema is created when the missing-table precondition fails'
);

select pg_temp.create_legacy_fixture('legacy_fixture_missing_index');
drop index legacy_fixture_missing_index.idx_menu_items_active;
set local role service_role;
select ok(
  pg_temp.expect_error_message(
    $$ select public.perform_legacy_bossa_schema_cleanup('legacy_fixture_missing_index', 'legacy_bossa_missing_index_target') $$
  ) like 'PRECONDITION_FAILED: expected legacy index(es) missing%idx_menu_items_active%',
  'Fails closed with a clear message when a documented legacy index is missing from the source schema'
);
reset role;

select pg_temp.create_legacy_fixture('legacy_fixture_missing_function');
drop function legacy_fixture_missing_function.set_created_by_from_auth();
set local role service_role;
select ok(
  pg_temp.expect_error_message(
    $$ select public.perform_legacy_bossa_schema_cleanup('legacy_fixture_missing_function', 'legacy_bossa_missing_function_target') $$
  ) like 'PRECONDITION_FAILED: expected legacy function(s) missing%set_created_by_from_auth%',
  'Fails closed with a clear message when a documented legacy function is missing from the source schema'
);
reset role;

-- ============================================================================
-- 5-21: the happy path -- every precondition satisfied, cleanup succeeds,
-- and every verification check passes.
-- ============================================================================

select pg_temp.create_legacy_fixture('legacy_fixture_ok');

set local role service_role;
select lives_ok(
  $$ select public.perform_legacy_bossa_schema_cleanup('legacy_fixture_ok', 'legacy_bossa_test_target') $$,
  'perform_legacy_bossa_schema_cleanup succeeds when every documented object is present'
);

-- 6: every check verify_legacy_bossa_schema_cleanup reports actually passed.
select is(
  (
    select count(*)::int from public.verify_legacy_bossa_schema_cleanup('legacy_fixture_ok', 'legacy_bossa_test_target')
    where not passed
  ),
  0,
  'verify_legacy_bossa_schema_cleanup reports zero failing checks after a successful cleanup'
);
reset role;

-- 7-8: tables moved; source is free of the collisions.
select ok(
  to_regclass('legacy_bossa_test_target.orders') is not null,
  'orders now exists in the target schema'
);
select ok(
  to_regclass('legacy_fixture_ok.orders') is null,
  'orders no longer exists in the source schema'
);

-- 9-11: row data preserved exactly -- not recreated, not truncated.
select is(
  (select count(*)::int from legacy_bossa_test_target.campaigns),
  2,
  'Both seeded campaigns rows survived the move'
);
select results_eq(
  $$ select name from legacy_bossa_test_target.campaigns order by id $$,
  $$ values ('Fixture Campaign A'), ('Fixture Campaign B') $$,
  'campaigns row content is byte-for-byte the same after the move, not regenerated'
);
select is(
  (select count(*)::int from legacy_bossa_test_target.orders),
  2,
  'Both seeded orders rows survived the move'
);

-- 12-14: the documented indexes moved with their table, not left behind.
select ok(to_regclass('legacy_bossa_test_target.orders_pkey') is not null, 'orders_pkey exists in the target schema');
select ok(to_regclass('legacy_bossa_test_target.idx_orders_created_at') is not null, 'idx_orders_created_at exists in the target schema');
select ok(to_regclass('legacy_bossa_test_target.idx_menu_items_active') is not null, 'idx_menu_items_active exists in the target schema');

-- 15-16: both legacy functions moved; their names are free again in source.
select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'legacy_bossa_test_target' and p.proname = 'set_updated_at'),
  'set_updated_at() now exists in the target schema'
);
select ok(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'legacy_fixture_ok' and p.proname = 'set_updated_at'),
  'set_updated_at() no longer occupies the name in the source schema -- free for a same-named function to be created there cleanly'
);

-- 17: the trigger on the moved table still resolves to a valid function --
-- proves the OID-based binding survived the schema move without needing
-- to be touched at all.
select ok(
  (
    select t.tgfoid is not null and (select count(*) from pg_proc where oid = t.tgfoid) = 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'legacy_bossa_test_target' and c.relname = 'orders' and t.tgname = 'set_orders_updated_at'
  ),
  'The moved trigger still resolves to exactly one valid function after the schema move'
);

-- 18: the trigger still actually fires and behaves correctly post-move
-- (not just "exists" -- genuinely still works).
select lives_ok(
  $$ update legacy_bossa_test_target.orders set order_status = 'confirmed' where order_status = 'requested' $$,
  'The moved trigger still fires without error on a real UPDATE after the move'
);

-- 19-20: the target schema is locked down; service_role keeps read access.
select ok(
  not exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'legacy_bossa_test_target' and grantee in ('anon', 'authenticated', 'PUBLIC')
  ),
  'anon/authenticated/PUBLIC have zero privileges on any table in the target schema'
);
select ok(
  exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'legacy_bossa_test_target' and table_name = 'orders' and grantee = 'service_role' and privilege_type = 'SELECT'
  ),
  'service_role retains SELECT on the moved tables for reconciliation work'
);

-- 21: a second call against the exact same (source, target) pair refuses
-- outright -- this cleanup must never silently run twice.
set local role service_role;
select ok(
  pg_temp.expect_error_message(
    $$ select public.perform_legacy_bossa_schema_cleanup('legacy_fixture_ok', 'legacy_bossa_test_target') $$
  ) like 'PRECONDITION_FAILED: target schema%already exists%',
  'Refuses to reuse a target schema that already exists -- never a silent rerun'
);
reset role;

-- ============================================================================
-- 22-24: the functions themselves are not runnable by ordinary roles.
-- ============================================================================

select ok(
  not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'perform_legacy_bossa_schema_cleanup' and grantee = 'authenticated'
  ),
  'authenticated cannot execute perform_legacy_bossa_schema_cleanup'
);
select ok(
  not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'perform_legacy_bossa_schema_cleanup' and grantee = 'anon'
  ),
  'anon cannot execute perform_legacy_bossa_schema_cleanup'
);
select ok(
  exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'perform_legacy_bossa_schema_cleanup' and grantee = 'service_role'
  ),
  'service_role can execute perform_legacy_bossa_schema_cleanup'
);

select * from finish();
rollback;

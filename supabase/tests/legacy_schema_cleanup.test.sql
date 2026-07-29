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

-- Defines perform_legacy_bossa_schema_cleanup() / verify_legacy_bossa_schema_cleanup(),
-- inlined byte-identical to supabase/production-ops/legacy_schema_cleanup.sql
-- (between its own matching SYNC-BEGIN/SYNC-END markers). Not \ir-included
-- from that file: `supabase test db` runs pgTAP inside a container that
-- only mounts supabase/tests/ -- a sibling directory like
-- supabase/production-ops/ is not visible to it (confirmed directly by a
-- real CI failure, "No such file or directory", when \ir was first tried).
-- tests/unit/supabase/legacy-schema-cleanup-sql-sync.test.ts asserts these
-- two copies stay byte-identical on every CI run, so the tested code and
-- the code that will actually run against bossa-ai-os never silently
-- drift apart despite living in two files.

-- SYNC-BEGIN: perform_legacy_bossa_schema_cleanup
-- Kept byte-identical to the copy inlined in
-- supabase/tests/legacy_schema_cleanup.test.sql, between its own matching
-- SYNC-BEGIN/SYNC-END markers -- tests/unit/supabase/legacy-schema-cleanup-
-- sql-sync.test.ts asserts this automatically on every CI run. Inlined
-- (not \ir-included from the test file) because `supabase test db` runs
-- pgTAP inside a container that only mounts supabase/tests/ -- a sibling
-- directory like supabase/production-ops/ is not visible to it, confirmed
-- directly by a real CI failure ("No such file or directory") when this
-- was first attempted via \ir.
-- =============================================================================
-- public.perform_legacy_bossa_schema_cleanup()
-- =============================================================================
-- Moves every documented legacy table (and the two legacy functions that
-- collide by name or are otherwise tied to them) out of `p_source_schema`
-- and into `p_target_schema`, then locks the target schema down to
-- service_role-only access. Fails closed -- raises a clear exception and
-- changes nothing -- if the live schema doesn't match the documented
-- inventory exactly, rather than silently skipping a missing object or
-- guessing. Idempotency is intentionally NOT provided for a second run
-- against an already-cleaned-up schema: if `p_target_schema` already
-- exists, this refuses outright, because silently no-op'ing on a rerun
-- would hide real drift (e.g. the first run partially failed, or something
-- else created that schema) behind an apparently-successful call.
create or replace function public.perform_legacy_bossa_schema_cleanup(
  p_source_schema text default 'public',
  p_target_schema text default 'legacy_bossa'
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_expected_tables text[] := array[
    'campaigns', 'weekly_briefs', 'whatsapp_leads', 'orders', 'menu_items',
    'bookings', 'users_profiles', 'kpi_daily', 'content_items',
    'decision_log', 'agent_runs'
  ];
  v_expected_indexes text[] := array[
    'orders_pkey', 'idx_orders_created_at', 'idx_orders_order_status',
    'menu_items_pkey', 'idx_menu_items_active'
  ];
  v_expected_functions text[] := array['set_updated_at', 'set_created_by_from_auth'];
  v_table text;
  v_index text;
  v_function text;
  v_missing_tables text[] := array[]::text[];
  v_missing_indexes text[] := array[]::text[];
  v_missing_functions text[] := array[]::text[];
begin
  -- Precondition 0: never run twice, and never run over something else's
  -- schema of the same name. A rerun after a genuine success (or a partial
  -- failure) must be investigated by a human, not silently retried.
  if exists (select 1 from pg_namespace where nspname = p_target_schema) then
    raise exception 'PRECONDITION_FAILED: target schema "%" already exists -- this cleanup has already run (or something else created it). Refusing to proceed; inspect manually.', p_target_schema;
  end if;

  -- Precondition 1: every documented legacy table exists in the source schema.
  foreach v_table in array v_expected_tables loop
    if to_regclass(format('%I.%I', p_source_schema, v_table)) is null then
      v_missing_tables := array_append(v_missing_tables, v_table);
    end if;
  end loop;
  if array_length(v_missing_tables, 1) > 0 then
    raise exception 'PRECONDITION_FAILED: expected legacy table(s) missing from "%": %. The documented inventory (docs/PRODUCTION_ACTIVATION_AUDIT.md) no longer matches the live schema -- stop and investigate before proceeding.', p_source_schema, array_to_string(v_missing_tables, ', ');
  end if;

  -- Precondition 2: every documented legacy index exists (the specific
  -- names a live inventory found attached to orders/menu_items).
  foreach v_index in array v_expected_indexes loop
    if to_regclass(format('%I.%I', p_source_schema, v_index)) is null then
      v_missing_indexes := array_append(v_missing_indexes, v_index);
    end if;
  end loop;
  if array_length(v_missing_indexes, 1) > 0 then
    raise exception 'PRECONDITION_FAILED: expected legacy index(es) missing from "%": %. Stop and investigate before proceeding.', p_source_schema, array_to_string(v_missing_indexes, ', ');
  end if;

  -- Precondition 3: both legacy functions this cleanup relocates exist,
  -- with the exact niladic trigger-function signature expected.
  foreach v_function in array v_expected_functions loop
    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = p_source_schema and p.proname = v_function and p.pronargs = 0
    ) then
      v_missing_functions := array_append(v_missing_functions, v_function);
    end if;
  end loop;
  if array_length(v_missing_functions, 1) > 0 then
    raise exception 'PRECONDITION_FAILED: expected legacy function(s) missing from "%": %. Stop and investigate before proceeding.', p_source_schema, array_to_string(v_missing_functions, ', ');
  end if;

  -- All preconditions satisfied. Proceed. `ALTER TABLE/FUNCTION ... SET
  -- SCHEMA` moves the object and everything it directly owns (indexes,
  -- constraints, triggers, and sequences owned by its columns) -- no
  -- separate rename or data copy of any kind, so table data and every
  -- attached object are preserved exactly. Trigger-to-function bindings
  -- are stored by OID, not by schema-qualified name, so moving a trigger
  -- function to a new schema never invalidates a trigger that calls it --
  -- verified explicitly by verify_legacy_bossa_schema_cleanup() below.
  execute format('create schema %I', p_target_schema);

  foreach v_table in array v_expected_tables loop
    execute format('alter table %I.%I set schema %I', p_source_schema, v_table, p_target_schema);
  end loop;

  foreach v_function in array v_expected_functions loop
    execute format('alter function %I.%I() set schema %I', p_source_schema, v_function, p_target_schema);
  end loop;

  -- Lock the target schema down: no anon/authenticated/PUBLIC access of
  -- any kind, and never add it to the hosted project's exposed-schema
  -- list (Project Settings -> API -- a dashboard setting this script
  -- cannot and does not touch). Only the minimum administrative access
  -- (service_role) is preserved, for the reconciliation work in
  -- docs/LEGACY_DATA_RECONCILIATION_PLAN.md.
  execute format('revoke all on schema %I from public, anon, authenticated', p_target_schema);
  execute format('revoke all on all tables in schema %I from public, anon, authenticated', p_target_schema);
  execute format('alter default privileges in schema %I revoke all on tables from public, anon, authenticated', p_target_schema);

  execute format('grant usage on schema %I to service_role', p_target_schema);
  execute format('grant select on all tables in schema %I to service_role', p_target_schema);

  raise notice 'Legacy schema cleanup complete: % table(s) and % function(s) moved from "%" into "%".',
    array_length(v_expected_tables, 1), array_length(v_expected_functions, 1), p_source_schema, p_target_schema;
end;
$$;

comment on function public.perform_legacy_bossa_schema_cleanup(text, text) is
  'One-time, manually-invoked cleanup moving bossa-ai-os''s legacy public-schema objects into an isolated schema before this repository''s own Phase 1-4 migrations are pushed. Never called automatically -- see docs/PRODUCTION_SCHEMA_COLLISION_CLEANUP_PLAN.md.';

revoke all on function public.perform_legacy_bossa_schema_cleanup(text, text) from public;
grant execute on function public.perform_legacy_bossa_schema_cleanup(text, text) to service_role;
-- SYNC-END: perform_legacy_bossa_schema_cleanup

-- SYNC-BEGIN: verify_legacy_bossa_schema_cleanup
-- Kept byte-identical to the copy inlined in
-- supabase/tests/legacy_schema_cleanup.test.sql -- see the matching note
-- above SYNC-BEGIN: perform_legacy_bossa_schema_cleanup.
-- =============================================================================
-- public.verify_legacy_bossa_schema_cleanup()
-- =============================================================================
-- Read-only. Reports one row per check, each independently pass/fail, so a
-- human (or a test) can see exactly what was verified rather than a single
-- opaque "ok" -- run this after perform_legacy_bossa_schema_cleanup() and
-- confirm every row's `passed` is true before proceeding to
-- `supabase db push`.
create or replace function public.verify_legacy_bossa_schema_cleanup(
  p_source_schema text default 'public',
  p_target_schema text default 'legacy_bossa'
)
returns table(check_name text, passed boolean, detail text)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_expected_tables text[] := array[
    'campaigns', 'weekly_briefs', 'whatsapp_leads', 'orders', 'menu_items',
    'bookings', 'users_profiles', 'kpi_daily', 'content_items',
    'decision_log', 'agent_runs'
  ];
  v_expected_indexes text[] := array[
    'orders_pkey', 'idx_orders_created_at', 'idx_orders_order_status',
    'menu_items_pkey', 'idx_menu_items_active'
  ];
  v_expected_functions text[] := array['set_updated_at', 'set_created_by_from_auth'];
  v_table text;
  v_index text;
  v_function text;
  v_missing text[];
  v_ok boolean;
begin
  -- 1: every expected table now exists in the target schema.
  v_missing := array[]::text[];
  foreach v_table in array v_expected_tables loop
    if to_regclass(format('%I.%I', p_target_schema, v_table)) is null then
      v_missing := array_append(v_missing, v_table);
    end if;
  end loop;
  v_ok := array_length(v_missing, 1) is null;
  return query select 'tables_moved_to_target_schema', v_ok,
    case when v_ok then format('all %s expected tables found in "%s"', array_length(v_expected_tables, 1), p_target_schema)
         else format('missing from "%s": %s', p_target_schema, array_to_string(v_missing, ', ')) end;

  -- 2: none of the legacy table names remain in the source schema.
  return query
    select 'source_schema_free_of_collisions',
      not exists (
        select 1 from information_schema.tables
        where table_schema = p_source_schema and table_name = any(v_expected_tables)
      ),
      format('expects zero of the legacy table names remaining in "%s"', p_source_schema);

  -- 3: every documented index still exists, now under the target schema
  -- (proves it moved WITH its table rather than being left behind).
  foreach v_index in array v_expected_indexes loop
    return query select
      'index_preserved:' || v_index,
      to_regclass(format('%I.%I', p_target_schema, v_index)) is not null,
      format('expected in "%s"', p_target_schema);
  end loop;

  -- 4: both legacy functions moved, and their names are now free in the
  -- source schema for this repository's own migrations to create cleanly.
  foreach v_function in array v_expected_functions loop
    return query select
      'function_moved:' || v_function,
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = p_target_schema and p.proname = v_function),
      format('expected in "%s"', p_target_schema);
    return query select
      'source_function_name_free:' || v_function,
      not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = p_source_schema and p.proname = v_function),
      format('"%s" must not exist in "%s" -- free for this repository''s own migration to create without a collision', v_function, p_source_schema);
  end loop;

  -- 5: the target schema is locked down to service_role only.
  return query select 'target_schema_locked_down',
    not exists (
      select 1 from information_schema.table_privileges
      where table_schema = p_target_schema and grantee in ('anon', 'authenticated', 'PUBLIC')
    ),
    format('anon/authenticated/PUBLIC must have zero privileges on any table in "%s"', p_target_schema);

  -- 6: every trigger on a moved table still resolves to exactly one valid
  -- function -- proves the OID-based trigger binding survived the move
  -- (it always does in Postgres, but this is the automated proof, not an
  -- assumption).
  return query
    select 'trigger_valid:' || n.nspname || '.' || c.relname || '.' || t.tgname,
      t.tgfoid is not null and (select count(*) from pg_proc where oid = t.tgfoid) = 1,
      'trigger function must still resolve to exactly one valid pg_proc row'
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = p_target_schema and not t.tgisinternal;
end;
$$;

comment on function public.verify_legacy_bossa_schema_cleanup(text, text) is
  'Read-only verification checks for perform_legacy_bossa_schema_cleanup() -- run after cleanup and confirm every returned row''s "passed" is true before proceeding. See docs/PRODUCTION_SCHEMA_COLLISION_CLEANUP_PLAN.md.';

revoke all on function public.verify_legacy_bossa_schema_cleanup(text, text) from public;
grant execute on function public.verify_legacy_bossa_schema_cleanup(text, text) to service_role;
-- SYNC-END: verify_legacy_bossa_schema_cleanup

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

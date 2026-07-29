-- Legacy schema cleanup for the permanent bossa-ai-os backend.
-- Issue #20 (Phase 4.5 Lane A) / #22 (Lane A2) / #23 (merged).
-- See docs/PRODUCTION_SCHEMA_COLLISION_CLEANUP_PLAN.md for the full design
-- and docs/PRODUCTION_DEPLOYMENT.md for the exact, ordered execution
-- procedure this script is one step of.
--
-- =============================================================================
-- THIS FILE IS DELIBERATELY NOT A supabase/migrations/*.sql FILE.
-- =============================================================================
--
-- Repository migrations apply uniformly, automatically, and in full to
-- every environment -- a fresh local `supabase db reset`, every CI run, and
-- eventually the real `bossa-ai-os` project via `supabase db push`. This
-- cleanup is the OPPOSITE of that: it must run exactly once, only against
-- the real `bossa-ai-os` project, only after explicit human review, and
-- strictly BEFORE this repository's own Phase 1-4 migrations are ever
-- pushed to that project (its whole purpose is freeing the `orders` and
-- `menu_items` names those migrations need). If this were a numbered
-- migration file, `supabase db push` would apply it and every later
-- migration in the same run, in one batch, with no way to pause for
-- verification in between -- exactly the sequencing this cleanup cannot
-- safely allow. Keeping it a standalone script, run deliberately and
-- separately via `psql`/the Supabase SQL Editor, is what makes the
-- ordered, checkpointed procedure in docs/PRODUCTION_DEPLOYMENT.md possible
-- at all.
--
-- Loading this file (running it once) only DEFINES two functions --
-- `public.perform_legacy_bossa_schema_cleanup()` and
-- `public.verify_legacy_bossa_schema_cleanup()`. Neither runs anything by
-- being defined; the actual cleanup only happens when
-- `select public.perform_legacy_bossa_schema_cleanup();` is called
-- explicitly, afterward, as its own separate, deliberate statement.
--
-- Both functions take the source/target schema names as parameters
-- (defaulting to the real 'public' -> 'legacy_bossa' move) specifically so
-- the same function bodies can also be loaded into a disposable, isolated
-- test schema and exercised end-to-end in
-- supabase/tests/legacy_schema_cleanup.test.sql, without ever touching a
-- real `public` table. That test file inlines a byte-identical copy of the
-- SYNC-BEGIN/SYNC-END-marked blocks below (rather than \ir-including this
-- file directly) because `supabase test db` runs pgTAP inside a container
-- that only mounts supabase/tests/ -- a sibling directory like this one is
-- not visible to it. tests/unit/supabase/legacy-schema-cleanup-sql-sync.
-- test.ts asserts the two copies stay identical on every CI run, so the
-- tested code and the code that will actually run against bossa-ai-os
-- never silently drift apart.
--
-- Never includes production secrets, PII, exported rows, checksums, or
-- local export paths -- this file only ever contains schema-shape SQL.

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

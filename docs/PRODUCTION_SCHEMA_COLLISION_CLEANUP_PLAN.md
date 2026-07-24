# Production Schema Collision Cleanup Plan

Issue #22 (Phase 4.5 Lane A2). The reviewed, forward-only strategy for reconciling `bossa-ai-os`'s existing legacy schema with this repository's own Phase 1–4 migrations before Lane A's remote migration procedure (`docs/PRODUCTION_DEPLOYMENT.md` § "Remote migration procedure") can run. **This plan is documentation only. No statement in this document has been executed. No cleanup, migration, or destructive change happens in this branch or PR.**

**Revision note:** an earlier version of this plan recommended renaming just `orders`/`menu_items` in place. A live inventory of the actual attached relations found that renaming the *tables* alone leaves their indexes and constraints behind under their original, schema-global names (`orders_pkey`, `idx_orders_created_at`, `idx_orders_order_status`, `menu_items_pkey`, `idx_menu_items_active`) — a rename-only approach was therefore insufficient and is replaced below by moving the legacy objects into their own schema entirely, which relocates a table's owned indexes/constraints/triggers along with it as a single atomic operation.

---

## The collision, precisely

`bossa-ai-os` (project ref `oqmftkttkfktyzefswpz`) carries 7 legacy migrations (`20260524154102_init_bossa_ai_os_core` through `20260524191621_enable_campaign_content_calendar_writes`) and 11 legacy public tables: `campaigns`, `weekly_briefs`, `whatsapp_leads`, `orders`, `menu_items`, `bookings`, `users_profiles`, `kpi_daily`, `content_items`, `decision_log`, `agent_runs`.

Two of those names — **`orders`** and **`menu_items`** — collide directly with tables this repository's own migrations create (`orders` in Phase 3; `menu_items` is reserved for Lane B). Their live attached relations, confirmed by direct inventory:

- `orders`: primary key `orders_pkey`, indexes `idx_orders_created_at`, `idx_orders_order_status`.
- `menu_items`: primary key `menu_items_pkey`, index `idx_menu_items_active`.

A **third, less obvious collision** was also found: this repository's own `20260721230001_extensions_and_helpers.sql` migration creates `public.set_updated_at()` via `create or replace function` — and the legacy project already has a function of the exact same name, `public.set_updated_at` (its own legacy migration is literally named `harden_set_updated_at_search_path`, strongly suggesting an equivalent "stamp `updated_at = now()`, pinned `search_path`" trigger function). Running `db push` will **silently overwrite the legacy function** with this repository's version via `create or replace` — see "Legacy functions" below for exactly what that implies and what must be verified first.

---

## Preconditions (all must be true before any statement below is executed)

1. **The Legacy Preservation Gate is fully complete** (`docs/LEGACY_DATA_RECONCILIATION_PLAN.md`): both projects' real exports have run, their manifests and checksums are independently re-verified, and live row counts match.
2. **Full schema metadata for every legacy table — not just row data — has been captured.** `scripts/export-legacy-supabase-data.ts` exports table *rows*, not column definitions, constraints, indexes, triggers, or dependent objects. Before any schema move, run the verification queries below against `bossa-ai-os` (read-only, via the Supabase SQL editor or an equivalent read-only session) and record the output alongside the row exports:

   ```sql
   -- Full column definitions for every legacy table
   select table_name, column_name, data_type, is_nullable, column_default
   from information_schema.columns
   where table_schema = 'public'
     and table_name in ('campaigns','weekly_briefs','whatsapp_leads','orders','menu_items',
                         'bookings','users_profiles','kpi_daily','content_items',
                         'decision_log','agent_runs')
   order by table_name, ordinal_position;

   -- Every index attached to each legacy table (confirms the live inventory above and catches any not yet listed)
   select tablename, indexname, indexdef
   from pg_indexes
   where schemaname = 'public'
     and tablename in ('campaigns','weekly_briefs','whatsapp_leads','orders','menu_items',
                        'bookings','users_profiles','kpi_daily','content_items',
                        'decision_log','agent_runs')
   order by tablename, indexname;

   -- What references `orders`/`menu_items` (foreign keys, views, functions) before either is touched
   select conname, conrelid::regclass as referencing_table, confrelid::regclass as referenced_table
   from pg_constraint
   where confrelid in ('public.orders'::regclass, 'public.menu_items'::regclass);

   select dependent_ns.nspname as dependent_schema, dependent_view.relname as dependent_view
   from pg_depend
   join pg_rewrite on pg_depend.objid = pg_rewrite.oid
   join pg_class as dependent_view on pg_rewrite.ev_class = dependent_view.oid
   join pg_class as source_table on pg_depend.refobjid = source_table.oid
   join pg_namespace dependent_ns on dependent_ns.oid = dependent_view.relnamespace
   where source_table.relname in ('orders', 'menu_items')
     and source_table.relnamespace = 'public'::regnamespace;

   -- RLS policies currently attached to every legacy table, not just the colliding two
   select schemaname, tablename, policyname, permissive, roles, cmd
   from pg_policies
   where tablename in ('campaigns','weekly_briefs','whatsapp_leads','orders','menu_items',
                        'bookings','users_profiles','kpi_daily','content_items',
                        'decision_log','agent_runs');

   -- Triggers on the colliding tables, and which function each one calls
   select event_object_table, trigger_name, action_statement
   from information_schema.triggers
   where event_object_schema = 'public'
     and event_object_table in ('orders', 'menu_items');
   ```

   Until this has been run and reviewed, the exact blast radius of moving `orders`/`menu_items` (and every other legacy table) is not fully known — this document does not assume it is empty just because the audit's row-count check found 0 rows in both.
3. **`bossa-ai-os`'s backup/PITR posture is confirmed** (`docs/PRODUCTION_DEPLOYMENT.md` § 12) — a schema-altering change should not be the first write to a project whose backup tier hasn't been verified.
4. **Explicit, separate, written destructive-change approval from Sahid** for the exact SQL statements about to run — not a general "go ahead" on this document, a review of the literal statements at execution time, since the precise list of objects to move may grow once precondition 2's dependency inventory comes back.

---

## The strategy: an isolated `legacy_bossa` schema, not a rename

Renaming a table in place (the prior version of this plan) does not touch that table's indexes, constraints, or triggers — they keep their original, schema-global names (`orders_pkey` stays `orders_pkey` even after `orders` becomes `legacy_orders_archived`), which does nothing to prevent a name collision at the index/constraint level once this repository's own migrations try to create their own `orders_pkey`. Moving the table to a **different schema** solves this correctly: `ALTER TABLE ... SET SCHEMA` relocates the table **and everything intrinsically owned by it** (its indexes, constraints, and triggers, since none of those have independent schema membership apart from their table) in one operation — no separate rename of `orders_pkey` is needed at all.

### Implementation: `supabase/production-ops/legacy_schema_cleanup.sql`

The actual cleanup is implemented as two PL/pgSQL functions in `supabase/production-ops/legacy_schema_cleanup.sql` — **deliberately not a `supabase/migrations/*.sql` file**. Repository migrations apply uniformly and automatically to every environment (a fresh local `supabase db reset`, every CI run, and eventually `bossa-ai-os` itself via `supabase db push`) — this cleanup is the opposite: it must run exactly once, only against `bossa-ai-os`, only after human review, and strictly *before* this repository's own migrations are pushed (its whole purpose is freeing the `orders`/`menu_items` names those migrations need). A numbered migration file could not express that ordering — `db push` applies every pending migration in one batch, with no pause for verification in between.

Loading the file only **defines** `public.perform_legacy_bossa_schema_cleanup()` and `public.verify_legacy_bossa_schema_cleanup()` — neither runs anything by being defined. The actual cleanup happens only when `select public.perform_legacy_bossa_schema_cleanup();` is run as its own explicit, separate statement (see `docs/PRODUCTION_DEPLOYMENT.md`'s controlled execution procedure). Both functions accept the source/target schema names as parameters (defaulting to the real `public` → `legacy_bossa` move) specifically so the *exact same file* can be exercised end-to-end in `supabase/tests/legacy_schema_cleanup.test.sql` against a disposable, synthetic fixture schema — real, CI-verified test coverage of the code that will actually run against `bossa-ai-os`, not a reimplementation of its logic.

`perform_legacy_bossa_schema_cleanup()` fails closed on every documented precondition before changing anything:

- Refuses outright if the target schema already exists (never a silent rerun).
- Raises a clear, specific exception naming exactly which documented table(s), index(es), or function(s) are missing from the source schema, rather than silently skipping a missing object or guessing.

Only if every precondition holds does it proceed: `create schema legacy_bossa`, move all 11 documented tables and the 2 documented functions into it (`alter table/function ... set schema`), then lock the new schema down — `revoke all ... from public, anon, authenticated`, `grant usage/select ... to service_role` only. **No `drop table` statement appears anywhere in this implementation** — a genuine deletion, if ever wanted after full reconciliation, is a separate, later, independently-approved decision, not part of this cleanup.

### `legacy_bossa` must never become an exposed schema

This is a **hosted-project dashboard setting** (Project Settings → API → "Exposed schemas"), not something a migration or `supabase/config.toml` controls — `config.toml`'s `[api] schemas = ["public", "graphql_public"]` only governs the *local* CLI stack. The precondition here is procedural: whoever performs this cleanup must confirm, in the dashboard, that `legacy_bossa` is never added to that list — the same way `private` (see below) already isn't. This should be checked as an explicit item in the verification step, not assumed.

### Legacy functions: inventory and disposition

| Function | Current schema | Referenced by this repository? | Disposition |
| --- | --- | --- | --- |
| `public.set_updated_at` | `public` | **Yes — collides.** This repository's own `20260721230001_extensions_and_helpers.sql` creates `public.set_updated_at()` via `create or replace function`, which would silently overwrite the legacy version in place if it were left in `public` when `db push` runs. | **Move**, same as the tables (`alter function public.set_updated_at() set schema legacy_bossa`) — implemented by `perform_legacy_bossa_schema_cleanup()`. An earlier version of this plan considered leaving it in place and relying on `create or replace function` to "safely upgrade" it, on the theory that the legacy migration name (`harden_set_updated_at_search_path`) suggests it's already behaviorally equivalent — moving it is strictly safer: it doesn't depend on that equivalence assumption holding, and Postgres binds a trigger to its function by OID, not by schema-qualified name, so every legacy trigger (on tables now living in `legacy_bossa`) keeps calling the exact same function object, unchanged, regardless of which schema it now lives in — proven directly in `supabase/tests/legacy_schema_cleanup.test.sql`, which updates a moved fixture row and confirms the trigger still fires correctly post-move. Once moved, the name `public.set_updated_at` is free, and this repository's own migration creates it fresh with no collision at all. |
| `public.set_created_by_from_auth` | `public` | No — this repository has no function of this name. | **Move** into `legacy_bossa` (`alter function public.set_created_by_from_auth() set schema legacy_bossa`) — implemented by the same function, since it is legacy-specific logic tied to the legacy tables now living there. |
| `private.is_bossa_operator` | `private` | No — this repository never creates or references a `private` schema. | **No action required, not moved by `perform_legacy_bossa_schema_cleanup()`.** The legacy migration name `move_operator_helper_to_private_schema` shows this was already deliberately isolated from `public`/PostgREST exposure by the original engineers, for the same reason this plan isolates the rest of the legacy schema now. It can be left exactly where it is (already non-exposed, already not colliding) or optionally moved into `legacy_bossa` later purely for consolidation — not required for the collision to be resolved. |

---

### Two separate, checkpointed steps — not one operation

1. **Step 1: load `supabase/production-ops/legacy_schema_cleanup.sql` against `bossa-ai-os`, then call `select public.perform_legacy_bossa_schema_cleanup();`.** Stop here. Run `select * from public.verify_legacy_bossa_schema_cleanup();` and confirm every returned row's `passed` is `true` before proceeding — see `docs/PRODUCTION_DEPLOYMENT.md`'s controlled execution procedure for the exact ordered steps.
2. **Step 2 (separate approval, separate session): `supabase link` + `supabase db push`** (`docs/PRODUCTION_DEPLOYMENT.md` § 3) to apply this repository's 31 real migrations (plus the 7 already-tracked historical markers — see `docs/PRODUCTION_DEPLOYMENT.md` § "Migration history alignment"), now that `orders`/`menu_items` and every index/constraint they own are out of `public` entirely.

Keeping these as two checkpoints — not one transaction, not one sitting — means step 1 can be verified safe on its own before step 2's much larger migration set runs, and means a problem discovered after step 1 doesn't also have to unwind a partially-applied migration set.

---

## Verification queries (run after step 1, before step 2)

**Primary tool:** `select * from public.verify_legacy_bossa_schema_cleanup();` — returns one row per check (tables moved, source schema free of collisions, each documented index present under the target schema, each documented function moved and its source name freed, the target schema locked down, every trigger on a moved table still resolving to a valid function). Confirm every row's `passed` is `true`. This automates exactly the manual queries below — the manual queries remain here for a human to double-check independently, not because the function is untrusted.

```sql
-- Every legacy table now lives in legacy_bossa, with all rows intact
select table_name from information_schema.tables where table_schema = 'legacy_bossa' order by table_name;
-- Expected: all 11 legacy table names

-- The colliding indexes/constraints moved WITH their tables (no separate rename needed)
select schemaname, tablename, indexname
from pg_indexes
where schemaname = 'legacy_bossa'
  and indexname in ('orders_pkey', 'idx_orders_created_at', 'idx_orders_order_status',
                     'menu_items_pkey', 'idx_menu_items_active');
-- Expected: all 5 rows, now under schemaname = 'legacy_bossa'

-- The names orders/menu_items are now free in public
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('orders', 'menu_items');
-- Expected: zero rows returned

-- legacy_bossa is locked down
select grantee, privilege_type from information_schema.table_privileges
where table_schema = 'legacy_bossa' and grantee in ('anon', 'authenticated', 'public');
-- Expected: zero rows returned

-- Confirm legacy_bossa is not in the hosted project's exposed-schema list
-- (Project Settings -> API -> Exposed schemas, dashboard-only, not queryable via SQL)
```

After step 2 (migrations applied):

```sql
-- The new orders table exists with THIS repository's shape, and is empty
-- (migrations create schema only, no data)
select count(*) from public.orders;   -- expected: 0

-- Confirm RLS is enabled and forced on it, matching every other Phase 1-4 table
select relrowsecurity, relforcerowsecurity from pg_class where relname = 'orders' and relnamespace = 'public'::regnamespace;

-- Confirm public.set_updated_at() now matches this repository's committed definition
select pg_get_functiondef('public.set_updated_at()'::regprocedure);
```

---

## Rollback / recovery strategy

- **After step 1 only (before step 2 runs):** reversible by moving every table AND both functions back — `alter table legacy_bossa.orders set schema public;` (repeated per table) and `alter function legacy_bossa.set_updated_at() set schema public;` / `alter function legacy_bossa.set_created_by_from_auth() set schema public;` restores the exact prior state, since nothing else has changed yet. The indexes/constraints move back with their tables for the same reason they moved forward with them, and the reverted `public.set_updated_at()` still has its original legacy body (a schema move never alters a function's definition).
- **After step 2 has also run:** no longer a simple move-back, because `public.orders`/`public.menu_items` (and `public.set_updated_at()`) now exist again under this repository's own shape (with their own new `orders_pkey`, etc. — which would itself collide with the legacy index name still sitting in `legacy_bossa`, though a same-named index in a *different* schema is not itself a conflict, only same-schema names are). Reverting at this point means: decide what to do with the new (empty) Phase 1–4 tables first, then move the legacy tables/functions back only if the new ones are removed or renamed out of the way — and separately decide the migration-tracking state via `supabase migration repair` if needed, per `docs/SUPABASE_OPERATIONS.md`'s existing rollback guidance. This is why step 1 and step 2 are kept as separate, independently-verified checkpoints above rather than one atomic change.
- **The legacy migration-history entries** (the 7 rows already tracked for `bossa-ai-os`) are never deleted or edited by this plan — see `docs/PRODUCTION_DEPLOYMENT.md` § "Migration history alignment" for how they coexist with this repository's own tracked migrations going forward.
- **The Legacy Preservation Gate's exports remain the backstop of last resort** for the actual data, independent of any schema-move/rollback mechanics above — see `docs/LEGACY_DATA_RECONCILIATION_PLAN.md`.
- **After step 1 is verified successful and step 2 has also completed cleanly**, drop the two administrative functions themselves — `drop function public.perform_legacy_bossa_schema_cleanup(text, text);` and `drop function public.verify_legacy_bossa_schema_cleanup(text, text);` — as the final manual step. They are a one-time operational tool, not a permanent fixture; leaving an unused `security definer` function with DDL capability sitting in production indefinitely is an avoidable, standing risk surface once its one job is done. This is never automated (no self-dropping) — a human confirms verification passed first.

---

## What this plan explicitly does not decide

- Whether `legacy_bossa`'s tables (or the schema itself) are ever actually dropped, and when — a separate, later, independently-approved decision.
- The exact reconciliation destination for each dataset (`docs/LEGACY_DATA_RECONCILIATION_PLAN.md` owns that).
- Whether Path B (a new, clean Supabase project, per `docs/PRODUCTION_DEPLOYMENT.md` § "Migration collision decision") is chosen instead of this cleanup — this document only elaborates Path A's execution detail, since D1 already locked `bossa-ai-os` as the permanent backend, but Path B remains available if any precondition above cannot be met.

## Approval gate

**No statement in this document may be executed without Sahid's explicit, separate destructive-change approval, reviewed against the actual dependency-inventory output from precondition 2 — not this document alone.** This plan is a reviewed proposal, not a standing authorization.

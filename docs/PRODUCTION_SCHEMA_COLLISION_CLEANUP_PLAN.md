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

```sql
-- Executed directly against bossa-ai-os (SQL editor or a dedicated, reviewed
-- one-off script) — NEVER as a supabase/migrations/*.sql file, since repo
-- migrations apply uniformly to every environment (including a from-empty
-- local `supabase db reset`), where no such legacy schema exists to move.

begin;

create schema if not exists legacy_bossa;

alter table public.campaigns       set schema legacy_bossa;
alter table public.weekly_briefs   set schema legacy_bossa;
alter table public.whatsapp_leads  set schema legacy_bossa;
alter table public.orders          set schema legacy_bossa;
alter table public.menu_items      set schema legacy_bossa;
alter table public.bookings        set schema legacy_bossa;
alter table public.users_profiles  set schema legacy_bossa;
alter table public.kpi_daily       set schema legacy_bossa;
alter table public.content_items   set schema legacy_bossa;
alter table public.decision_log    set schema legacy_bossa;
alter table public.agent_runs      set schema legacy_bossa;

-- Lock the schema down: no authenticated/anon/public access of any kind.
revoke all on schema legacy_bossa from public, authenticated, anon;
revoke all on all tables in schema legacy_bossa from public, authenticated, anon;
alter default privileges in schema legacy_bossa revoke all on tables from public, authenticated, anon;

-- Preserve read access for reconciliation work, explicitly (service_role
-- already bypasses RLS/grants by design, but this documents intent and
-- costs nothing).
grant usage on schema legacy_bossa to service_role;
grant select on all tables in schema legacy_bossa to service_role;

commit;
```

Row data is untouched by a schema move — every legacy row remains exactly as it was, still queryable by `service_role`, still exportable, even after this step. **No `drop table` statement appears anywhere in this plan** — a genuine deletion, if ever wanted after full reconciliation, is a separate, later, independently-approved decision, not part of this cleanup.

### `legacy_bossa` must never become an exposed schema

This is a **hosted-project dashboard setting** (Project Settings → API → "Exposed schemas"), not something a migration or `supabase/config.toml` controls — `config.toml`'s `[api] schemas = ["public", "graphql_public"]` only governs the *local* CLI stack. The precondition here is procedural: whoever performs this cleanup must confirm, in the dashboard, that `legacy_bossa` is never added to that list — the same way `private` (see below) already isn't. This should be checked as an explicit item in the verification step, not assumed.

### Legacy functions: inventory and disposition

| Function | Current schema | Referenced by this repository? | Disposition |
| --- | --- | --- | --- |
| `public.set_updated_at` | `public` | **Yes — collides.** This repository's own `20260721230001_extensions_and_helpers.sql` creates `public.set_updated_at()` via `create or replace function`, which will silently overwrite the legacy version when `db push` runs. | **Do not move.** Instead, before `db push`: (a) capture the legacy function's exact current body (`select pg_get_functiondef('public.set_updated_at()'::regprocedure);`) for the record: (b) confirm it is behaviorally equivalent to this repository's version (`new.updated_at = now(); return new;`, `search_path` pinned) — the legacy migration name `harden_set_updated_at_search_path` strongly suggests it already is; (c) confirm every legacy table whose triggers call it actually has an `updated_at` column, since this repository's version assumes one exists and would error on `BEFORE UPDATE` for any legacy table missing it. If all three hold, `create or replace function` safely upgrades the legacy function in place and every legacy trigger (on tables now living in `legacy_bossa`) keeps working unchanged, since a trigger binds to its function by OID, not by the function's schema location. |
| `public.set_created_by_from_auth` | `public` | No — this repository has no function of this name. | Move into `legacy_bossa` for consistency (`alter function public.set_created_by_from_auth() set schema legacy_bossa;`), since it is legacy-specific logic tied to the legacy tables now living there. Verify first (precondition 2's trigger query) which legacy tables actually call it. |
| `private.is_bossa_operator` | `private` | No — this repository never creates or references a `private` schema. | **No action required.** The legacy migration name `move_operator_helper_to_private_schema` shows this was already deliberately isolated from `public`/PostgREST exposure by the original engineers, for the same reason this plan isolates the rest of the legacy schema now. It can be left exactly where it is (already non-exposed, already not colliding) or optionally moved into `legacy_bossa` later purely for consolidation — not required for the collision to be resolved. |

---

### Two separate, checkpointed steps — not one operation

1. **Step 1: run the schema move above against `bossa-ai-os`.** Stop here. Re-run the verification queries below to confirm every table's indexes/constraints/triggers moved with it and nothing else broke.
2. **Step 2 (separate approval, separate session): `supabase link` + `supabase db push`** (`docs/PRODUCTION_DEPLOYMENT.md` § 3) to apply this repository's 31 real migrations (plus the 7 already-tracked historical markers — see `docs/PRODUCTION_DEPLOYMENT.md` § "Migration history alignment"), now that `orders`/`menu_items` and every index/constraint they own are out of `public` entirely.

Keeping these as two checkpoints — not one transaction, not one sitting — means step 1 can be verified safe on its own before step 2's much larger migration set runs, and means a problem discovered after step 1 doesn't also have to unwind a partially-applied migration set.

---

## Verification queries (run after step 1, before step 2)

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

- **After step 1 only (before step 2 runs):** reversible by moving every table back — `alter table legacy_bossa.orders set schema public;` (repeated per table) restores the exact prior state, since nothing else has changed yet. The indexes/constraints move back with their tables for the same reason they moved forward with them.
- **After step 2 has also run:** no longer a simple move-back, because `public.orders`/`public.menu_items` now exist again under the new Phase 1–4 shape (with their own new `orders_pkey`, etc. — which would itself collide with the legacy index name still sitting in `legacy_bossa`, though a same-named index in a *different* schema is not itself a conflict, only same-schema names are). Reverting at this point means: decide what to do with the new (empty) Phase 1–4 tables first, then move the legacy tables back only if the new ones are removed or renamed out of the way — and separately decide the migration-tracking state via `supabase migration repair` if needed, per `docs/SUPABASE_OPERATIONS.md`'s existing rollback guidance. This is why step 1 and step 2 are kept as separate, independently-verified checkpoints above rather than one atomic change.
- **The legacy migration-history entries** (the 7 rows already tracked for `bossa-ai-os`) are never deleted or edited by this plan — see `docs/PRODUCTION_DEPLOYMENT.md` § "Migration history alignment" for how they coexist with this repository's own tracked migrations going forward.
- **The Legacy Preservation Gate's exports remain the backstop of last resort** for the actual data, independent of any schema-move/rollback mechanics above — see `docs/LEGACY_DATA_RECONCILIATION_PLAN.md`.

---

## What this plan explicitly does not decide

- Whether `legacy_bossa`'s tables (or the schema itself) are ever actually dropped, and when — a separate, later, independently-approved decision.
- The exact reconciliation destination for each dataset (`docs/LEGACY_DATA_RECONCILIATION_PLAN.md` owns that).
- Whether Path B (a new, clean Supabase project, per `docs/PRODUCTION_DEPLOYMENT.md` § "Migration collision decision") is chosen instead of this cleanup — this document only elaborates Path A's execution detail, since D1 already locked `bossa-ai-os` as the permanent backend, but Path B remains available if any precondition above cannot be met.

## Approval gate

**No statement in this document may be executed without Sahid's explicit, separate destructive-change approval, reviewed against the actual dependency-inventory output from precondition 2 — not this document alone.** This plan is a reviewed proposal, not a standing authorization.

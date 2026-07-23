# Production Schema Collision Cleanup Plan

Issue #22 (Phase 4.5 Lane A2). The reviewed, forward-only strategy for reconciling `bossa-ai-os`'s existing legacy schema with this repository's own Phase 1–4 migrations before Lane A's remote migration procedure (`docs/PRODUCTION_DEPLOYMENT.md` § "Remote migration procedure") can run. **This plan is documentation only. No statement in this document has been executed. No cleanup, migration, or destructive change happens in this branch or PR.**

---

## The collision, precisely

`bossa-ai-os` (project ref `oqmftkttkfktyzefswpz`) carries 7 legacy migrations (`20260524154102_init_bossa_ai_os_core` through `20260524191621_enable_campaign_content_calendar_writes`) and 11 legacy public tables: `campaigns`, `weekly_briefs`, `whatsapp_leads`, `orders`, `menu_items`, `bookings`, `users_profiles`, `kpi_daily`, `content_items`, `decision_log`, `agent_runs`.

Two of those names — **`orders`** and **`menu_items`** — collide directly with tables this repository's own migrations create (`orders` in Phase 3; `menu_items` is reserved for Lane B). `supabase db push` cannot cleanly apply while both exist under the same names in the same schema. The other 9 legacy tables (and the 7 legacy migration-history entries) don't collide by name, but they are still foreign objects in what will become the multi-tenant production schema and must be accounted for, not just left in place unexamined.

---

## Preconditions (all must be true before any statement below is executed)

1. **The Legacy Preservation Gate is fully complete** (`docs/LEGACY_DATA_RECONCILIATION_PLAN.md`): both projects' real exports have run, their manifests and checksums are independently re-verified, and live row counts match. As of this document, that gate has **not** been executed — see the reconciliation plan's "Execution status" section.
2. **Full schema metadata for every legacy table — not just row data — has been captured.** `scripts/export-legacy-supabase-data.ts` (as merged) exports table *rows*, not column definitions, constraints, indexes, triggers, or dependent objects. Before any rename or drop, run the verification queries below against `bossa-ai-os` (read-only, via the Supabase SQL editor or an equivalent read-only session) and record the output alongside the row exports:

   ```sql
   -- Full column definitions for every legacy table
   select table_name, column_name, data_type, is_nullable, column_default
   from information_schema.columns
   where table_schema = 'public'
     and table_name in ('campaigns','weekly_briefs','whatsapp_leads','orders','menu_items',
                         'bookings','users_profiles','kpi_daily','content_items',
                         'decision_log','agent_runs')
   order by table_name, ordinal_position;

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

   -- RLS policies currently attached to the colliding tables
   select schemaname, tablename, policyname, permissive, roles, cmd
   from pg_policies
   where tablename in ('orders', 'menu_items');
   ```

   Until this has been run and reviewed, the exact blast radius of renaming `orders`/`menu_items` is not fully known — this document does not assume it is empty just because the audit's row-count check found 0 rows in both.
3. **`bossa-ai-os`'s backup/PITR posture is confirmed** (`docs/PRODUCTION_DEPLOYMENT.md` § 12) — a destructive-adjacent change (even a `rename`) should not be the first write to a project whose backup tier hasn't been verified.
4. **Explicit, separate, written destructive-change approval from Sahid** for the exact SQL statements about to run — not a general "go ahead" on this document, a review of the literal statements at execution time, since the precise list of objects to rename may grow once precondition 2's dependency inventory comes back.

---

## The strategy: rename-and-archive, never drop

Every legacy table this plan touches is **renamed**, never dropped, and never truncated. This is deliberately the least destructive operation that still frees the colliding names:

```sql
-- Executed directly against bossa-ai-os (SQL editor or a dedicated, reviewed
-- one-off script) — NEVER as a supabase/migrations/*.sql file, since repo
-- migrations apply uniformly to every environment (including a from-empty
-- local `supabase db reset`), where no such legacy table exists to rename.

begin;

alter table public.orders rename to legacy_orders_archived;
alter table public.menu_items rename to legacy_menu_items_archived;

-- Repeat only for any other legacy table precondition 2's dependency
-- inventory shows must move out of the way of a Phase 1-4 or Lane B name —
-- as of this plan, only orders/menu_items are known to collide.

commit;
```

Row data is untouched by a rename — every legacy row in `legacy_orders_archived`/`legacy_menu_items_archived` remains exactly as it was, still queryable, still exportable, even after this step. This table intentionally does not include a `drop table` statement anywhere — a genuine deletion, if ever wanted after full reconciliation, is a separate, later, independently-approved decision, not part of this cleanup.

### Two separate, checkpointed steps — not one operation

1. **Step 1: run the rename above against `bossa-ai-os`.** Stop here. Re-run the verification queries in "Verification" below to confirm the rename succeeded cleanly and nothing else broke (no view/function left dangling on the old name).
2. **Step 2 (separate approval, separate session): `supabase link` + `supabase db push`** (`docs/PRODUCTION_DEPLOYMENT.md` § 3) to apply this repository's 33 migrations, now that `orders`/`menu_items` are free names.

Keeping these as two checkpoints — not one transaction, not one sitting — means step 1 can be verified safe on its own before step 2's much larger migration set runs, and means a problem discovered after step 1 doesn't also have to unwind a partially-applied migration set.

---

## Verification queries (run after step 1, before step 2)

```sql
-- The renamed legacy tables exist under their new names, with all rows intact
select count(*) from public.legacy_orders_archived;
select count(*) from public.legacy_menu_items_archived;

-- The names orders/menu_items are now free
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('orders', 'menu_items');
-- Expected: zero rows returned

-- Nothing references the old names anymore (re-run precondition 2's dependency query)
```

After step 2 (migrations applied):

```sql
-- The new orders table exists with THIS repository's shape, and is empty
-- (migrations create schema only, no data)
select count(*) from public.orders;   -- expected: 0

-- Confirm RLS is enabled and forced on it, matching every other Phase 1-4 table
select relrowsecurity, relforcerowsecurity from pg_class where relname = 'orders';
```

---

## Rollback / recovery strategy

- **After step 1 only (before step 2 runs):** trivially reversible — `alter table public.legacy_orders_archived rename to orders; alter table public.legacy_menu_items_archived rename to menu_items;` restores the exact prior state, since nothing else has changed yet.
- **After step 2 has also run:** no longer a simple rename-back, because `public.orders`/`public.menu_items` now exist again under the new Phase 1–4 shape. Reverting at this point means: rename the *new* empty tables out of the way first (e.g. `phase4_orders_pending_revert`), rename `legacy_orders_archived`/`legacy_menu_items_archived` back to `orders`/`menu_items`, then decide separately what to do with the new tables' migration-tracking state (likely `supabase migration repair` to mark them as not-applied, per `docs/SUPABASE_OPERATIONS.md`'s existing rollback guidance). This is why step 1 and step 2 are kept as separate, independently-verified checkpoints above rather than one atomic change — the rollback story is materially simpler if a problem is caught between them.
- **The legacy migration-history entries** (the 7 rows already tracked for `bossa-ai-os`) are never deleted or edited by this plan — Supabase's own migration-history table is append-only tracking, and `docs/SUPABASE_OPERATIONS.md`'s existing rule (never rewrite an already-applied migration's history) applies here unchanged. They simply continue to exist as a historical record alongside the 33 new entries `db push` will add.
- **The Legacy Preservation Gate's exports remain the backstop of last resort** for the actual data, independent of any rename/rollback mechanics above — see `docs/LEGACY_DATA_RECONCILIATION_PLAN.md`.

---

## What this plan explicitly does not decide

- Whether `legacy_orders_archived`/`legacy_menu_items_archived` (and any other renamed table) are ever actually dropped, and when — a separate, later, independently-approved decision.
- The exact reconciliation destination for each dataset (`docs/LEGACY_DATA_RECONCILIATION_PLAN.md` owns that).
- Whether Path B (a new, clean Supabase project, per `docs/PRODUCTION_DEPLOYMENT.md` § "Migration collision decision") is chosen instead of this cleanup — this document only elaborates Path A's execution detail, since D1 already locked `bossa-ai-os` as the permanent backend, but Path B remains available if any precondition above cannot be met.

## Approval gate

**No statement in this document may be executed without Sahid's explicit, separate destructive-change approval, reviewed against the actual dependency-inventory output from precondition 2 — not this document alone.** This plan is a reviewed proposal, not a standing authorization.

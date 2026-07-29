# Production Deployment Runbook

Step-by-step procedure for taking Hospitality OS from `mock` mode to a real, live Supabase-backed production deployment for BOSSA and Papai. Companion to `docs/PRODUCTION_ACTIVATION_AUDIT.md` (the audit findings this runbook is based on) and `docs/SUPABASE_OPERATIONS.md` (local dev operations). **Nothing in this document has been executed against a real project.** It is the documented procedure Sahid follows manually, in order — this PR ships the documentation and read-only tooling only; it does not export, migrate, or delete anything in either live project.

---

## 0. Decisions (locked, per the completed live comparison)

- **D1 — Permanent Supabase project: `bossa-ai-os` (project ref `oqmftkttkfktyzefswpz`).** Locked, subject to complete preservation/export and reconciliation of its existing legacy rows before any cleanup of the colliding legacy objects (§1, §2). `Bossa Asado i Mar` (project ref `zgfncoexiqnqeqaxpqdy`) remains **read-only legacy/source** until its 8 `bossa_leads` rows are exported, mapped, and reconciled — it is not, and will not become, the platform backend. This runbook refers to `bossa-ai-os` by name from here on, not `<chosen-project-ref>`.
- **D2 — Public self-signup: disabled.** Production is invite-only. No self-serve registration.
- **D4 — Email confirmation: required.** Real production users must confirm their email (opposite of the local-dev default).
- **D5 — Cutover gate.** `DASHBOARD_DATA_PROVIDER=supabase` may only be set in Vercel Production after **all** of: schema readiness (§2's chosen path fully executed, migrations applied and verified), tenant bootstrap (§7), auth configuration (§5), deployed smoke-testing readiness (§8), and documented rollback readiness (§11) are in place. See § 9's cutover checklist for the exact ordered gate.
- **D3 — root page cutover-awareness** remains open/deferred (product UX decision, not a blocker — see the audit's "Root page always renders the mock tenant list").

---

## 1. Legacy Preservation Gate (mandatory, before any migration or cleanup)

`bossa-ai-os` and `Bossa Asado i Mar` both hold real, live legacy data that predates this repository (audit §3). **No migration, no schema cleanup, and no destructive change may happen in either project until every item below is complete and recorded.** This gate exists precisely so path A in §2 (if chosen) can never proceed on assumption instead of verified, checksummed evidence.

For **each** project, before touching anything:

- [ ] Export schema metadata (table definitions, column types, constraints) for every existing table.
- [ ] Export every row of every **non-empty** table (see "Required preserved datasets" below — do not skip a table just because it looks unimportant).
- [ ] Export auth-user metadata **without password hashes or any secret material** (id, email, created/confirmed/last-sign-in timestamps only — never `encrypted_password`, tokens, or anything GoTrue's admin API doesn't already treat as safe-to-read metadata).
- [ ] Record the source project ref for every export.
- [ ] Record the table name for every export.
- [ ] Record the export timestamp for every export.
- [ ] Record the row count for every export.
- [ ] Record a SHA-256 file checksum for every export.
- [ ] Record a destination/import decision for every export (even if that decision is initially "pending reconciliation" — it must be written down, not left implicit).
- [ ] Store every export **outside the public repository** (a local, `.gitignore`d directory — see § "Legacy export utility" below — never committed to Git, never uploaded anywhere the repository's CI or a public artifact could expose it).
- [ ] **Never commit PII or a production export to Git**, under any circumstance, including inside a `.legacy-exports/` working directory that happens to be un-ignored by mistake — verify `.gitignore` before running the export tool for real.

### Required preserved datasets

- **`bossa-ai-os`**: `campaigns` (3 rows), `weekly_briefs` (1 row), `kpi_daily` (1 row), `decision_log` (2 rows), and the existing auth-user identity metadata (1 user). Every other legacy table in this project was verified empty (0 rows) at audit time, but re-verify row counts at export time — data may have changed since the audit.
- **`Bossa Asado i Mar`**: all 8 `bossa_leads` rows.

### Legacy export utility

`scripts/export-legacy-supabase-data.ts` (added by this PR) is the read-only tool for this gate — see its own header comment and `docs/PRODUCTION_ACTIVATION_AUDIT.md` for the full design. It validates that `--project` actually matches the project ref reachable at `LEGACY_SUPABASE_URL` before reading anything (refuses a cross-wired URL outright), paginates every table to exhaustion ordered by `id`, and only writes any file at all once every requested dataset has been fully validated — a partial failure writes nothing but a `status: "failed"` manifest, never a partial set of data files.

**Never type a real secret key directly into a shared terminal history or paste it into chat, a GitHub issue/PR, or Notion.** Set both variables in your own local PowerShell session only, for the duration of the command:

```powershell
# Dry run / list mode first — prints what would be exported, row counts, nothing written, no credentials required for this step.
npm run export:legacy-data -- --project=bossa-ai-os

# Set the real credentials in your own PowerShell session (not committed, not pasted anywhere):
$env:LEGACY_SUPABASE_URL = "https://oqmftkttkfktyzefswpz.supabase.co"
$env:LEGACY_SUPABASE_SECRET_KEY = "<paste the bossa-ai-os service_role key here, in your terminal only>"

# Actually write the export (JSON per table + a checksummed manifest) to the gitignored output directory:
npm run export:legacy-data -- --project=bossa-ai-os --confirm

# Clear the credentials from this session before switching projects:
Remove-Item Env:\LEGACY_SUPABASE_URL, Env:\LEGACY_SUPABASE_SECRET_KEY

# Repeat for Bossa Asado i Mar with its own URL/secret key:
$env:LEGACY_SUPABASE_URL = "https://zgfncoexiqnqeqaxpqdy.supabase.co"
$env:LEGACY_SUPABASE_SECRET_KEY = "<paste the Bossa Asado i Mar service_role key here, in your terminal only>"
npm run export:legacy-data -- --project=bossa-asado-i-mar --confirm
Remove-Item Env:\LEGACY_SUPABASE_URL, Env:\LEGACY_SUPABASE_SECRET_KEY
```

(Bash-equivalent, if run from a Unix shell instead: `LEGACY_SUPABASE_URL=... LEGACY_SUPABASE_SECRET_KEY=... npm run export:legacy-data -- --project=bossa-ai-os --confirm`.)

It only ever issues `select` reads (and the GoTrue admin `listUsers` read for auth identities) — it has no delete, update, or DDL capability at all, by construction, not just by convention.

**After a real run**, verify it independently rather than trusting the manifest alone: re-run the dry-run/list mode's row counts against the live project (via the dashboard's Table Editor or a read-only SQL count) and confirm they match `manifest.json`'s `rowCount` per table, and recompute each table's own JSON file's SHA-256 (e.g. `Get-FileHash -Algorithm SHA256 .legacy-exports\bossa-ai-os\campaigns.json` in PowerShell) and confirm it matches the manifest's `checksumSha256` for that table.

---

## 2. Migration collision decision

`bossa-ai-os` already has tables named `orders` and `menu_items` (audit §3, "Collision risk") — this repository's own `orders` table (Phase 3) and Lane B's future `menu_items` table will collide with them. **Two paths are documented below. Neither is executed by this PR.** Choosing and executing one is a separate, explicit, deliberate action Sahid takes after the Legacy Preservation Gate (§1) is fully complete for `bossa-ai-os`.

### Path A — clean up the existing project

Export and verify everything (§1), then remove or archive the colliding legacy objects (`orders`, `menu_items`, and any other legacy table not in the "required preserved datasets" list) from `bossa-ai-os`, then apply this repository's migrations to the now-clear schema.

**Recommended only if all of the following are true:**

- Every export's checksum has been independently verified against the live source table (re-query and re-hash, don't trust a single export run).
- `bossa-ai-os`'s backup posture has been confirmed and recorded (§12) — a destructive change on a project with no verified backup is not acceptable.
- An explicit, separate destructive-change approval has been given for the specific `drop`/`archive` statements about to run — not a general "go ahead," a reviewed SQL plan.
- A tested collision-cleanup SQL plan exists — see `docs/PRODUCTION_SCHEMA_COLLISION_CLEANUP_PLAN.md` for the exact strategy (moving every legacy table into its own `legacy_bossa` schema via `ALTER TABLE ... SET SCHEMA`, never a `drop`, so the exported data also stays queryable in place as a second safety net) — and has been dry-run/reviewed before executing against the real project.

### Path A's exact controlled execution procedure

The implementation is `supabase/production-ops/legacy_schema_cleanup.sql` (`public.perform_legacy_bossa_schema_cleanup()` / `public.verify_legacy_bossa_schema_cleanup()`, both fail-closed on any precondition mismatch — see `docs/PRODUCTION_SCHEMA_COLLISION_CLEANUP_PLAN.md` for the full design). **None of the steps below have been executed against `bossa-ai-os` as of this PR.** Follow them in order; do not skip ahead.

1. **Preflight inventory.** Re-confirm the live legacy inventory still matches what's documented (`docs/PRODUCTION_ACTIVATION_AUDIT.md` §3): the 11 legacy tables, the 5 named indexes on `orders`/`menu_items`, and the 2 legacy functions (`set_updated_at`, `set_created_by_from_auth`) all still exist in `public`, with the same row counts recorded in the original audit (re-verify — data may have changed since). If anything has drifted, stop and update the documented inventory before proceeding; do not adjust the cleanup script to match unreviewed live drift.
2. **Backup/export verification.** The Legacy Preservation Gate (§1) must be fully complete and independently re-verified for `bossa-ai-os` — every required dataset exported, every checksum recomputed from disk and matched against the manifest, every live row count re-queried and matched. Also confirm `bossa-ai-os`'s backup tier and retention window (§12) — do not proceed on a project with an unconfirmed backup posture.
3. **Dry-run inspection.** Load `supabase/production-ops/legacy_schema_cleanup.sql` against `bossa-ai-os` (defines the two functions; changes nothing else). Do **not** call `perform_legacy_bossa_schema_cleanup()` yet. Instead, manually re-run the precondition-equivalent queries in `docs/PRODUCTION_SCHEMA_COLLISION_CLEANUP_PLAN.md`'s "Preconditions" section (`information_schema.columns`, `pg_indexes`, `pg_constraint`, `pg_depend`, `pg_policies`, `information_schema.triggers`) to inspect exactly what the real cleanup would touch, before it touches anything.
4. **Owner approval gate.** Present the preflight inventory and dry-run inspection results to Sahid for explicit, separate destructive-change approval — not a general "go ahead," a review of the literal `perform_legacy_bossa_schema_cleanup()` call about to run and what step 3 found. Do not proceed past this point without that explicit sign-off.
5. **Linked migration list (informational, before touching the target schema).** `supabase link --project-ref oqmftkttkfktyzefswpz` then `supabase migration list --linked` — confirm the 7 legacy versions show as already applied on Remote, and this repository's 31 real migrations show as pending (Local only). This confirms the link is correct and the migration history matches expectations *before* any schema change, per `docs/PRODUCTION_DEPLOYMENT.md` § "Migration history alignment" below.
6. **Apply the cleanup.** Only after step 4's approval: `select public.perform_legacy_bossa_schema_cleanup();` against `bossa-ai-os`. This is the one statement that actually moves anything — everything before it was read-only inspection.
7. **Post-migration verification.** `select * from public.verify_legacy_bossa_schema_cleanup();` and confirm every returned row's `passed` is `true`. Cross-check against the manual verification queries in `docs/PRODUCTION_SCHEMA_COLLISION_CLEANUP_PLAN.md` independently — do not rely on the function's own report alone for a change this consequential. Confirm in the Supabase dashboard that `legacy_bossa` has not been added to Project Settings → API → Exposed Schemas.
8. **Stop.** Do not proceed to `supabase db push` (§3), tenant bootstrap (§7), or any Vercel configuration change (§6, §9) in the same sitting. Each of those remains its own separate, deliberate, later action — this procedure's job ends once step 7 passes.

### Path B — provision a new, clean project

Create a new Supabase project with no legacy schema at all, apply this repository's migrations there, and preserve `bossa-ai-os` (and `Bossa Asado i Mar`) purely as legacy/read-only sources for the export-and-reconcile work. This avoids any destructive action on `bossa-ai-os` entirely, at the cost of `bossa-ai-os` no longer being the literal backend (only the export/reconciliation source), which would revise D1.

### What this PR does NOT do

Neither path is executed here. This PR ships the Legacy Preservation Gate's documentation and export tooling only, so that whichever path is chosen next, the "verify exports first" precondition is already satisfied by process, not by memory.

---

## 3. Remote migration procedure

**Do not run this against `bossa-ai-os` as it exists today** — the collision in §2 must be resolved first (path A's cleanup executed, or path B's new project chosen). Once the target schema is clear:

```bash
supabase link --project-ref <target-project-ref>
supabase db push
```

This applies this repository's 31 real Phase 1–4 migrations — every table, RLS policy, function, trigger, grant, and the platform-wide roles/permissions/role_permissions catalog — to the linked project. It moves **no business data**; migrations and bootstrap data are deliberately separate steps (§4 below).

### Migration history alignment (read before running `db push`)

**`db push` does not simply append this repository's 31 migrations to an empty history.** `bossa-ai-os` already has 7 legacy migration versions tracked as applied on its remote `supabase_migrations.schema_migrations` table (`20260524154102` through `20260524191621` — see `docs/PRODUCTION_ACTIVATION_AUDIT.md` §3 and `docs/PRODUCTION_SCHEMA_COLLISION_CLEANUP_PLAN.md`). Before this PR, this repository's local `supabase/migrations/` directory had no files at those 7 versions at all — a `supabase migration list --linked` against `bossa-ai-os` would have shown those 7 as **Remote-only**, a genuine local/remote mismatch, not simply "not yet pushed."

This is now resolved by 7 committed **historical marker migrations**, at the exact same versions and names as the tracked remote entries (`20260524154102_init_bossa_ai_os_core.sql` through `20260524191621_enable_campaign_content_calendar_writes.sql`). Each is a deliberate no-op — zero DDL, zero DML, just a comment explaining why it exists — so:

- A fresh local `supabase db reset` still passes unchanged: the 7 markers execute nothing (chronologically first, since `20260524...` sorts before `20260721...`), then all 31 real migrations run exactly as before.
- `supabase migration list --linked` against `bossa-ai-os`, run **before** `db push`, should now show all 38 versions (7 markers + 31 real) as **Local**, with the same 7 markers also already **Remote** (in sync — no repair needed, since remote already tracks those exact versions and the CLI does not re-verify already-applied migrations' content by default), and the 31 real ones as **Local only** (pending push).
- Running `db push` at that point applies only the 31 real, not-yet-applied migrations — the 7 markers are already applied remotely and are correctly skipped, not reapplied.

**`supabase migration repair` is not used here and should not be, absent a separately verified reason** — repair exists to manually correct a tracked-history row that's already wrong (e.g. a version marked applied that isn't, or vice versa); the 7 remote entries are already correct as-is, so nothing needs correcting, only matching locally, which committing the markers does directly.

**Verify before moving on:**

```bash
supabase migration list --linked
```

All 38 versions (7 historical markers + 31 real Phase 1–4 migrations) should show as applied on both Local and Remote, with none missing or out of order. Then, in the Supabase dashboard:

- Run the built-in **Security Advisor** and **Performance Advisor** and resolve or explicitly accept every finding.
- Confirm **Project Settings → Backups** shows the plan tier and retention window (§12).
- Spot-check a handful of tables in the Table Editor to confirm RLS is shown as enabled or forced, matching `docs/SECURITY_MODEL.md`'s policy inventory.

---

## 4. Production seed policy

- **`supabase/seed.sql` must never be applied to the linked production project.** It is explicitly dev/test-only (fixed all-zero UUIDs, four fake `auth.users` rows with a shared published password). Never run `supabase db reset` against a linked production project — that command is local-only by design (it drops and rebuilds).
- Real tenant data is created by the **separate, dedicated** `scripts/bootstrap-production-tenants.ts` (§7), which creates only the two real organizations, their locations, branding, and settings, plus real owner memberships. It never touches any other table.
- This separation is the direct implementation of issue #20's rule: "Separate production records from demo/mock fixtures" and "Do not run development seed.sql blindly against production."

---

## 5. Auth site URL and redirect configuration

In the Supabase dashboard for `bossa-ai-os` (Authentication → URL Configuration):

- **Site URL**: the real production domain (e.g. `https://<your-vercel-domain>`), not `http://localhost:3000`.
- **Redirect URLs**: add the production domain's `/**` wildcard (mirroring `supabase/config.toml`'s local `additional_redirect_urls = ["http://localhost:3000/**"]`), plus any Vercel preview-deployment domains that need password-reset/magic-link flows to work during review.
- **Confirm email** (Authentication → Providers → Email): **enable** — locked by D4.
- **Allow new users to sign up** (Authentication → Providers → Email): **disable** — locked by D2.

None of this is expressible in `supabase/config.toml` for a hosted project — that file only configures the local CLI stack.

---

## 6. Environment-variable checklist (Vercel → Project Settings → Environment Variables, Production)

| Variable | Value source | Public / server-only | Notes |
| --- | --- | --- | --- |
| `DASHBOARD_DATA_PROVIDER` | literal `supabase` | server-only | **Do not set this until §0's D5 gate is fully satisfied** — see § 9 "Cutover checklist." |
| `NEXT_PUBLIC_SUPABASE_URL` | `bossa-ai-os` Project Settings → API → Project URL | public | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `bossa-ai-os` Project Settings → API → anon/publishable key | public | **Not** `NEXT_PUBLIC_SUPABASE_ANON_KEY` — issue #20 names it differently from the actual repository convention. Using the wrong name silently breaks `middleware.ts`/`client.ts`/`server.ts`. |
| `SUPABASE_SECRET_KEY` | `bossa-ai-os` Project Settings → API → service_role key | **server-only** | Never prefix with `NEXT_PUBLIC_`. Never add to a client-exposed Vercel environment. Only used by `lib/supabase/service-role.ts`'s callers (manual scripts), never a request path. |

**Never** expose `SUPABASE_SECRET_KEY` as a public/browser Vercel variable, and never commit a real value to any file. The legacy export tool (§1) uses its own separate `LEGACY_SUPABASE_URL`/`LEGACY_SUPABASE_SECRET_KEY` variables, set only at invocation time in a local shell — never in Vercel at all, since exporting legacy data is not something the deployed application ever needs to do.

---

## 7. BOSSA/Papai owner membership procedure

Real owner accounts and organization records are created by `scripts/bootstrap-production-tenants.ts` (service-role, manual invocation only — never run by CI or any request path). It is **dry-run by default**: running it without `--confirm` prints exactly what it would do and makes no changes.

```bash
# Dry run first — always. Prints the plan, changes nothing.
SUPABASE_SECRET_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
  npm run bootstrap:production-tenants -- --bossa-owner-email=<real-owner-email> --papai-owner-email=<real-owner-email>

# Review the printed plan carefully, then actually apply it:
SUPABASE_SECRET_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
  npm run bootstrap:production-tenants -- --bossa-owner-email=<real-owner-email> --papai-owner-email=<real-owner-email> --confirm
```

What it does, per organization:

1. Upserts the organization by its real, fixed slug (`bossa` / `papai`) — matching the routes the application already uses.
2. Ensures exactly one primary location exists (inserted only if none is found — never overwrites an existing location).
3. Upserts `organization_branding` and `organization_settings`, mirroring the real BOSSA/Papai branding and dashboard-widget configuration that `supabase/seed.sql` already encodes for local dev (that data is BOSSA's and Papai's actual visual identity, not fake fixture data — only the organization ID, users, and dev password in `seed.sql` are fake).
4. If an owner email is given: invites the real user via Supabase Auth's admin invite API (sends a real email), then creates their `organization_memberships` row (`status = 'active'`) and grants the `organization_owner` role via `membership_roles`.

It can be re-run safely — organizations are matched by slug, locations are only inserted if absent, branding/settings use `on conflict (organization_id) do update`, and memberships/role grants use `on conflict do nothing`. It never deletes or overwrites unrelated data, and never touches any table outside this list.

**Papai's `status` is bootstrapped as `'onboarding'`, not `'active'`, matching its real current business state** (mirroring `seed.sql`'s distinction) — do not activate Papai until the business is actually ready to go live, independent of the technical cutover.

---

## 8. Deployed tenant-isolation smoke tests

Run manually against the real production URL after cutover (§10). This mirrors issue #20's Lane A smoke gate and Phase 2–4's existing pgTAP/integration tenant-isolation guarantees, exercised live for the first time:

1. Sign in as the real BOSSA owner. Confirm the BOSSA dashboard loads with real (not mock) data.
2. Sign in as the real Papai owner. Confirm the Papai dashboard loads only Papai data, never any BOSSA data.
3. While signed in as the BOSSA owner, attempt to visit `/papai/dashboard` directly — confirm the permission-state "no access" page is shown, not Papai's real data.
4. Sign out. Attempt to visit `/bossa/dashboard` directly — confirm redirect to `/login`.
5. Create and update a lead, a reservation, and an order as each owner; confirm each only ever sees their own organization's records.
6. Run `npm run kpi:generate -- --org=bossa` (and `--org=papai` once active) against production and confirm a `daily_kpi_snapshots` row appears.
7. Run `npm run ai:evaluate -- --org=bossa --as-of=<today>` and confirm signals/recommendations appear on the AI Executive page.
8. Approve and execute exactly one low-risk recommendation (e.g. `assign_lead_owner` on a real test lead created for this purpose) and confirm the domain effect, the action-attempt record, and the audit-log entry all appear correctly.

---

## 9. Mock-to-Supabase cutover checklist (D5's gate, in order)

Do these in order, on the production Vercel project:

- [ ] Legacy Preservation Gate (§1) fully complete for both projects.
- [ ] Migration collision decision (§2) made and executed (path A's cleanup, or path B's new project).
- [ ] Remote migrations applied and verified (§3).
- [ ] Auth site URL and redirect URLs configured for the real domain, D2/D4 settings applied (§5).
- [ ] All three Supabase environment variables set correctly in Vercel Production (§6), with `DASHBOARD_DATA_PROVIDER` **not yet** set to `supabase`.
- [ ] `scripts/bootstrap-production-tenants.ts` run with `--confirm` for at least BOSSA (§7); Papai bootstrapped but left `onboarding` until its own business launch decision.
- [ ] A new Vercel deployment triggered (redeploy, so the new env vars actually take effect) with `DASHBOARD_DATA_PROVIDER` still unset — confirm the site still behaves exactly as it does today (mock mode), proving the other env vars alone don't change behavior.
- [ ] Set `DASHBOARD_DATA_PROVIDER=supabase` in Vercel Production. **This is the actual cutover moment** — a deliberate, separate action, not bundled with any other change.
- [ ] Redeploy (or wait for the next deploy) so the new value takes effect.

---

## 10. Post-cutover verification checklist

- [ ] Run every smoke test in §8 against the real production URL.
- [ ] Confirm `/login` works and an unauthenticated visit to any workspace route redirects there.
- [ ] Confirm the root `/` tenant selector (still the static Phase 1 list — see audit § "Root page always renders the mock tenant list") correctly links into the now-real, auth-gated dashboards.
- [ ] Confirm audit history (`audit_logs`) is recording real events for the actions taken during smoke testing.
- [ ] Confirm no console or server errors during the smoke pass.
- [ ] Confirm the Supabase dashboard's Security Advisor still shows a clean (or explicitly accepted) result after real data has been written.

---

## 11. Rollback plan

- **Before the `DASHBOARD_DATA_PROVIDER` flip**: rollback is trivial — no other env var change alone alters user-visible behavior (mock mode is unaffected by the Supabase variables being present). If anything looks wrong before the flip, simply don't flip it.
- **After the flip, if something is wrong**: unset `DASHBOARD_DATA_PROVIDER` (or set it to anything other than `supabase`) in Vercel and redeploy — this immediately reverts the live site to mock mode. No data is lost or changed by this; it only changes which `DashboardDataProvider` the app constructs.
- **A bad migration on the linked project**: per `docs/SUPABASE_OPERATIONS.md`'s existing guidance, write a new forward migration that undoes the mistake (e.g. `drop column`, restore a dropped policy) — never edit or delete an already-applied migration file. `supabase migration repair` exists only for correcting already-desynced tracked history after a manual fix, not as a first resort.
- **A bad bootstrap run**: the script never deletes or overwrites existing rows (§7) — if it created something wrong (e.g. a mistyped owner email), fix it with a manual, reviewed `update`/`delete` against the specific row, documented at the time, never a re-run of an automated "undo" script.
- **A bad collision-cleanup (path A)**: this is exactly why path A's recommended approach moves every legacy table into its own `legacy_bossa` schema rather than `drop`ping anything (§2, `docs/PRODUCTION_SCHEMA_COLLISION_CLEANUP_PLAN.md`) — a schema move is reversible (move the tables back) as long as it's done before `db push` recreates the freed names; a drop is not, which is why path A is only recommended when every precondition in §2 is met.

---

## 12. Backup and recovery guidance

- Confirm `bossa-ai-os`'s backup tier in Project Settings → Backups **before** any migration or collision cleanup (audit §4, item 2) — a project on the Free tier has no point-in-time recovery and only whatever backup cadence the plan provides, if any.
- Because this project carries real legacy data (audit §3) and was previously reported inactive, do not assume any backup history exists before a fresh one is confirmed.
- `audit_logs` is append-only by design (no `authenticated` UPDATE/DELETE policy exists on it at all) and is not a substitute for a real database backup — it records what happened, it does not let you undo it.
- The Legacy Preservation Gate's exports (§1) are themselves a manual backup of the specific rows that matter most — but they are a point-in-time snapshot, not a substitute for the project's own ongoing backup posture once real production traffic begins.
- Once real business data exists, revisit this section to decide whether the current plan tier's backup cadence is sufficient for BOSSA/Papai's actual risk tolerance, and upgrade if not. This is explicitly out of scope for this PR to decide.

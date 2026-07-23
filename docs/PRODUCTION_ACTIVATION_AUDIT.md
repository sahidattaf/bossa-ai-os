# Production Activation Audit

Phase 4.5 / 3B Lane A (issue #20). This is an audit report, not a runbook — for the step-by-step cutover procedure see `docs/PRODUCTION_DEPLOYMENT.md`. Written before any schema, environment, or Supabase-project change was made.

---

## Verified current state (as of this audit)

- Phase 1–4 are merged to `main`; this audit runs from `feat/phase-4-5-production-core-ops`.
- The deployed Vercel application presents the BOSSA/Papai tenant selector at `/` regardless of configuration — see "Root page always renders the mock tenant list" below for the repository-level reason.
- The repository defaults to `mock` mode unless `DASHBOARD_DATA_PROVIDER=supabase` is explicitly set (server-only env var, `lib/dashboard/get-data-provider.ts`).
- **Both candidate Supabase projects have now been directly inspected, read-only, and are `ACTIVE_HEALTHY`.** Full comparison and the resulting locked decision are in §3 — this is no longer a provisional lean or a pending item.
- **Neither live project matches the repository's current 33-migration, 25-table Phase 2–4 schema.** Both carry their own, unrelated legacy schema and legacy data that predates this repository's Phase 1–4 work. This is the single most important fact for Lane A: a plain `supabase db push` must not be run against either project as-is (§3, §4).

---

## 1. Repository production-readiness findings

### Schema and security posture

- 33 migrations (`supabase/migrations/20260721230001_extensions_and_helpers.sql` through `20260725000003_ai_evaluation_scope_validation.sql`), creating 25 tables across Phase 1–4: `platform_admins`, `profiles`, `roles`, `permissions`, `role_permissions`, `organizations`, `locations`, `organization_memberships`, `membership_roles`, `organization_branding`, `organization_settings`, `audit_logs`, `leads`, `reservations`, `orders`, `order_items`, `daily_kpi_snapshots`, `status_transitions`, `ai_rule_configs`, `ai_signals`, `ai_recommendations`, `ai_recommendation_evidence`, `ai_approvals`, `ai_action_attempts`, `ai_outcomes`.
- Row-Level Security is `enable`d and `force`d on every one of those tables (confirmed directly: `force row level security` appears once per table across the four RLS migration files, with no table found enabled-but-not-forced). This is the repository's core security guarantee and this audit found nothing in Lane A's scope that would weaken it — `docs/SECURITY_MODEL.md` remains accurate.
- The roles/permissions/role_permissions catalog (8 roles, 18+ permissions) is created **by migration**, not by `seed.sql` (`20260721230002_identity_and_catalog.sql`, `20260723000004_ai_permissions_catalog.sql`). A schema-only `supabase db push` against an empty project fully populates this platform-wide catalog — no separate bootstrap step is needed for it.

### The mock/Supabase switch is a single, clean gate

- `getDashboardProviderMode()` (`lib/dashboard/get-data-provider.ts`) reads `DASHBOARD_DATA_PROVIDER` and defaults to `"mock"` for anything other than the literal string `"supabase"`.
- The `[organizationSlug]` workspace layout (`app/(workspace)/[organizationSlug]/layout.tsx`) branches on this mode *before* constructing a Supabase client or requiring authentication — mock mode never touches Supabase at all.
- `middleware.ts` no-ops safely (`NextResponse.next()`) whenever `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are absent, so it's harmless in mock mode.
- **Conclusion: flipping one Vercel environment variable is the entire cutover mechanism.** No code change is required to go from mock to real. This matches issue #20's own framing exactly.

### Root page always renders the mock tenant list

`app/page.tsx` (the `/` route) calls `listTenants()` from the static, hardcoded `lib/tenancy/tenants.ts` unconditionally — it never checks `getDashboardProviderMode()`. This is the concrete, repository-level reason the deployed site "currently presents the BOSSA/Papai tenant selector": it will keep doing so even after a real cutover, since this page doesn't know about auth or the real tenant list at all. It is **not a security issue** — each card only links to `/{slug}/dashboard`, which *does* go through the real auth+RLS-gated workspace layout in `supabase` mode. It is a product/UX decision, tracked as an open decision in the deployment runbook, not fixed in this PR.

### No service-role leakage risk

- `lib/supabase/service-role.ts` is guarded by `import "server-only"` and reads `SUPABASE_SECRET_KEY` — used by nothing on a request path, only by the manual scripts `scripts/generate-kpi-snapshots.ts`, `scripts/evaluate-ai-executive.ts`, and the new `scripts/bootstrap-production-tenants.ts` added by this PR.
- `lib/supabase/client.ts` and `lib/supabase/server.ts` (the browser and request-scoped clients) only ever construct with `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `.env.example` already documents `SUPABASE_SECRET_KEY` as server-only, never `NEXT_PUBLIC_`-prefixed, never committed.

### Environment-variable naming: a real discrepancy found

Issue #20 lists the Vercel variable as `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The actual repository-wide name — used consistently in `.env.example`, `lib/supabase/client.ts`, `lib/supabase/server.ts`, and `middleware.ts` — is **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`**. Production Vercel configuration must use the real repository name. Using the issue's name instead would leave `middleware.ts` unable to construct a client (silently falling back to a no-op) and `client.ts`/`server.ts` would throw at the `!` non-null assertion. This is called out explicitly in the deployment runbook's environment-variable checklist.

### `seed.sql` is dev-only by explicit design, not by convention

`seed.sql`'s own header states it is "NOT applied to any production project." It uses fixed all-zero UUIDs and four fake `auth.users` rows (`owner@bossa.test`, etc., password `DevPassword123!` inserted via `crypt()`). This is safe as long as no automation ever runs it against a linked hosted project — the deployment runbook makes this an explicit, named rule (§ "Production seed policy").

### No organization-provisioning RPC exists

Consistent with `docs/SECURITY_MODEL.md`'s documented stance that "self-serve organization creation... [is] still a manual, service-role administrative action" — there is no RPC or UI path that creates a real organization + owner today. Production tenant bootstrap must be its own dedicated, service-role, off-request-path script (`scripts/bootstrap-production-tenants.ts`, added by this PR) — not a repurposed `seed.sql`, and not a one-off manual SQL session.

### `resolveTenantForCurrentUser()` fails closed on incomplete provisioning

`lib/tenancy/supabase-tenants.ts` treats a missing `organization_branding` or `organization_settings` row for an otherwise-real organization as "no access" (fail-closed, not a crash). Production bootstrap must create both rows, not just the bare `organizations` row, or real owners will see a permission-state page despite having a real membership.

### No backup/recovery documentation exists

A full-repository search for backup, disaster-recovery, or point-in-time-recovery documentation returned nothing. `docs/SUPABASE_OPERATIONS.md`'s existing "Rollback and recovery" section covers only *local dev reset* and *migration-history repair* — it says nothing about the hosted project's actual backup/PITR posture. Because `bossa-ai-os` was inactive and has just been restored, its backup history prior to restoration is unknown and must be confirmed in the Supabase dashboard (Project Settings → Backups) before this is treated as a recoverable system. Tracked as an explicit open item in the deployment runbook.

### No production deployment runbook existed before this PR

`vercel.json` only sets build/install commands — correctly, no environment variables are committed there. CI (`.github/workflows/ci.yml`) never touches a hosted Supabase project; its `database` job is entirely local-Docker. There was no prior hosted-secrets convention to inherit, and no single document walking through auth site URL, redirect URLs, the Vercel env-var checklist, or the cutover sequence end to end. `docs/PRODUCTION_DEPLOYMENT.md` (added by this PR) is the first.

### Auth configuration is local-only today

`supabase/config.toml`'s `[auth]` block (`site_url = "http://localhost:3000"`, `enable_signup = true`, `enable_confirmations = false`) only governs the local CLI stack — a hosted project's auth site URL, redirect URLs, and signup/confirmation policy are configured in the Supabase dashboard (or via the Management API) and are **not** expressible from this repository. This PR's job is to document the exact production values to set, not to encode them in `config.toml`.

### KPI generation and AI evaluation are manual-only, by design

Neither Phase 3 nor Phase 4 enabled a scheduler (no Vercel Cron, no Supabase scheduled job). `npm run kpi:generate` and `npm run ai:evaluate` are the only ways `daily_kpi_snapshots` rows and AI signals/recommendations are produced today. Issue #20's smoke-gate items ("Run KPI generation," "Run AI Executive evaluation") map directly to running these existing scripts once against production — no new automation is implied or built by this PR.

---

## 2. Overall assessment

The repository's security architecture — RLS enabled and forced everywhere, a permission-aware model, typed operational errors, status machines, append-only audit logging — is already production-shaped and requires **no changes to this repository's own migrations** for Lane A. What was missing was entirely process, configuration, and — now that both live projects have been inspected — **legacy-data reconciliation**: a documented remote-migration procedure, a real-tenant bootstrap strategy kept separate from dev fixtures, an environment-variable and auth checklist (with one real naming error corrected), a rollback/backup posture, a smoke-test checklist, and (newly required by the verified findings in §3) a legacy-preservation gate and a migration-collision decision before `bossa-ai-os`'s existing legacy tables can coexist with this repository's schema. This PR adds the documentation and the read-only export tooling for all of that — it does not execute any of it.

---

## 3. Supabase project comparison — verified, complete

Both projects were inspected directly, read-only (no writes, no DDL, no migrations applied). Verified findings:

### `bossa-ai-os` (project ref `oqmftkttkfktyzefswpz`)

- **Status:** `ACTIVE_HEALTHY`.
- **Legacy migration history** (7 migrations, none related to this repository's Phase 1–4 schema):
  `20260524154102_init_bossa_ai_os_core`, `20260524160705_harden_set_updated_at_search_path`, `20260524165824_enable_readonly_dashboard_tables`, `20260524182611_enable_operator_input_writes`, `20260524184236_harden_operator_helper_function_access`, `20260524184304_move_operator_helper_to_private_schema`, `20260524191621_enable_campaign_content_calendar_writes`.
- **Legacy public tables:** `campaigns`, `weekly_briefs`, `whatsapp_leads`, `orders`, `menu_items`, `bookings`, `users_profiles`, `kpi_daily`, `content_items`, `decision_log`, `agent_runs`.
- **Verified live row counts:** `auth.users` 1 · `campaigns` 3 · `weekly_briefs` 1 · `kpi_daily` 1 · `decision_log` 2 · every other inspected public table 0.

### `Bossa Asado i Mar` (project ref `zgfncoexiqnqeqaxpqdy`)

- **Status:** `ACTIVE_HEALTHY`.
- **Tracked migrations:** 0.
- **Public tables:** `bossa_leads` only.
- **Verified live row counts:** `auth.users` 0 · `bossa_leads` 8.

### Collision risk — this is the finding that matters most for Lane A

`bossa-ai-os`'s existing legacy schema already has tables literally named **`orders`** and **`menu_items`**. This repository's own migrations create a `public.orders` table (Phase 3, `leads`/`reservations`/`orders`/`order_items`) with an entirely different shape, and Lane B will eventually add its own `menu_items`. **Running `supabase db push` against `bossa-ai-os` as it exists today will not cleanly apply** — it will either fail outright on the name collision or, worse, partially succeed against an incompatible pre-existing table. This must be resolved before any migration is pushed (§4 of `docs/PRODUCTION_DEPLOYMENT.md`, "Migration collision decision").

### D1 — locked

**`bossa-ai-os` is the permanent multi-tenant Hospitality OS backend**, subject to complete preservation/export and reconciliation of every legacy row before any cleanup of the colliding legacy objects. `Bossa Asado i Mar` remains a **read-only legacy/source project** until its 8 `bossa_leads` rows are exported, mapped, and reconciled — it is not, and will not become, the platform backend. See `docs/PRODUCTION_DEPLOYMENT.md`'s "Legacy Preservation Gate" and "Migration collision decision" sections for exactly what must happen, in order, before `bossa-ai-os`'s legacy objects can be touched. **This PR does not export, migrate, or delete anything in either project** — it documents the gate and ships the read-only export tooling only.

---

## 4. Discovered risks

1. **`bossa-ai-os` carries a colliding legacy schema** (`orders`, `menu_items`, and 9 other legacy tables) that will conflict with this repository's own Phase 3 `orders` table and Lane B's future `menu_items` table — the single biggest blocker to a naive `supabase db push`. Resolved by the "Migration collision decision" (two documented paths, neither executed in this PR) and the "Legacy Preservation Gate" (mandatory export before any cleanup) in `docs/PRODUCTION_DEPLOYMENT.md`.
2. **Unknown backup/PITR posture** — the chosen project's backup tier and backup history are still unverified; this remains open even though D1 is now locked.
3. **Environment-variable naming mismatch** between issue #20 and the real repository convention (corrected above; must not be reintroduced in the Vercel dashboard).
4. **Root page never reflects cutover state** — cosmetic, not a security issue, tracked as a fast-follow decision (D3, still open).
5. ~~Public self-signup enabled~~ — **locked (D2): production is invite-only, public self-signup must be disabled.** No longer an open risk, only a configuration step to execute in the runbook.
6. **A production bootstrap script now exists** (`scripts/bootstrap-production-tenants.ts`, added in this PR's prior commits) but has not yet been run against the real, chosen project — it remains a documented, unexecuted procedure until the collision decision and legacy export are both complete.
7. **`DASHBOARD_DATA_PROVIDER=supabase` is a single global switch** — there is no gradual/canary cutover path in this repository today; the first real flip on the production Vercel project *is* the cutover, and per D5 it may only happen after schema readiness, tenant bootstrap, auth configuration, smoke-testing readiness, and documented rollback readiness are all in place.
8. **Auth redirect URLs for the production domain are unset** anywhere reachable from the repository — left at defaults, magic-link/password-reset flows would redirect to `localhost`.
9. **No scheduler exists for KPI/AI evaluation** — after cutover, both must be run manually at least once for the smoke gate, and an operational owner is needed going forward.
10. **8 real `bossa_leads` rows in `Bossa Asado i Mar` are not yet reconciled** into this repository's `leads` table shape — until they are, that project must stay read-only and must not be decommissioned or written to.

# Production Activation Audit

Phase 4.5 / 3B Lane A (issue #20). This is an audit report, not a runbook — for the step-by-step cutover procedure see `docs/PRODUCTION_DEPLOYMENT.md`. Written before any schema, environment, or Supabase-project change was made.

---

## Verified current state (as of this audit)

- Phase 1–4 are merged to `main`; this audit runs from `feat/phase-4-5-production-core-ops`.
- The deployed Vercel application presents the BOSSA/Papai tenant selector at `/` regardless of configuration — see "Root page always renders the mock tenant list" below for the repository-level reason.
- The repository defaults to `mock` mode unless `DASHBOARD_DATA_PROVIDER=supabase` is explicitly set (server-only env var, `lib/dashboard/get-data-provider.ts`).
- Supabase project `bossa-ai-os` (`oqmftkttkfktyzefswpz`) was inactive; restoration was started and reached `COMING_UP` during the prior audit pass (per issue #20's tracked comment).
- Remote migration history on `bossa-ai-os` returned **0 migrations**; the `public` schema returned **0 tables** at that check.
- A second, separately inactive Supabase project, **`Bossa Asado i Mar`**, exists and has not yet been inspected. It must not be assumed empty, abandoned, or safe to ignore.

**A hard limitation of this audit:** it was performed from a working environment with no Supabase CLI authentication (no `SUPABASE_ACCESS_TOKEN`, no linked project state, `supabase` binary not pre-installed) and no Supabase Management API credentials. Every fact above about the live state of either Supabase project comes from Sahid's own prior investigation (recorded verbatim in the issue #20 tracking comment), not from a query this audit ran itself. Everything in this document about the **repository** was verified directly by reading the actual files; everything about the **live Supabase projects** is reported as given and flagged for direct verification before any binding decision (§3).

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

The repository's security architecture — RLS enabled and forced everywhere, a permission-aware model, typed operational errors, status machines, append-only audit logging — is already production-shaped and requires **no schema changes** for Lane A. What was missing was entirely process and configuration: a documented remote-migration procedure, a real-tenant bootstrap strategy kept separate from dev fixtures, an environment-variable and auth checklist (with one real naming error corrected), a rollback/backup posture, and a smoke-test checklist. This PR adds exactly those, and nothing else.

---

## 3. Supabase project comparison — decision framework

This audit could not run the checks below itself (§ "hard limitation," above). Sahid should either run each row against **both** projects and report back, or grant a scoped Supabase access token so a follow-up session can run the read-only checks directly.

| Axis | What to check | How |
| --- | --- | --- |
| Existing tables/migrations | Row/table count, migration history | Dashboard → Table Editor; `supabase migration list --linked` |
| Existing auth users | Any real (non-test) accounts already registered | Dashboard → Authentication → Users |
| Existing business data | Any populated tables with real BOSSA/Papai data | Table Editor row counts on any non-empty table |
| Project naming / repo alignment | Does the project's name/ref match `supabase/config.toml`'s `project_id = "bossa-ai-os"`? | Dashboard → Project Settings → General |
| Migration risk | Would `supabase db push` collide with pre-existing objects? | `supabase db diff --linked` before any push |
| Data-loss risk | Does the project hold real, non-reproducible business data a push/reset could endanger? | Manual review of any populated tables found above |
| Environment-variable changes | Project URL / publishable key / secret key all differ per project | Dashboard → Project Settings → API |
| Rollback complexity | Forward-migration fix, or manual DDL/data surgery? | Depends on findings above |

**Provisional lean, not a decision:** `bossa-ai-os` matches the repository's own `project_id` naming exactly and currently has zero migrations and zero tables — a `supabase link` + `supabase db push` onto it carries zero migration risk and zero data-loss risk by construction. This makes it the structurally safer target *if* `Bossa Asado i Mar` is confirmed to hold no real, unrecoverable business data. This is decision **D1** — see `docs/PRODUCTION_DEPLOYMENT.md`'s "Decisions requiring approval" section. No migration or bootstrap step in this PR depends on D1 being resolved yet; the runbook documents the procedure generically as `<chosen-project-ref>`.

---

## 4. Discovered risks

1. **Second project uninspected** — proceeding to link/push before `Bossa Asado i Mar` is checked risks abandoning or duplicating real legacy data.
2. **Unknown backup/PITR posture** — the chosen project's backup tier and post-restoration backup history are unverified.
3. **Environment-variable naming mismatch** between issue #20 and the real repository convention (corrected above; must not be reintroduced in the Vercel dashboard).
4. **Root page never reflects cutover state** — cosmetic, not a security issue, tracked as a fast-follow decision.
5. **Public self-signup is enabled** with email confirmation disabled — a real production decision, not yet made (see runbook).
6. **No production bootstrap script existed before this PR** — without one, there was no safe, repeatable, idempotent way to create real BOSSA/Papai organizations and owner memberships.
7. **`DASHBOARD_DATA_PROVIDER=supabase` is a single global switch** — there is no gradual/canary cutover path in this repository today; the first real flip on the production Vercel project *is* the cutover.
8. **Auth redirect URLs for the production domain are unset** anywhere reachable from the repository — left at defaults, magic-link/password-reset flows would redirect to `localhost`.
9. **No scheduler exists for KPI/AI evaluation** — after cutover, both must be run manually at least once for the smoke gate, and an operational owner is needed going forward.

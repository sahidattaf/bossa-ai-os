# Phase 2 Implementation Report — Supabase Tenancy, Authentication, RBAC, and RLS

**Branch:** `feat/phase-2-supabase-tenancy-auth` · **Issue:** #13 (part of #9) · **Follows:** Phase 1 (PR #12)

## Scope

Replace Phase 1's demo-only, static tenant resolution with a production Supabase foundation: real authentication, organization membership, database-backed role/permission checks, and PostgreSQL Row-Level Security — without changing the `DashboardDataProvider` interface, the widget/dashboard component contracts, or breaking Phase 1's mock-mode demo and test suite.

## Database architecture

13 tables (11 from the issue, 2 justified additions — see `docs/SECURITY_MODEL.md`):

- **Identity**: `profiles` (1:1 `auth.users`), `platform_admins` (small cross-org allowlist)
- **Tenancy**: `organizations`, `locations`, `organization_memberships`, `membership_roles`, `organization_branding`, `organization_settings`
- **Global catalog** (not tenant-owned): `roles` (8), `permissions` (18), `role_permissions`
- **Audit**: `audit_logs` (append-only)

Every tenant-owned table carries `organization_id`. Six migrations, applied in order: extensions/helpers → identity & catalog → organizations & tenancy → authorization functions → audit logs → RLS policies, plus a seventh adding two narrow RPCs (`get_organization_summary`, `get_my_permissions`/`get_my_role_names`) needed to resolve a tenant correctly. Full list in "Files and migrations" below.

## Authentication flow

`@supabase/ssr` browser/server clients (cookie-based), a `middleware.ts` refreshing the session on every request, and email+password sign-in (`app/(auth)/login`) via a Server Action using React 19's `useActionState`. Chose email+password over magic links deliberately: magic-link email delivery isn't testable in an automated cross-tenant suite, and Phase 2's seeded dev users need deterministic credentials pgTAP/integration tests can actually sign in with. The `next` redirect target is validated to a same-origin relative path only — no open redirect via an absolute or protocol-relative URL.

`DASHBOARD_DATA_PROVIDER` (server-only env var, `mock` default | `supabase`) is the single switch controlling both which `DashboardDataProvider` is used and whether the workspace layout requires authentication at all — `mock` mode is byte-for-byte Phase 1 behavior, so the existing unit/e2e suites needed zero changes.

## Roles and permissions

8 roles (`platform_admin`, `organization_owner`, `general_manager`, `finance_manager`, `operations_manager`, `marketing_manager`, `staff`, `viewer`) × 18 permissions (the 17 from issue #13 plus `organization.manage`, added because scope F's membership-management policies have nothing to gate on without it). Role→permission grants are seeded as structural catalog data in the identity migration (not `seed.sql`, since the app depends on this existing even outside local dev). `lib/widgets/permissions.ts::hasPermission()` — Phase 1's existing, untouched function — is what actually enforces this at render time; Phase 2 just populates its `granted` array from a real `get_my_permissions()` call instead of a wildcard default.

## RLS policies

Enabled and forced on every table. Two `SECURITY DEFINER` functions (`is_org_member`, `has_permission`), both `STABLE` with `search_path = public, pg_temp` set explicitly, are the only thing any policy reads. Full inventory and the reasoning behind each exception (the two narrow RPCs, catalog tables being globally readable) is in `docs/SECURITY_MODEL.md` — not duplicated here.

## Cross-tenant security results

26 pgTAP assertions (`supabase/tests/rls_cross_tenant.test.sql`) plus 9 application-level integration tests (`tests/integration/tenancy.test.ts`) covering: cross-tenant SELECT/INSERT/UPDATE/DELETE denial, staff unable to escalate or assign any role, the last-organization_owner safeguard, audit log immutability (including `record_audit_event` refusing to log against another org), the unknown-vs-inaccessible-organization distinction, and BOSSA/Papai data isolation per authenticated member. **Results:** see "Validation results" below — this sandbox has no Docker, so these only actually run in CI; results are from the real `database` CI job, not a local claim.

## Dashboard provider integration

`lib/dashboard/supabase-provider.ts` implements the unchanged `DashboardDataProvider` interface. Phase 2 has no operational tables (orders/reservations/etc. are Phase 3), so every operational field is an honest zero/empty value — not a fabricated number. `MockDashboardDataProvider` is untouched and still the default. `lib/dashboard/get-data-provider.ts` is the one place that chooses between them.

## Files and migrations

56 files changed (excluding `package-lock.json`), 7 commits. Migrations:

| File | Contents |
| --- | --- |
| `20260721230001_extensions_and_helpers.sql` | `set_updated_at()`, `platform_admins` |
| `20260721230002_identity_and_catalog.sql` | `profiles` + signup trigger, `roles`, `permissions`, `role_permissions` + seeded catalog |
| `20260721230003_organizations_and_tenancy.sql` | `organizations`, `locations`, `organization_memberships`, `membership_roles` (+ org_id sync trigger), `organization_branding`, `organization_settings` |
| `20260721230004_authorization_functions.sql` | `is_org_member`, `has_permission`, `protect_last_organization_owner` |
| `20260721230005_audit_logs.sql` | `audit_logs`, `record_audit_event` |
| `20260721230006_rls_policies.sql` | RLS enabled + forced + every policy, on every table |
| `20260721230007_tenant_resolution_functions.sql` | `get_organization_summary`, `get_my_permissions`, `get_my_role_names` |

Legacy static-dashboard's single-tenant Supabase SQL relocated to `legacy/static-dashboard/supabase/` (non-destructive, same pattern as Phase 1's `src/` move — those files are unrelated to this schema).

## Validation results

Run locally in this sandbox (no Docker, so the database-specific steps below ran only in CI):

```
npm run lint        → clean
npm run typecheck   → clean (strict mode)
npm run test         → 7 files, 35 tests passed (Phase 1's suite, byte-for-byte unchanged)
npm run build         → succeeds, 20 routes (19 from Phase 1 + /login)
```

CI `database` job (`supabase start` → `supabase db reset` → `supabase test db` → regenerate types + re-typecheck → `test:integration` → `supabase stop`): **[filled in after the real CI run — see the PR checks, not a number asserted here without having seen it]**

## Risks and decisions

1. **Two justified additions beyond the issue's literal table/permission list**: `platform_admins` (so the `platform_admin` role has real cross-org meaning) and the `organization.manage` permission (so membership-management policies have something to gate on). Both are small, documented, and directly serve requirements already in scope F.
2. **`get_organization_summary` is a deliberate RLS exception.** It exposes `{id, slug, name}` for any organization to any authenticated user, to make the 404-vs-permission-state distinction possible at all. Reasoned about explicitly in `docs/SECURITY_MODEL.md` — no operational or configuration data is exposed by it.
3. **No real Supabase cloud project was touched.** The team has paused (`INACTIVE`) projects reachable via the connected Supabase MCP tools; restoring or creating one has cost/account implications outside this PR's scope, so Phase 2 ships fully local/CI-validated, with linking a real project documented as a manual next step.
4. **`database.types.ts` is hand-authored**, not generated (no Docker locally). CI regenerates it from the real schema and re-typechecks the app against that — a much stronger check than a textual diff — documented in `docs/SUPABASE_OPERATIONS.md`.
5. **Two real dependency bugs found and fixed while integrating**: `@supabase/ssr@0.5.2` was incompatible with the installed `@supabase/supabase-js@2.110.x`'s `SupabaseClient` generic signature (bumped to `^0.12.3`); the hand-authored `Database` type was missing the `__InternalSupabase.PostgrestVersion` marker and each table's `Relationships` field, both required by `postgrest-js`'s type constraints — without them every typed query silently widened to `never`.

## Phase 3 readiness

Every seam Phase 3 (live operational modules) needs already exists: `SupabaseDashboardDataProvider` just needs its zero/empty operational fields replaced with real queries against new `orders`/`reservations`/`inventory`/etc. tables (each following the same `organization_id` + RLS pattern established here); `has_permission()` already recognizes `orders.read`/`orders.write`/etc.; the audit trail (`record_audit_event`) is ready for operational mutations to log against. No dashboard, widget, or shell component should need to change.

# Phase 1 Implementation Report — Next.js Multi-Tenant Hospitality OS Shell

**Branch:** `feat/phase-1-nextjs-multi-tenant-shell` · **Issue:** #11 (part of #9) · **Architecture reference:** `docs/MULTI_TENANT_HOSPITALITY_OS_ARCHITECTURE.md`

## Scope

Preserve the static BOSSA AI OS prototype, then build the production Next.js foundation for a multi-tenant Hospitality OS: design system, application shell, and a fully working (mock-data) dashboard rendering both BOSSA Asado i Mar (Tenant 001) and Papai Since 1933 (Tenant 002) from one component tree. No Supabase, no auth — that's Phase 2.

## Files changed

126 files changed (excluding `package-lock.json`), 6 commits:

| Area | Files | What |
| --- | --- | --- |
| `legacy/static-dashboard/` | 26 | Static prototype moved from `src/`, unchanged, with its own `package.json` |
| `app/` | 23 | Root layout/page, `[organizationSlug]` layout + not-found, dashboard page, 16 module route pages |
| `components/` | 38 | 15 shadcn-style UI primitives, 10 layout shell components, dashboard grid + widget frame + 8 widget components |
| `lib/` | 15 | Tenancy config/theme, widget types/schema/registry/permissions, dashboard types/providers/mock data, KPI formatting, navigation config |
| `tests/` | 11 | 7 unit test files (35 tests), 3 e2e spec files (14 tests) |
| Root config | 12 | `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `eslint.config.mjs`, `.prettierrc.json`/`.prettierignore`, `vitest.config.ts`, `playwright.config.ts`, `vercel.json`, `.gitignore` |

## Architecture implemented

- **Next.js 15.5.20 App Router + React 19 + TypeScript strict**, hand-scaffolded at the repo root (replacing the old static `src/` build target).
- **Tailwind CSS v3.4** with semantic HSL-variable tokens (`--background`, `--surface`, `--primary`, `--success`/`--warning`/`--danger`/`--info`, `--chart-1..5`, etc.) defined once in `app/globals.css`. No component hard-codes BOSSA's orange or Papai's green.
- **Tenant layer** (`lib/tenancy/`): `TenantConfig` type, two seeded tenants, `getTenantBySlug()`, and `getTenantThemeVars()` which turns `branding.primaryColor`/`accentColor`/`borderRadius` into CSS custom-property overrides applied at the `[organizationSlug]` layout boundary via a `style` prop + `data-theme` attribute.
- **Application shell** (`components/layout/`): `AppShell`, `Sidebar`, `TopNav`, `OrgSwitcher`, `UserMenu`, `NotificationButton`, `GlobalSearchShell`, `ServiceStatusIndicator`, `MobileNavSheet`, `PageHeader`. All 17 nav items route correctly; only Dashboard has full content, the other 16 render a shared `ComingSoonState` tagged with its real target phase (Phase 2 for Settings, Phase 3 for the operational modules, Phase 4 for AI Executive, Phase 5 for Integrations).
- **Widget system** (`lib/widgets/`): `WidgetDefinition`/`WidgetRegistry` mapping all 15 required dashboard widgets to a component + `selectData` function; `Zod` validates `tenant.dashboardWidgets` at runtime (`lib/widgets/schema.ts`).
- **Data layer** (`lib/dashboard/`): provider-neutral `DashboardDataProvider` interface, `MockDashboardDataProvider` implementation, per-tenant mock datasets. No widget imports mock data directly — only `DashboardGrid` calls the provider and passes resolved data down through `selectData`.
- **shadcn/ui-compatible primitives** (`components/ui/`): Button, Card, Badge, Input, Select, Tooltip, Dialog, Dropdown, Sheet, Skeleton, Toast (+ `use-toast` hook), EmptyState, ErrorState, PermissionState — hand-written on Radix primitives + `class-variance-authority`, in the shape the shadcn CLI generates, so it can be layered in later without conflict.

## Reused prototype logic

- `lib/dashboard/mock-data/bossa.ts` carries over the exact demo numbers from `legacy/static-dashboard/data.json` (revenue 45000/target 120000, 65/180 covers, etc.) and the decision/action text from `legacy/static-dashboard/ai/{decision-engine,scoring-rules}.js` (e.g. "Test one value bundle without discounting the core brand", the FinanceGPT/ServiceFlowGPT/MarketingGPT owner names, the Soi95/Avila Blues/Fensi competitor signals), reshaped into the typed `DashboardData` contract and the new AI Priorities / Live Alerts widgets.
- The legacy dashboard's dark charcoal + ember-orange palette (`legacy/static-dashboard/styles.css`) became BOSSA's `TenantBranding` in the new design-token system, rather than being hard-coded into shared components.
- `legacy/static-dashboard/` itself is untouched and still runs via `npm --prefix legacy/static-dashboard run dev`.

## Tests created

**Unit (Vitest + Testing Library, 35 tests across 7 files):**
tenant resolution + invalid-slug handling · theme-token generation for both tenants · widget registry completeness (every `WIDGET_KEYS` entry has a definition; `selectData` runs clean against both tenants' real mock data) · widget config Zod validation (accepts real config, rejects unknown key / bad size / negative order / missing field) · permission gate (wildcard, exact match, denial) · KPI formatting (currency, number, percentage) · signed trend formatting for both `increase-is-good`/`increase-is-bad` polarities · BOSSA dashboard rendering · Papai dashboard rendering · explicit cross-tenant label-leakage checks in both directions.

**E2E (Playwright, chromium + mobile-chromium/Pixel 7, 14 specs):**
BOSSA/Papai dashboard routes render tenant-correct content with a zero-count assertion for the other tenant's AI-manager name · unknown organization slug returns HTTP 404 with the tenant-aware not-found state (not the generic root 404) · a representative module route (Orders) renders its routed, phase-tagged `ComingSoonState` · tenant switcher preserves the current route segment when switching organizations · mobile sidebar opens via hamburger, a nav link navigates, and the sheet closes itself.

## Validation results

```
npm run lint        → clean (0 errors, 0 warnings)
npm run typecheck   → clean (tsc --noEmit, strict mode)
npm run test         → 7 test files, 35 tests passed
npm run build        → compiled successfully, 19 routes generated (1 static, 18 dynamic)
npm run validate     → passes end-to-end (lint && typecheck && test && build)
npm run test:e2e     → 14 specs: 9–11 passed outright, 3 correctly skipped
                        (desktop-only / mobile-only guards), 0 hard failures.
                        1–2 "flaky" on the very first run after webServer boot,
                        passing on the configured local retry — see Risks.
```

`npm audit`: pinned `next` to 15.5.20 (was 15.1.6, which carries a known CVE) and `vitest` to `^4.1.10` to clear 4 critical/high advisories from the initial `npm install`. One moderate advisory remains, in `postcss@8.4.31` bundled *inside* `node_modules/next/node_modules/postcss` — Next's own internal build tooling, not this project's dependency (the project's own `postcss` resolves to `8.5.21`, patched).

## Routes tested

Verified against a built + served production server (`next build && next start`), not just `next dev`:

`/`, `/bossa/dashboard`, `/papai/dashboard`, `/bossa/orders` (+ all 16 module routes), `/papai/settings`, `/nonexistent-org/dashboard` (→ 404 with tenant-aware not-found copy). Confirmed `data-theme="dark"` on BOSSA's rendered page and `data-theme="light"` on Papai's. Confirmed neither tenant's rendered dashboard HTML contains the other's AI-manager name or product-KPI label.

Screenshots: `docs/screenshots/bossa-dashboard.png`, `docs/screenshots/papai-dashboard.png` (captured via `scripts/capture-screenshots.mjs` against the built app — same component tree, two visibly distinct identities).

## Risks

1. **No approved visual reference was available.** No "Claude Design" screenshot asset exists anywhere in the repo, issue #11, or PR #10 — the dashboard layout is my interpretation of the written widget list and the existing prototype's dark aesthetic, not a pixel match to an approved mock. Worth a design review before Phase 3.
2. **E2E cold-start flakiness.** `playwright.config.ts`'s `webServer` runs `next build && next start` fresh for every e2e invocation; the first one or two SSR requests immediately after boot can be slow enough to trip a 20s navigation timeout under concurrent workers. Mitigated with `workers: 2` and 1 local retry (2 in CI), which is standard practice for this class of flakiness — but it's real cold-start latency, not masked as something else.
3. **`tsconfig.json`'s `"jsx"` field is contested.** Next.js pins it to `"preserve"` for its own SWC pipeline and silently rewrites it back if changed; Vitest 4's rolldown/oxc transform needs an actual JSX runtime. Resolved by setting `oxc.jsx.runtime: "automatic"` directly in `vitest.config.ts` rather than fighting Next over the shared file — but any future contributor who "fixes" that oxc config back to reading tsconfig will reintroduce the conflict.
4. **Mock data only.** All dashboard numbers are static fixtures; nothing here is a claim about BOSSA's or Papai's real performance.

## Exact next steps for Phase 2

1. Add Supabase migrations for `organizations`, `locations`, `profiles`, `organization_memberships`, `roles`, `role_permissions`, `organization_branding`, `organization_settings`.
2. Add Supabase Auth and server-side tenant-context resolution (replace `getTenantBySlug()`'s static array lookup with an authenticated-membership-verified query — never trust a client-supplied organization slug for data access).
3. Add PostgreSQL Row-Level Security policies; add the security test suite from `docs/MULTI_TENANT_HOSPITALITY_OS_ARCHITECTURE.md`'s "Security tests" section (cross-tenant read/write attempts, forged organization IDs, missing membership, privilege escalation).
4. Implement a `SupabaseDashboardDataProvider` behind the existing `DashboardDataProvider` interface — no dashboard or widget component should need to change.
5. Seed BOSSA and Papai as real `organizations` rows; wire `lib/tenancy/tenants.ts` to read from Supabase instead of a static array once auth exists.
6. Settings page (`app/(workspace)/[organizationSlug]/settings/`) becomes the first module to get real content, since it directly needs membership/roles/branding data from this phase.

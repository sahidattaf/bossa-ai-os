# Hospitality OS (bossa-ai-os)

Multi-tenant Hospitality OS platform. **BOSSA Asado i Mar** (Tenant 001, a Curaçao fire-grill restaurant) and **Papai Since 1933** (Tenant 002) run from one Next.js codebase with isolated branding, configuration, and demo data.

```text
Signals → Analysis → Recommendation → Approval → Action → Outcome → Memory
```

Full architecture, database domains, AI Executive design, and the multi-phase migration plan live in [`docs/MULTI_TENANT_HOSPITALITY_OS_ARCHITECTURE.md`](docs/MULTI_TENANT_HOSPITALITY_OS_ARCHITECTURE.md). This README covers what's actually built (Phase 1) and how to run it.

---

## Repository responsibilities

| Repository | Responsibility |
| --- | --- |
| `bossa-ai-os` (this repo) | Internal multi-tenant SaaS application, dashboards, workflows, data, AI manager, tenant administration |
| `hospitality-os-plugin` | Reusable AI skills, prompts, agent playbooks, validation, schemas, orchestration logic |
| `BOSSA-ASADO-I-MAR` | Public BOSSA website, SEO, menu, customer acquisition, lead capture |

Don't merge these responsibilities across repos.

---

## Architecture summary

- **Next.js 15 App Router + React 19 + TypeScript strict**, at the repository root.
- **Tailwind CSS** with semantic design tokens (`app/globals.css`, `tailwind.config.ts`) — no tenant color is hard-coded into a shared component.
- **shadcn/ui-compatible primitives** (`components/ui/`) built on Radix UI + `class-variance-authority`.
- **Tenant configuration** (`lib/tenancy/`) resolves `/[organizationSlug]` to a typed `TenantConfig`, either from a static array (`mock` mode) or, since Phase 2, from real Supabase rows behind an authenticated, membership-verified query (`supabase` mode) — see below.
- **Widget system** (`lib/widgets/`) — a typed, Zod-validated registry mapping each dashboard widget key to a component and a data selector.
- **Provider-neutral data layer** (`lib/dashboard/`) — `DashboardDataProvider` interface, backed by `MockDashboardDataProvider` (default) or `SupabaseDashboardDataProvider` (Phase 2). No dashboard component imports mock data directly.
- **Authentication and Row-Level Security** (`supabase/`, `lib/supabase/`) — Phase 2. See "Authentication and tenancy" below.

```text
app/(workspace)/[organizationSlug]/
├── layout.tsx        # resolves tenant, 404s on unknown slug, wraps in AppShell
├── dashboard/         # fully built (this phase's focus)
└── {orders,reservations,crm,kitchen,menu,inventory,suppliers,
     reviews,marketing,finance,staff,tasks,reports,integrations,
     settings,ai-executive}/   # routed, styled, phase-tagged "coming soon"
```

---

## Installation

Requires Node.js 20+ and npm.

```bash
npm install
```

## Development

```bash
npm run dev
```

Open `http://localhost:3000` — it links to `/bossa/dashboard` and `/papai/dashboard`. By default (no `.env.local`) the app runs in `mock` mode: no auth, static tenant data. See "Authentication and tenancy" below to run against real Supabase.

## Validation

```bash
npm run lint        # eslint .
npm run typecheck   # tsc --noEmit
npm run test         # vitest run (unit tests)
npm run test:e2e     # playwright test (first run: npx playwright install chromium)
npm run build        # next build
npm run validate     # lint && typecheck && test && build
```

`npm run validate` is the required gate before merging — it does not include `test:e2e` or the Supabase database tests (see `docs/SUPABASE_OPERATIONS.md`; both need infra beyond a plain `npm ci`, and both run in CI).

`format` / `format:check` run Prettier (`prettier-plugin-tailwindcss` keeps class lists sorted).

### Playwright browser install

E2E tests need a Chromium binary the first time:

```bash
npx playwright install chromium
```

The Playwright web server rebuilds and boots a fresh `next start` for each e2e run, so the very first request or two can be slow to respond immediately after boot. `playwright.config.ts` runs 2 workers with 1 local retry to absorb that instead of masking a real bug.

---

## Legacy prototype

The original static dashboard prototype (vanilla HTML/CSS/JS, Google Sheets + Supabase adapters, the KPI analyzer/decision/action rules engine) is preserved as-is under `legacy/static-dashboard/`:

```bash
npm --prefix legacy/static-dashboard run dev
```

Opens on `http://localhost:8000`. Nothing in it was deleted — Phase 1's mock dashboard data (`lib/dashboard/mock-data/bossa.ts`) reuses its demo numbers and AI-rules-engine copy where they still make sense.

---

## Authentication and tenancy

One env var controls everything: `DASHBOARD_DATA_PROVIDER` (server-only, `mock` default | `supabase`).

- **`mock`** (no setup required): Phase 1 behavior exactly — static tenant list, no sign-in, `MockDashboardDataProvider`. This is what CI's `validate` and `e2e` jobs run against.
- **`supabase`**: real Supabase Auth, membership-verified tenant resolution, `SupabaseDashboardDataProvider`, PostgreSQL Row-Level Security. Requires a running Supabase project — for local dev:

```bash
npm run supabase:start   # boots the local stack (needs Docker)
npm run supabase:reset   # applies every migration + seed.sql
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from `supabase status`,
# and set DASHBOARD_DATA_PROVIDER=supabase
npm run dev
```

Sign in at `/login` as a seeded dev user (`owner@bossa.test` / `DevPassword123!`, see `docs/SUPABASE_OPERATIONS.md` for the full list — local/dev fixtures only, never real credentials). Full operational detail:

- [`docs/SUPABASE_OPERATIONS.md`](docs/SUPABASE_OPERATIONS.md) — local setup, migrations, seeded users, rollback/recovery, linking a real project
- [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md) — threat model, the full RLS policy inventory, and why each deliberate exception exists
- [`docs/PHASE_2_IMPLEMENTATION_REPORT.md`](docs/PHASE_2_IMPLEMENTATION_REPORT.md) — what shipped, validation results

### Roles and permissions, briefly

8 roles (`organization_owner`, `general_manager`, `finance_manager`, `operations_manager`, `marketing_manager`, `staff`, `viewer`, plus cross-org `platform_admin`) × 18 dot-namespaced permissions (`dashboard.read`, `finance.write`, `organization.manage`, …), seeded in `supabase/migrations/20260721230002_identity_and_catalog.sql`. `lib/widgets/permissions.ts::hasPermission()` — unchanged since Phase 1 — is what actually enforces this at render time; the `supabase` mode workspace layout just populates its input from a real per-request `get_my_permissions()` call instead of a wildcard default.

---

## Tenant configuration guide

Tenants are defined in [`lib/tenancy/tenants.ts`](lib/tenancy/tenants.ts) against the `TenantConfig` type in [`lib/tenancy/types.ts`](lib/tenancy/types.ts):

```ts
interface TenantConfig {
  id: string;
  slug: string;             // route segment: /[slug]/dashboard
  name: string;
  businessType: BusinessType;
  branding: TenantBranding; // logo initials, primary/accent HSL, theme mode, radius
  locale: string;
  timezone: string;
  currency: string;         // ISO 4217
  serviceStatus: ServiceStatus;
  aiManagerName: string;
  productKpi: { label: string; unit?: string };
  dashboardWidgets: DashboardWidgetInstanceConfig[];
}
```

To onboard a new tenant: add a `TenantConfig` to `lib/tenancy/tenants.ts`, add its mock dataset under `lib/dashboard/mock-data/`, and register it in `lib/dashboard/mock-provider.ts`. No shared component needs to change — branding flows through `lib/tenancy/theme.ts`, which turns `branding.primaryColor` / `accentColor` / `borderRadius` into CSS custom-property overrides applied at the `[organizationSlug]` layout boundary. `branding.themeMode` sets `data-theme` (`dark` for BOSSA, `light` for Papai in this seed data) — same components, opposite themes.

---

## Dashboard widget guide

`lib/widgets/registry.ts` maps every `WidgetKey` (see `WIDGET_KEYS` in `lib/tenancy/types.ts`) to a `WidgetDefinition`:

```ts
interface WidgetDefinition<TData> {
  key: WidgetKey;
  title: string;                 // shown in the WidgetFrame card header (blank = self-titling widget)
  defaultSize: WidgetSize;        // sm | md | lg | full
  component: ComponentType<{ data: TData; tenant: TenantConfig }>;
  selectData: (dashboardData: DashboardData, tenant: TenantConfig) => TData;
}
```

`components/dashboard/dashboard-grid.tsx` reads a tenant's `dashboardWidgets` config, validates it at runtime with the Zod schema in `lib/widgets/schema.ts`, sorts by `order`, and renders each widget inside a `WidgetFrame` that uniformly handles the loading/empty/error/permission-restricted states (`components/ui/{empty,error,permission}-state.tsx`). Widgets never import tenant data directly — everything comes through `DashboardGrid`'s `selectData` call.

To add a widget: add its key to `WIDGET_KEYS`, add a field to `DashboardData` (`lib/dashboard/types.ts`) and both mock datasets, build the component under `components/dashboard/widgets/`, and register it in `lib/widgets/registry.ts`. To change what a tenant shows, edit its `dashboardWidgets` array — no JSX changes required.

---

## Migration status

| Phase | Status |
| --- | --- |
| Phase 0 — Preserve prototype | Done (`legacy/static-dashboard/`) |
| Phase 1 — Next.js + design-system foundation | Done — [report](docs/PHASE_1_IMPLEMENTATION_REPORT.md) |
| **Phase 2 — Supabase tenancy and authentication** | **Done** — [report](docs/PHASE_2_IMPLEMENTATION_REPORT.md) |
| Phase 3 — Live operational modules | Not started |
| Phase 4 — AI Executive MVP | Not started |
| Phase 5 — Integrations | Not started |
| Phase 6 — SaaS commercialization | Not started |

See the full backlog in [`docs/MULTI_TENANT_HOSPITALITY_OS_ARCHITECTURE.md`](docs/MULTI_TENANT_HOSPITALITY_OS_ARCHITECTURE.md).

## Next phase: live operational modules

Phase 3 adds the operational tables (orders, reservations, CRM/leads, inventory, menu & costing, staff/tasks, finance snapshots), each following the same `organization_id` + RLS pattern Phase 2 established. `SupabaseDashboardDataProvider` (`lib/dashboard/supabase-provider.ts`) currently returns honest zero/empty values for every operational widget — Phase 3 replaces those with real queries. `has_permission()` already recognizes the relevant permission keys (`orders.read`, `orders.write`, etc.), and `record_audit_event()` is ready for operational mutations to log against. No dashboard, widget, or shell component should need to change.

---

## BOSSA Operating Principle

> Decide fast. Route clean. Review outcomes. Memory compounds.

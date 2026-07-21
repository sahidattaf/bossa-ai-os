# Hospitality OS — Multi-Tenant Product Architecture

## Executive Decision

`bossa-ai-os` becomes the product seed for a multi-tenant Hospitality OS application.

The repositories keep separate responsibilities:

| Repository | Responsibility |
| --- | --- |
| `bossa-ai-os` | Internal multi-tenant SaaS application, dashboards, workflows, data, AI manager, and tenant administration |
| `hospitality-os-plugin` | Reusable AI skills, prompts, agent playbooks, validation, schemas, and orchestration logic |
| `BOSSA-ASADO-I-MAR` | Public BOSSA website, SEO, menu, customer acquisition, lead capture, and public brand content |

BOSSA Asado i Mar is Tenant 001. Papai Since 1933 is Tenant 002. Future restaurants, hotels, cafés, beach clubs, caterers, and tourist experiences use the same codebase with isolated data, branding, configuration, users, and AI-manager policies.

---

## Product Principle

```text
Signals → Analysis → Recommendation → Approval → Action → Outcome → Memory
```

The dashboard must not only show metrics. It must recommend prioritized actions, explain why, route ownership, track approvals, and learn from results.

---

## Architecture Overview

```text
Public Brand Sites
├── bossaasado.com
├── future Papai site
└── future client sites
        │
        ▼
Hospitality OS API / Webhooks
        │
        ▼
Supabase Data Platform
├── PostgreSQL
├── Authentication
├── Row-Level Security
├── Realtime
├── Storage
└── Edge Functions
        │
        ▼
Hospitality OS Application
├── Executive Dashboard
├── Orders
├── Reservations
├── CRM / WhatsApp Leads
├── Inventory
├── Menu Costing
├── Staff / Labor
├── Suppliers
├── Reviews
├── Marketing
├── Finance
└── AI Executive
        │
        ▼
AI Orchestration Layer
├── Tenant Context Resolver
├── Signal Normalizer
├── Deterministic Rules Engine
├── LLM Recommendation Engine
├── Approval Gate
├── Action Router
├── Audit Log
└── Memory / Outcome Learning
        │
        ▼
Hospitality OS Plugin Skills
├── Sales Operator
├── Menu Engineer
├── Revenue Optimizer
├── Inventory Agent
├── Review Generator
├── AI Concierge
├── BOSSA-specialized agents
└── future tenant skill packs
```

---

## Recommended Application Stack

### Frontend

- Next.js App Router
- React and TypeScript with strict type checking
- Tailwind CSS
- shadcn/ui as the reusable component foundation
- Server Components by default; Client Components only for interactive UI
- Zod for runtime input validation
- React Hook Form for complex forms

### Backend and Data

- Supabase PostgreSQL as the operational source of truth
- Supabase Auth for user authentication
- PostgreSQL Row-Level Security for tenant isolation
- Supabase Storage for menus, invoices, photos, reports, and brand assets
- Supabase Realtime for live orders, reservations, alerts, and dashboard updates
- Supabase Edge Functions for inbound webhooks and secure integrations

### AI Layer

- Provider-neutral AI gateway interface
- Claude and OpenAI adapters behind the same internal contract
- Deterministic rules before LLM calls
- Structured JSON outputs validated with Zod
- Human approval for financial, customer-facing, supplier, staffing, and destructive actions
- Full prompt, input, output, cost, latency, approval, and execution audit trail

### Deployment

- Vercel for the Next.js application
- Supabase for data and backend services
- GitHub Actions for type checking, linting, unit tests, database checks, and production builds

---

## Multi-Tenant Model

### Tenant hierarchy

```text
Organization
└── Locations
    ├── Users and memberships
    ├── Branding
    ├── Operating configuration
    ├── Menus and pricing
    ├── Reservations and orders
    ├── Customers and leads
    ├── Inventory and suppliers
    ├── KPIs and financial snapshots
    ├── AI-manager configuration
    └── audit history
```

### Initial tenants

```yaml
organizations:
  - slug: bossa
    name: BOSSA Asado i Mar
    type: restaurant
    status: active
  - slug: papai
    name: Papai Since 1933
    type: restaurant
    status: onboarding
```

### Required tenant-isolation rule

Every tenant-owned operational table must include `organization_id` and, where relevant, `location_id`.

All reads and writes must be protected by Row-Level Security. Client requests must never be trusted to choose an unrestricted tenant ID. The active organization must be resolved from authenticated membership and verified server-side.

---

## Core Database Domains

### Identity and tenancy

1. `organizations`
2. `locations`
3. `profiles`
4. `organization_memberships`
5. `roles`
6. `role_permissions`

### Brand and configuration

7. `organization_branding`
8. `organization_settings`
9. `integration_connections`
10. `ai_manager_profiles`
11. `ai_policies`

### Commercial operations

12. `contacts`
13. `guest_profiles`
14. `prospects`
15. `clients`
16. `leads`
17. `reservations`
18. `orders`
19. `order_items`
20. `payments`
21. `whatsapp_conversations`
22. `whatsapp_messages`

### Menu and inventory

23. `menu_categories`
24. `menu_items`
25. `recipes`
26. `recipe_ingredients`
27. `inventory_items`
28. `inventory_movements`
29. `suppliers`
30. `supplier_products`
31. `purchase_orders`
32. `purchase_order_items`

### Staff and execution

33. `staff_members`
34. `shifts`
35. `labor_snapshots`
36. `tasks`
37. `task_comments`
38. `sops`
39. `sop_runs`

### Marketing and reputation

40. `reviews`
41. `review_requests`
42. `content_posts`
43. `campaigns`
44. `campaign_metrics`
45. `partner_accounts`
46. `partner_activities`

### Finance and intelligence

47. `daily_sales_snapshots`
48. `expense_entries`
49. `kpi_snapshots`
50. `forecasts`
51. `signals`
52. `recommendations`
53. `decisions`
54. `actions`
55. `action_outcomes`
56. `agent_runs`
57. `audit_logs`

---

## Roles and Permissions

Initial role set:

| Role | Primary access |
| --- | --- |
| Platform Owner | All organizations, billing, templates, platform configuration |
| Organization Owner | Full access inside one organization |
| General Manager | Operations, staffing, finance summaries, approvals |
| Restaurant Manager | Orders, reservations, inventory, staff tasks, reviews |
| Chef / Kitchen Lead | Kitchen, recipes, inventory usage, purchase requests |
| Marketing Manager | Campaigns, content, reviews, CRM segments |
| Finance | Revenue, costs, payroll summaries, supplier balances |
| Staff | Assigned tasks and limited operational views |
| Read Only | Dashboard and reports without mutation rights |

Permissions must be capability-based rather than hard-coded UI checks. Examples:

```text
reservations.read
reservations.write
inventory.read
inventory.adjust
finance.read
finance.approve
ai.recommendations.read
ai.actions.approve
organization.manage
```

---

## AI Executive Architecture

### 1. Tenant Context Resolver

Builds a verified context object containing:

```ts
interface TenantContext {
  userId: string;
  organizationId: string;
  locationIds: string[];
  activeLocationId?: string;
  roleIds: string[];
  permissions: string[];
  locale: string;
  timezone: string;
  currency: string;
  brandProfile: BrandProfile;
  aiManagerProfile: AIManagerProfile;
}
```

### 2. Signal Normalizer

Converts raw events into a standard signal shape:

```ts
interface Signal {
  id: string;
  organizationId: string;
  locationId?: string;
  source: "orders" | "reservations" | "inventory" | "reviews" | "labor" | "finance" | "weather" | "crm";
  type: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  observedAt: string;
  payload: Record<string, unknown>;
}
```

### 3. Deterministic Rules Engine

Rules execute before any model call. Examples:

- Food cost exceeds organization target
- Labor percentage exceeds target
- Stock falls below reorder point
- Reservation load exceeds capacity threshold
- Customer message remains unanswered beyond SLA
- Review rating falls below threshold
- Weekend Fire Box inventory is insufficient for committed orders

### 4. Recommendation Engine

The model receives only validated tenant context, normalized signals, policy constraints, and relevant memory. It returns structured recommendations:

```ts
interface Recommendation {
  title: string;
  summary: string;
  priority: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  evidence: EvidenceReference[];
  suggestedActions: SuggestedAction[];
  requiresApproval: boolean;
  approvalType?: "customer_message" | "supplier_order" | "finance" | "staffing" | "publish";
  expiresAt?: string;
}
```

### 5. Approval Gate

No AI-generated action may execute when it changes money, inventory, staffing, supplier commitments, customer communications, public content, or protected records unless organization policy explicitly allows it.

### 6. Action Router

Routes approved actions to adapters:

```text
Task → internal task service
WhatsApp → WhatsApp provider adapter
Email → email adapter
Reservation → reservation service
Purchase order → supplier workflow
Content → social publishing workflow
Calendar → calendar adapter
Notion → knowledge sync adapter
```

### 7. Outcome Learning

Every executed action records:

- recommendation source
- approval actor
- execution status
- measurable outcome
- owner feedback
- reusable learning

This creates tenant-specific operating memory without mixing one business's confidential data into another tenant.

---

## Application Navigation

```text
Dashboard
AI Executive
Orders
Reservations
CRM
Kitchen
Menu & Costing
Inventory
Suppliers
Reviews
Marketing
Finance
Staff
Tasks & SOPs
Reports
Integrations
Organization Settings
Platform Admin
```

### Dashboard composition

The dashboard supports configurable widgets but ships with a stable default:

1. Revenue today
2. Orders today
3. Reservations tonight
4. Unanswered leads
5. Review score
6. Product / campaign metric such as Fire Boxes sold
7. Food cost percentage
8. Labor percentage
9. AI priorities
10. Live service alerts
11. Revenue forecast
12. Tasks requiring approval

---

## Design-System Strategy

### Shared semantic tokens

Do not hard-code BOSSA orange across reusable components. Use semantic tokens:

```css
--background
--foreground
--surface
--surface-elevated
--border
--muted
--muted-foreground
--primary
--primary-foreground
--secondary
--secondary-foreground
--success
--warning
--danger
--info
--chart-1
--chart-2
--chart-3
```

### Tenant branding

Each organization stores:

```ts
interface TenantBranding {
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor: string;
  accentColor: string;
  backgroundMode: "light" | "dark" | "system";
  headingFont?: string;
  bodyFont?: string;
  borderRadius: "compact" | "standard" | "soft";
}
```

BOSSA can remain charcoal and ember orange. Papai receives its own identity without forking UI components.

### Component layers

```text
components/ui          primitive shadcn-based controls
components/layout      shell, sidebar, header, tenant switcher
components/dashboard   cards, widgets, grids, alerts
components/domain      orders, reservations, inventory, finance
components/ai          recommendations, evidence, approvals, agent runs
components/branding    logo, theme provider, tenant identity
```

---

## Target Repository Structure

```text
bossa-ai-os/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── onboarding/
│   ├── (platform)/
│   │   └── platform-admin/
│   ├── (workspace)/
│   │   └── [organizationSlug]/
│   │       ├── dashboard/
│   │       ├── ai-executive/
│   │       ├── orders/
│   │       ├── reservations/
│   │       ├── crm/
│   │       ├── kitchen/
│   │       ├── menu/
│   │       ├── inventory/
│   │       ├── suppliers/
│   │       ├── reviews/
│   │       ├── marketing/
│   │       ├── finance/
│   │       ├── staff/
│   │       ├── tasks/
│   │       ├── reports/
│   │       ├── integrations/
│   │       └── settings/
│   ├── api/
│   │   ├── webhooks/
│   │   ├── ai/
│   │   └── integrations/
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/
│   ├── layout/
│   ├── dashboard/
│   ├── domain/
│   ├── ai/
│   └── branding/
├── lib/
│   ├── auth/
│   ├── tenancy/
│   ├── permissions/
│   ├── supabase/
│   ├── ai/
│   │   ├── providers/
│   │   ├── rules/
│   │   ├── schemas/
│   │   ├── prompts/
│   │   └── orchestration/
│   ├── integrations/
│   ├── analytics/
│   └── validation/
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   ├── tests/
│   └── functions/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── security/
├── docs/
└── scripts/
```

---

## Migration Plan from the Current Static Prototype

### Phase 0 — Preserve and inventory

- Preserve the existing static dashboard under `legacy/static-dashboard/`.
- Record current widgets, decision rules, adapters, data fields, and demo behavior.
- Capture the current dashboard as a visual regression reference.

**Exit criteria**

- No prototype logic is lost.
- Existing static dashboard still runs from its preserved folder.
- Migration inventory is committed.

### Phase 1 — Next.js and design-system foundation

- Initialize Next.js with TypeScript strict mode.
- Install Tailwind and shadcn/ui.
- Create semantic design tokens.
- Build application shell, responsive sidebar, top bar, tenant switcher, and dashboard grid.
- Recreate the Claude Design dashboard using reusable components and demo data.

**Exit criteria**

- Desktop and mobile layouts work.
- No tenant-specific color is hard-coded in primitives.
- Dashboard widgets render from typed configuration.
- Type check, lint, tests, and production build pass.

### Phase 2 — Supabase tenancy and authentication

- Add organizations, locations, profiles, memberships, branding, roles, and permissions.
- Add Supabase Auth.
- Add Row-Level Security policies.
- Seed BOSSA and Papai.
- Resolve tenant context server-side.

**Exit criteria**

- BOSSA users cannot read or mutate Papai data.
- Papai users cannot read or mutate BOSSA data.
- Unauthorized access tests pass.
- Tenant theme changes without code duplication.

### Phase 3 — Live operational modules

Build in this order:

1. reservations
2. leads / CRM
3. orders
4. menu and costing
5. inventory and suppliers
6. reviews
7. staff and tasks
8. finance snapshots

**Exit criteria**

- Dashboard KPIs are computed from live tenant data.
- Mutations generate audit records.
- Empty, loading, error, and permission states exist for every module.

### Phase 4 — AI Executive MVP

- Add signal ingestion.
- Add deterministic rules.
- Add structured recommendation generation.
- Add evidence display.
- Add approval queue.
- Add action and outcome tracking.
- Connect selected skills from `hospitality-os-plugin`.

**Exit criteria**

- AI recommendations cite internal evidence records.
- Invalid model output is rejected safely.
- Approval-required actions cannot bypass policy.
- Every model run is logged with tenant ID, model, latency, cost metadata, and outcome.

### Phase 5 — Integrations

Priority order:

1. Notion knowledge synchronization
2. WhatsApp lead and conversation integration
3. Google Calendar reservations / events
4. Google Reviews ingestion
5. accounting export
6. POS connectors through provider adapters
7. ElevenLabs voice concierge

**Exit criteria**

- Integrations are isolated by organization.
- Secrets are encrypted and never returned to the browser.
- Webhooks verify provider signatures where supported.
- Retry and dead-letter behavior exists for failed events.

### Phase 6 — SaaS commercialization

- Organization onboarding
- Plan entitlements
- Usage metering
- Subscription billing
- Template gallery
- White-label controls
- Platform support dashboard
- Tenant export and deletion workflows

**Exit criteria**

- New tenant can be provisioned without code changes.
- Plan limits are enforced server-side.
- Tenant data can be exported and deleted through a controlled workflow.

---

## Validation and Test Strategy

### Unit tests

- KPI calculations
- recommendation scoring
- permission evaluation
- tenant-context resolution
- schema validation
- inventory reorder rules
- food-cost and labor thresholds

### Integration tests

- Supabase queries with authenticated tenant context
- reservation and lead creation
- audit-log generation
- AI recommendation persistence
- approval and execution transitions
- integration adapter failures and retries

### Security tests

- Cross-tenant read attempts
- Cross-tenant mutation attempts
- forged organization IDs
- missing membership
- privilege escalation
- insecure webhook payloads
- accidental secret exposure

### End-to-end tests

1. Sign in as BOSSA manager.
2. Open BOSSA dashboard.
3. Create a reservation.
4. Observe KPI update.
5. Trigger a high-capacity signal.
6. Generate an AI recommendation.
7. Approve the recommended action.
8. Confirm action and audit record.
9. Switch to Papai.
10. Confirm no BOSSA operational data is visible.

### Required CI checks

```text
format check
lint
TypeScript typecheck
unit tests
integration tests
RLS security tests
production build
```

No pull request may merge when a required check fails.

---

## Initial Product Backlog

### Epic A — Foundation

- Convert static dashboard to Next.js
- Create design tokens
- Create reusable application shell
- Create widget registry
- Add responsive behavior

### Epic B — Tenancy

- Create tenancy schema
- Create authentication
- Create membership and permission system
- Create organization switcher
- Add tenant branding
- Add RLS tests

### Epic C — BOSSA live workspace

- Seed BOSSA configuration
- Connect reservations
- Connect leads
- Connect orders
- Add Fire Box KPI
- Add food-cost and labor targets

### Epic D — Papai onboarding

- Create Papai organization
- Add Papai branding
- Add initial location
- Add Papai AI-manager profile
- Verify data isolation

### Epic E — AI Executive

- Signal schema
- rules engine
- recommendation contract
- provider gateway
- approval queue
- action router
- outcome memory

---

## Decision Log

### D-001: Canonical product repository

**Decision:** Use `bossa-ai-os` as the migration seed for the multi-tenant application.

**Reason:** It already contains the dashboard, decision logic, signal-to-action concept, adapters, and operating rhythm. Reusing it avoids rebuilding proven prototype logic.

### D-002: Public website separation

**Decision:** Keep `BOSSA-ASADO-I-MAR` as the public brand and revenue website.

**Reason:** Public SEO and customer acquisition have different security, deployment, content, and release concerns from an internal multi-tenant operating system.

### D-003: Skills separation

**Decision:** Keep `hospitality-os-plugin` as the reusable AI skill and playbook package.

**Reason:** Skills should be versionable and reusable independently of the web application's UI and database.

### D-004: Tenant isolation

**Decision:** Enforce tenant isolation in PostgreSQL Row-Level Security, not only in frontend routing.

**Reason:** UI-only tenancy is not a security boundary.

### D-005: Human approval

**Decision:** Human approval is mandatory by default for external communication, financial commitments, staffing changes, public publishing, and destructive actions.

**Reason:** The AI Executive recommends and prepares; authorized operators remain accountable for material actions.

---

## Definition of Flagship MVP

The flagship MVP is complete when:

- One deployed application supports BOSSA and Papai.
- Each business has isolated data, users, branding, settings, and AI-manager configuration.
- BOSSA has live reservations, leads, orders, KPIs, and an approval queue.
- The dashboard is built from reusable shadcn/Tailwind components.
- Supabase authentication and RLS security tests pass.
- The AI Executive produces structured, evidence-backed recommendations.
- Approved actions and outcomes are auditable.
- A third hospitality tenant can be provisioned without creating a code fork.

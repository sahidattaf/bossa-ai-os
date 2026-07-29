# Mobile Owner Cockpit Implementation

## Architecture

Issue #25 adds `components/dashboard/mobile-owner-cockpit.tsx` above the existing dashboard grid on the current `/[organizationSlug]/dashboard` route. The cockpit consumes the same `DashboardData` contract as the widget grid, so mock and Supabase modes stay provider-neutral and desktop widgets remain unchanged.

## Active Orders

`activeOrders` is backed by `get_dashboard_snapshot()` through migration `20260729000001_dashboard_active_orders.sql`. The count uses the canonical non-terminal `order_status` values from the operational status machine:

- `pending`
- `confirmed`
- `preparing`
- `ready`
- `out_for_delivery`

Terminal `completed` and `cancelled` orders are excluded.

## Permissions

The cockpit fails closed in the UI using the same `hasPermission()` helper as the widget grid:

- revenue requires `finance.read`
- reservations require `reservations.read`
- unanswered leads require `crm.read`
- active orders require `orders.read`
- AI action visibility requires `ai.executive.read`

The Supabase provider still relies on server-side RLS and function/table permissions. The dashboard RPC remains `SECURITY INVOKER`, `dashboard.read` gated, and organization scoped.

## AI Recommendation Selection

The live provider selects exactly one owner action:

1. highest-priority recommendation with a pending approval
2. otherwise highest-priority open recommendation

Only `proposed`, `approved`, and `executing` recommendations are eligible. A pending approval links to `/{organizationSlug}/ai-executive/approvals`; fallback recommendations link to their existing detail route. The cockpit never approves, executes, or bypasses the approval workflow.

## CTAs

- Revenue: `/{organizationSlug}/finance`
- Reservations: `/{organizationSlug}/reservations`
- Leads: `/{organizationSlug}/crm`
- Active orders: `/{organizationSlug}/orders`
- Pending AI approval: `/{organizationSlug}/ai-executive/approvals`
- Fallback AI recommendation: `/{organizationSlug}/ai-executive/recommendations/{recommendationId}`

## Tests

Coverage was added for cockpit KPI rendering, honest zero states, protected links, permission hiding, active orders being distinct from orders today, pending-approval preference, fallback recommendation CTA, empty AI state, and the mobile two-column/no-fixed-width layout contract. pgTAP and integration tests cover the active-order RPC behavior and tenant isolation.

## Known Limitations

The finance route is currently a phase-tagged workspace destination, so the cockpit links to the protected finance area even though the detailed finance module is not fully built yet.

# KPI Snapshot Operations — Phase 3A

How `daily_kpi_snapshots` rows get generated, and how to run it manually. No scheduler runs this automatically in Phase 3 — that's a deliberate architecture decision (issue #16 architecture decision #2): **no Vercel Cron, Supabase scheduled job, or other paid/external scheduling is enabled in this phase.**

---

## What it computes

`public.calculate_daily_kpi_snapshot(p_organization_id, p_snapshot_date default current_date, p_location_id default null)` (`supabase/migrations/20260722000006_kpi_snapshot_function.sql`) computes, for one `(organization, location-or-null, date)`:

| Field | Source |
| --- | --- |
| `revenue`, `order_count` | `orders` where `status = 'completed'` and `created_at::date = snapshot_date` |
| `cancellation_count` | `orders` where `status = 'cancelled'` and `created_at::date = snapshot_date` |
| `reservation_count`, `covers` | `reservations` where `reservation_at::date = snapshot_date` and `status not in ('cancelled', 'no_show')` — keyed off the *service date*, not when the booking was made |
| `no_show_count` | `reservations` where `reservation_at::date = snapshot_date` and `status = 'no_show'` |
| `new_leads` | `leads` where `created_at::date = snapshot_date` |
| `unanswered_leads` | `leads` where `created_at::date = snapshot_date` and `status = 'new'` (still unactioned *as of now*, not as of that date) |
| `average_ticket` | `revenue / order_count` (0 if no completed orders) |

`p_location_id = null` computes an organization-wide rollup across all locations; a specific location computes just that location's figures. Both are legal rows under the expression unique index described in `docs/OPERATIONAL_DATA_MODEL.md`.

**Known scope limit:** `cancellation_count` tracks only *order* cancellations. A cancelled *reservation* isn't separately counted anywhere in the snapshot in this phase (only `no_show_count` tracks reservation-side attrition) — a deliberate scope decision to avoid adding a second, differently-shaped cancellation metric before there's a concrete need for one.

## Idempotency

Calling the function twice for the same `(organization, location, date)` always **fully recomputes and upserts** — it never accumulates, and never creates a second row. This is what "safe to rerun" (issue #16 scope F) means concretely: rerunning after a late-arriving order simply corrects that day's numbers.

## Authorization

The function checks `has_permission(p_organization_id, 'finance.read')` **only when `auth.uid()` is not null** — i.e. only when called by a real authenticated user (an in-app "regenerate today's snapshot" action). A service-role invocation (no JWT, `auth.uid()` is null) skips that check entirely, since service-role credentials are already a trusted, audited, server-only context. When called by an authenticated user, it also records a `kpi_snapshot.generated` audit event; a service-role invocation does not (there is no authenticated actor to attribute it to, and `record_audit_event()` would reject a null actor attempting to log against an organization it can't prove membership in).

## Manual invocation

### From the app (single organization, ad hoc)

```ts
import { generateDailyKpiSnapshot } from "@/lib/operations/kpi-snapshots";

await generateDailyKpiSnapshot(supabase, organizationId, { date: new Date(), locationId: null });
```

### From the command line (all organizations, or one by slug)

```bash
npm run kpi:generate                          # every active organization, today (UTC)
npm run kpi:generate -- --date=2026-07-20     # a specific date
npm run kpi:generate -- --org=bossa --date=2026-07-20
```

`scripts/generate-kpi-snapshots.ts` uses `createServiceRoleClient()` (`lib/supabase/service-role.ts`) — it requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the environment, the same service-role credentials guarded by `import "server-only"` everywhere else in this codebase, and used nowhere in a normal user request path. Run it after your nightly close, or any time historical data needs correcting.

## Future scheduling (explicitly not done in Phase 3)

The function and script are written to be schedule-agnostic: a future Vercel Cron route or Supabase scheduled job could call either directly with zero changes. Enabling one is an explicit deployment decision for a later phase, not something this implementation defaults into.

# Order, Reservation, and Lead Workflows — Phase 3A

Documents the status machines enforced by `supabase/migrations/20260722000002_operational_status_machines.sql`, the service-layer operations in `lib/operations/`, and how audit events get recorded. Written for anyone adding a new status value, a new transition, or a new operational domain.

---

## Status machines are enforced at the database layer

CHECK constraints (`supabase/migrations/20260722000001_operational_tables.sql`) fence in each status column's *value set*. They cannot fence in valid *transitions* — issue #16 rule 5 calls this out explicitly ("CHECK constraints for possible values are not sufficient by themselves"). A second mechanism does that: `public.status_transitions`, an allow-list table of `(machine, from_status, to_status)` triples, enforced by one generic trigger function reused across every status column rather than four hand-written near-duplicates:

- **`public.enforce_status_transition()`** — a `BEFORE UPDATE OF <column>` trigger taking `(machine, column)` as trigger arguments. If the old and new values differ and the pair isn't in `status_transitions`, it raises `INVALID_STATUS_TRANSITION: <machine> cannot go from "<old>" to "<new>"`. A no-op update (setting a status to its current value) is always allowed and never checked against the rulebook.
- **`public.audit_status_transition()`** — an `AFTER UPDATE OF <column>` trigger, `(column, entity_type, action)` args, that writes exactly one `audit_logs` row per *actual* status change via `record_audit_event()` — after the BEFORE trigger has already validated it, so every audited transition is, by construction, a legal one.

Both are attached per table/column in the same migration. The **service layer must never call `record_audit_event()` for a status change itself** (architecture decision, issue #16 rule 1) — the trigger already did it. Service functions like `updateLeadStatus()` are deliberately thin wrappers around the `UPDATE` for exactly this reason; see their code comments in `lib/operations/`.

## The rulebooks

### `lead_status` (table `leads`)

```
new ──► contacted ──► qualified ──► converted
 │           │              │
 └────────► lost ◄──────────┘
```

`contacted -> converted` is also legal (not every lead needs a distinct "qualified" step — e.g. a WhatsApp lead that books immediately). `converted` and `lost` are terminal.

### `reservation_status` (table `reservations`)

```
pending ──► confirmed ──► seated ──► completed
   │             │
   └──────────► cancelled       confirmed ──► no_show
```

`completed`, `cancelled`, `no_show` are terminal.

### `order_status` (table `orders`, column `status`)

```
pending ──► confirmed ──► preparing ──► ready ──► completed
   │             │            │           │
   └──────────► cancelled ◄───┘           └──► out_for_delivery ──► completed
```

`completed` and `cancelled` are terminal. Cancellation is allowed through `preparing`; not from `ready` or later — by that point the kitchen has committed the order.

### `order_payment_status` (table `orders`, column `payment_status`)

```
unpaid ──► partially_paid ──► paid ──► refunded
  │                              ▲
  └──────────────────────────────┘
```

`refunded` is terminal.

Adding a value to any of these requires two changes: the column's `CHECK` constraint (value set) and new rows in `status_transitions` (which transitions into/out of it are legal) — one without the other leaves either an unreachable value or an unconstrained jump.

## Service-layer operations (`lib/operations/`)

All operations take a session-bound Supabase client (never a service-role client) and validate input with `zod` before touching the database — a failed parse becomes a `VALIDATION_FAILED` `OperationalError` (see `lib/errors.ts`) before any query runs.

| Function | File | Notes |
| --- | --- | --- |
| `createLead`, `updateLead`, `updateLeadStatus` | `leads.ts` | `createLead` records a `lead.created` audit event itself (a creation event, not a status transition — no duplication with the trigger) |
| `createReservation`, `updateReservation`, `updateReservationStatus`, `cancelReservation` | `reservations.ts` | Confirmation codes are generated server-side, never client-supplied |
| `createOrder`, `updateOrder`, `updateOrderStatus`, `updateOrderPaymentStatus`, `cancelOrder`, `addOrderItem`, `updateOrderItem`, `removeOrderItem`, `getOrderWithItems` | `orders.ts` | Never sets `subtotal`/`total` — the database always computes them (see `docs/OPERATIONAL_DATA_MODEL.md`) |
| `convertLeadToReservation`, `convertLeadToOrder` | `conversions.ts` | Creates the reservation/order, then moves the lead to `converted` (a legal transition per the rulebook above), then records a distinct `lead.converted_to_reservation`/`lead.converted_to_order` audit event — again, not a duplicate of the trigger's own `lead.status_changed` entry |
| `generateDailyKpiSnapshot`, `listRecentKpiSnapshots` | `kpi-snapshots.ts` | See `docs/KPI_SNAPSHOT_OPERATIONS.md` |

Every mutation surfaces exactly one of the typed `OperationalErrorCode`s from `lib/errors.ts` — a database rejection (permission, FK mismatch, invalid transition, uniqueness conflict) is never leaked as a raw Postgres error to a route or page.

## What's deliberately not built in Phase 3A

Per issue #16's delivery strategy, Phase 3B domains (Inventory, Suppliers, Menu Costing, Reviews, Staff/Tasks, Finance) get **no** tables, CRUD screens, or placeholder schema in this phase — only the seams that already exist (the permission catalog, the audit function, the RLS pattern) are reusable by them later. Building incomplete screens or unused tables for those domains was explicitly out of scope.

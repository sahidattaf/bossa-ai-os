# Security Model — Phase 2

How Hospitality OS enforces tenant isolation, authentication, and role-based access. Written for anyone reviewing or extending the Supabase schema in `supabase/migrations/`.

---

## Threat model

**In scope:**
- One authenticated user of Organization A reading, writing, or inferring the existence of Organization B's operational data.
- A member of an organization escalating their own role or permissions beyond what was granted to them.
- A route slug or a client-submitted UUID being trusted as an access grant.
- Forged or edited audit history.
- The service-role (RLS-bypassing) key being exposed to the browser or used on a request path.

**Explicitly out of scope for Phase 2** (tracked for later phases): self-serve organization signup, cross-tenant data sharing/collaboration features, rate limiting, DoS protection, session fixation beyond what Supabase Auth's cookie handling already provides.

---

## Core principle: access comes from authenticated membership, never from the URL

`app/(workspace)/[organizationSlug]/layout.tsx` resolves the `[organizationSlug]` route param to a tenant, but **the param itself grants nothing**. Every query that follows is scoped by Postgres RLS reading `auth.uid()` from the request's own JWT — a user cannot see or affect a different organization's data by editing the URL, because the database, not the route, is what's checking.

```
Route param (organizationSlug)
        │  (used only to look up which org to attempt)
        ▼
get_organization_summary(slug)   ── SECURITY DEFINER, returns {id, slug, name} for ANY org
        │
        ├─ no row  ──────────────────────────────► 404 (not-found)
        │
        └─ row found
                │
                ▼
        SELECT organizations WHERE id = ...   ── RLS-scoped, using is_org_member(id)
                │
                ├─ 0 rows (not a member) ───────► permission-state page (not 404 — the org
                │                                  is real, the user just can't see it)
                │
                └─ 1 row (active member) ───────► real TenantConfig + real permission list,
                                                    built from organization_branding /
                                                    organization_settings / get_my_permissions()
```

## Why two lookups, not one

A plain `SELECT * FROM organizations WHERE slug = $1` under RLS returns **zero rows** both when the organization doesn't exist and when it exists but the caller isn't a member — RLS can't be told to "return the row but redact the columns," it just filters rows out. Distinguishing those two cases (required by issue #13: unknown org → 404, known org → permission state) needs a query that isn't membership-gated. `get_organization_summary(slug)` is that query: a `SECURITY DEFINER` function returning only `{id, slug, name}` for *any* organization to *any authenticated* user, regardless of membership.

This is a **deliberate, narrow exception** to "access comes from membership," reasoned about explicitly:
- What it exposes: an organization's existence and its display name. Comparable in sensitivity to a company name being publicly knowable (BOSSA's or Papai's existence isn't a secret).
- What it never exposes: branding, settings, membership, financials, or anything else — those all stay behind the real `organizations`/`organization_settings`/etc. RLS-scoped queries.
- Who can call it: `authenticated` only (not `anon`) — you still have to sign in first.

`get_my_permissions(org_id)` and `get_my_role_names(org_id)` are the same pattern for a narrower purpose: they let the app read *the caller's own* effective grants without the app needing to independently re-implement the membership→role→permission join (and risk getting the security-relevant join wrong twice).

---

## RLS policy inventory

Every tenant-owned table has `organization_id`, and every table below has **RLS enabled and forced**.

RLS restricts *which rows* a role can see or change; it does not by itself grant permission to query the table at all — Postgres checks ordinary `GRANT`s first. `20260721230008_table_grants.sql` grants `authenticated` exactly the operations each table's policies below actually allow (nothing more), and grants `anon` nothing anywhere. This was found missing by the CI `database` job running against a real, freshly-reset database — every query failed with "permission denied for table X" until it was added.

| Table | SELECT | INSERT / UPDATE / DELETE |
| --- | --- | --- |
| `organizations` | `is_org_member(id)` | none for `authenticated` — provisioning is service-role only in Phase 2 |
| `locations` | `is_org_member(organization_id)` | `has_permission(organization_id, 'settings.write')` |
| `organization_memberships` | `is_org_member(organization_id)` | `has_permission(organization_id, 'organization.manage')` |
| `membership_roles` | `is_org_member(organization_id)` | `has_permission(organization_id, 'organization.manage')` |
| `organization_branding` | `is_org_member(organization_id)` | UPDATE only: `has_permission(organization_id, 'settings.write')` |
| `organization_settings` | `is_org_member(organization_id)` | UPDATE only: `has_permission(organization_id, 'settings.write')` |
| `audit_logs` | `has_permission(organization_id, 'audit.read')`, or platform admin for platform-level (`organization_id is null`) rows | **none at all** — see below |
| `roles` / `permissions` / `role_permissions` | `true` for any `authenticated` user (global, read-only catalog) | none for `authenticated` — migration-managed |
| `profiles` | own row, or a co-member's (shares an active membership with the caller) | UPDATE: own row only |
| `platform_admins` | own row only | none for `authenticated` — service-role only |

`is_org_member()` and `has_permission()` (`supabase/migrations/20260721230004_authorization_functions.sql`) are the only things any policy reads. Both are `SECURITY DEFINER`, `STABLE`, with `search_path = public, pg_temp` set explicitly (never relying on the caller's search_path), and `REVOKE ALL ... FROM public` followed by an explicit `GRANT EXECUTE ... TO authenticated` (least privilege — nothing is runnable by `anon`).

## Staff cannot escalate role or organization access

Two independent mechanisms, each doing one job:

1. **RLS on `membership_roles`.** Inserting, updating, or deleting a role grant requires `has_permission(organization_id, 'organization.manage')`, held only by `organization_owner` (and platform admins). A `staff`-role member's attempt to insert *any* `membership_roles` row — including one that would just grant themselves `viewer`, not just `organization_owner` — is rejected by the database itself (`42501`), before application code is even involved. Covered by pgTAP tests 10–11.
2. **`protect_last_organization_owner` trigger** (`BEFORE UPDATE OR DELETE ON membership_roles`). Independent of the permission check above: even an `organization_owner` — who *does* hold `organization.manage` — cannot remove the organization's last active `organization_owner` grant. This is what "immutable organization ownership" means here: it's not about who can attempt the change, it's about the organization never being left ownerless. Covered by pgTAP test 12.

`membership_roles.organization_id` is denormalized from `membership_id` by a `BEFORE INSERT OR UPDATE` trigger (`sync_membership_roles_organization_id`), not accepted from the client — otherwise a client could submit a mismatched `organization_id` to fool a policy that reads it directly off the row.

## Audit log immutability

`audit_logs` has **no INSERT/UPDATE/DELETE policy for `authenticated` at all** — not even for organization owners. The only way to write a row is `record_audit_event(...)`, a `SECURITY DEFINER` function that verifies the caller actually belongs to the organization they're logging against, then inserts with definer privileges. Nobody can forge an audit entry attributing an action to someone else, and nobody can edit or delete history through the API. Covered by pgTAP tests 13–16.

## Cross-tenant denial, concretely

- **SELECT**: RLS filters the row out entirely — the query succeeds, returns zero rows. No error, no information about whether the row "exists but is hidden" vs. "doesn't exist" (that's what `get_organization_summary` is for, deliberately, only for organizations).
- **INSERT**: the `WITH CHECK` clause evaluates `has_permission(organization_id, ...)` against the row being inserted; if false, Postgres raises `42501` (`insufficient_privilege`) and the insert never happens.
- **UPDATE / DELETE**: the `USING` clause hides rows the caller isn't authorized for *before* the statement can touch them — a cross-tenant UPDATE/DELETE affects zero rows silently (matches ordinary SQL semantics: `UPDATE ... WHERE <false>` isn't an error), which is why the pgTAP suite verifies "zero rows affected" for those, and `42501` specifically for INSERT.

## Service-role key

`lib/supabase/service-role.ts` is the only place `SUPABASE_SECRET_KEY` is ever read, guarded by `import "server-only"` (an accidental client-side import is a build error, not a runtime leak). **No request path in Phase 2 uses it** — it's reserved for explicit, audited, server-only administration scripts (e.g. future organization provisioning in a later phase). `.env.example` documents it as server-only and never-committed.

## What Phase 2 does *not* cover

- Rate limiting / brute-force protection on `/login` (Supabase Auth's own defaults apply; nothing additional was added).
- Operational tables (orders, reservations, inventory, etc.) — Phase 3. `SupabaseDashboardDataProvider` returns honest zero/empty values for all of them rather than fabricating numbers.
- Self-serve organization creation — provisioning a new organization is still a manual, service-role administrative action.

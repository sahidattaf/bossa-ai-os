# Legacy Data Reconciliation Plan

Issue #22 (Phase 4.5 Lane A2). Metadata-only by design — this document records **what** each legacy dataset is, where it verifiably lives, and what should happen to it, without embedding any actual row content, secrets, or file paths. Companion to `docs/PRODUCTION_ACTIVATION_AUDIT.md` (the verified live comparison this plan is built on) and `docs/PRODUCTION_DEPLOYMENT.md`'s "Legacy Preservation Gate."

---

## Execution status (read this first)

**The live read-only exports have not been executed as part of this change.** This working environment has no `LEGACY_SUPABASE_URL` / `LEGACY_SUPABASE_SECRET_KEY` in its environment or in any local `.env*` file — confirmed by direct inspection, not assumed. Two things *were* verified directly in this environment, requiring no credentials at all:

1. `scripts/export-legacy-supabase-data.ts`'s CLI help and dry-run/list mode both ran successfully for **both** projects, and each printed exactly the fixed allow-listed table set below — matching this issue's expected datasets one-for-one.
2. A real `--confirm` attempt (with no credentials set) correctly refused to proceed (`"LEGACY_SUPABASE_URL and LEGACY_SUPABASE_SECRET_KEY must both be set..."`, exit code 1) and **created no output directory and wrote no file** — confirming the tool fails closed rather than silently writing partial/empty exports.

The actual export, its manifest, its checksums, and the live-vs-exported row-count comparison must be run by Sahid (who has the real project credentials) using the exact commands in `docs/PRODUCTION_DEPLOYMENT.md` § "Legacy export utility," or in a follow-up session where those credentials are supplied. The table below records the **target** state (what must be verified) with a `Reconciliation status` column that is honestly `Not started` for every row until that run happens — this document does not claim verification that didn't occur.

---

## `bossa-ai-os` (project ref `oqmftkttkfktyzefswpz`)

| Dataset | Source table | Verified row count (audit) | Manifest/checksum status | Intended destination / archive decision | Required transformation | Conflict policy | Owner approval required | Reconciliation status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Campaign records | `campaigns` | 3 | Not yet generated — pending a real `--confirm` export run | Archive as historical reference. No equivalent table exists in the current Phase 1–4 schema (a marketing/campaigns module is unbuilt Lane B scope) | None planned until a Lane B marketing table is designed | Not applicable — no destination table yet | Yes — before any future migration target is chosen | Not started |
| Weekly briefing records | `weekly_briefs` | 1 | Not yet generated | Archive as historical reference. No equivalent table exists today | None planned; may inform a future AI Executive weekly-summary feature, not a direct migration | Not applicable — no destination table yet | Yes | Not started |
| Legacy daily KPI records | `kpi_daily` | 1 | Not yet generated | Archive as historical reference — **do not** auto-migrate into the current `daily_kpi_snapshots` table; the legacy row predates multi-tenancy and has no `organization_id`/`location_id` to map to | Manual, row-by-row review required to decide whether this single row corresponds to a real BOSSA date worth backfilling | If ever migrated, `daily_kpi_snapshots` is upsert-safe by design (Phase 3), but only after manual mapping — never an automatic bulk insert | Yes | Not started |
| Legacy decision-log records | `decision_log` | 2 | Not yet generated | Archive as historical reference. No direct equivalent table (closest conceptual match is `audit_logs` or `ai_outcomes`, but neither has a compatible shape or FK path from this legacy data) | None planned; informational only | Not applicable | Yes | Not started |
| Existing auth-user identity metadata | `auth.users` (identity fields only — id, email, timestamps; **never** password hash, tokens, or recovery fields) | 1 | Not yet generated | Owner review required: determine whether this pre-existing identity belongs to a real BOSSA/Papai operator and should receive a real `organization_memberships` row, or should be left with no membership (harmless under RLS either way — no membership means no tenant access) | None — this is metadata review, not a data transformation | N/A | Yes — this is the one dataset that touches real identity, review by Sahid specifically, not automated | Not started |

### Confirmed-empty legacy tables (not missing exports — verified absent of data, correctly excluded from the export allow-list)

These 7 tables exist in `bossa-ai-os`'s legacy schema and were verified at **0 rows** during the original audit (`docs/PRODUCTION_ACTIVATION_AUDIT.md` §3). They are deliberately **not** part of the export tool's allow-list — there is nothing to preserve from an empty table. Two of them (`orders`, `menu_items`) are separately tracked in `docs/PRODUCTION_SCHEMA_COLLISION_CLEANUP_PLAN.md` because their *names*, not their data, collide with this repository's own schema:

`whatsapp_leads`, `orders`, `menu_items`, `bookings`, `users_profiles`, `content_items`, `agent_runs`.

Row counts must be re-verified at actual export time (data may have changed since the audit) — if any of these is found non-empty when the real export finally runs, it must be added to the export allow-list and this table updated before proceeding, not silently skipped.

---

## `Bossa Asado i Mar` (project ref `zgfncoexiqnqeqaxpqdy`)

**Revision note:** an earlier version of this plan assumed `bossa_leads` held real customer contact data (`contact_name`/`phone`/`email`) and proposed migrating it into `public.leads`. A live schema inspection found this assumption wrong: `bossa_leads` has **no contact-detail columns at all**. All 8 rows are CTA (call-to-action) attribution/click events — `lead_type = weekend_fire_order`, `lead_status = "WhatsApp Clicked"`, `order_status = "Requested"`, with a `metadata` object carrying `cta_label`/`cta_source` keys. This is marketing-funnel telemetry, not lead contact records, and the destination decision below has been corrected accordingly.

| Dataset | Source table | Verified row count (audit) | Manifest/checksum status | Intended destination / archive decision | Required transformation | Conflict policy | Owner approval required | Reconciliation status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Legacy CTA/conversion attribution events | `bossa_leads` (verified columns: `lead_type`, `lead_status`, `order_status`, `metadata` with `cta_label`/`cta_source` keys — **no** `contact_name`, `phone`, or `email` column exists) | 8 | Not yet generated | **Do not migrate into `public.leads`** — this repository's `leads` table requires `contact_name` and `phone`, neither of which this data has, and none may ever be fabricated to force a fit. **Archive as historical CTA/conversion-event data.** Reserve a possible future destination in a purpose-built `marketing_attribution_events` or `website_conversion_events` table (unbuilt Lane B scope) that models attribution events on their own terms, not as a lead | None planned until a Lane B attribution/conversion-tracking table is designed with a matching shape (event type, CTA label/source, timestamp — no contact fields required) | Not applicable — no destination table yet, and `public.leads` is explicitly the wrong target | Yes — confirm this archival decision before any future attribution table's design assumes this data as a source | Not started |

Once reconciled (archived), `Bossa Asado i Mar` remains read-only indefinitely (per D1) — it is a source, never a second backend, and is never decommissioned or written to as part of this plan. **No fake contact details are ever synthesized** to force this data into `public.leads`'s shape — if a future attribution/conversion table is never built, this data simply stays archived, which is an acceptable outcome, unlike inventing customer data.

---

## What must happen before any row in either table above changes to `Reconciliation status: In progress`

1. The real `--confirm` export run for both projects (`docs/PRODUCTION_DEPLOYMENT.md` § "Legacy export utility"), producing a manifest with a SHA-256 checksum per table.
2. Independent re-verification: re-query live row counts and recompute each checksum from the exported file, proving both match the manifest — not merely trusting the export run once.
3. Sahid's explicit review and sign-off per dataset (the "Owner approval required" column above is `Yes` for every row — none of this is automated).

This document will be updated in place once that happens — it is not re-created per run.

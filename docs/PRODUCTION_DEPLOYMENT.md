# Production Deployment Runbook

Step-by-step procedure for taking Hospitality OS from `mock` mode to a real, live Supabase-backed production deployment for BOSSA and Papai. Companion to `docs/PRODUCTION_ACTIVATION_AUDIT.md` (the audit findings this runbook is based on) and `docs/SUPABASE_OPERATIONS.md` (local dev operations). Nothing in this document has been executed against a real project by this PR — it is the documented procedure Sahid follows manually, in order, after the decisions in the last section are made.

---

## 0. Decisions required before starting (see audit § "Supabase project comparison")

Do not proceed past step 1 until:

- **D1 — Permanent Supabase project** is chosen, after both `bossa-ai-os` and `Bossa Asado i Mar` have been inspected per `docs/PRODUCTION_ACTIVATION_AUDIT.md`'s comparison framework. This runbook refers to the chosen project as `<chosen-project-ref>` throughout.
- **D2 — Public self-signup**: keep `enable_signup = true` or disable it for production. Recommendation: disable — a real restaurant system should be invite-only.
- **D4 — Email confirmation**: require confirmation for real users in production. Recommendation: enable (opposite of the local-dev default).

---

## 1. Remote migration procedure

```bash
supabase link --project-ref <chosen-project-ref>
supabase db push
```

This applies all 33 committed migrations — every table, RLS policy, function, trigger, grant, and the platform-wide roles/permissions/role_permissions catalog — to the linked project. It moves **no business data**; migrations and bootstrap data are deliberately separate steps (§ "Production seed policy" below).

**Verify before moving on:**

```bash
supabase migration list --linked
```

All 33 migrations should show as applied, with none missing or out of order. Then, in the Supabase dashboard:

- Run the built-in **Security Advisor** and **Performance Advisor** and resolve or explicitly accept every finding.
- Confirm **Project Settings → Backups** shows the plan tier and, if any backups exist yet post-restoration, their retention window. If no backups exist yet, note the date the first backup is expected and do not treat the project as durable until one exists.
- Spot-check a handful of tables in the Table Editor to confirm RLS is shown as enabled or forced, matching `docs/SECURITY_MODEL.md`'s policy inventory.

---

## 2. Production seed policy

- **`supabase/seed.sql` must never be applied to the linked production project.** It is explicitly dev/test-only (fixed all-zero UUIDs, four fake `auth.users` rows with a shared published password). Never run `supabase db reset` against a linked production project — that command is local-only by design (it drops and rebuilds).
- Real tenant data is created by the **separate, dedicated** `scripts/bootstrap-production-tenants.ts` (added by this PR — see § "BOSSA/Papai owner membership procedure" below), which creates only the two real organizations, their locations, branding, and settings, plus real owner memberships. It never touches any other table.
- This separation is the direct implementation of issue #20's rule: "Separate production records from demo/mock fixtures" and "Do not run development seed.sql blindly against production."

---

## 3. Auth site URL and redirect configuration

In the Supabase dashboard for the chosen project (Authentication → URL Configuration):

- **Site URL**: the real production domain (e.g. `https://<your-vercel-domain>`), not `http://localhost:3000`.
- **Redirect URLs**: add the production domain's `/**` wildcard (mirroring `supabase/config.toml`'s local `additional_redirect_urls = ["http://localhost:3000/**"]`), plus any Vercel preview-deployment domains that need password-reset/magic-link flows to work during review.
- **Confirm email** (Authentication → Providers → Email): enable per decision D4.
- **Allow new users to sign up** (Authentication → Providers → Email): disable per decision D2, unless self-serve signup is deliberately wanted.

None of this is expressible in `supabase/config.toml` for a hosted project — that file only configures the local CLI stack.

---

## 4. Environment-variable checklist (Vercel → Project Settings → Environment Variables, Production)

| Variable | Value source | Public / server-only | Notes |
| --- | --- | --- | --- |
| `DASHBOARD_DATA_PROVIDER` | literal `supabase` | server-only | **Do not set this until steps 1–7 are otherwise complete** — see § "Cutover checklist." |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL | public | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API → anon/publishable key | public | **Not** `NEXT_PUBLIC_SUPABASE_ANON_KEY` — issue #20 names it differently from the actual repository convention. Using the wrong name silently breaks `middleware.ts`/`client.ts`/`server.ts`. |
| `SUPABASE_SECRET_KEY` | Project Settings → API → service_role key | **server-only** | Never prefix with `NEXT_PUBLIC_`. Never add to a client-exposed Vercel environment. Only used by `lib/supabase/service-role.ts`'s callers (manual scripts), never a request path. |

**Never** expose `SUPABASE_SECRET_KEY` as a public/browser Vercel variable, and never commit a real value to any file.

---

## 5. BOSSA/Papai owner membership procedure

Real owner accounts and organization records are created by `scripts/bootstrap-production-tenants.ts` (service-role, manual invocation only — never run by CI or any request path). It is **dry-run by default**: running it without `--confirm` prints exactly what it would do and makes no changes.

```bash
# Dry run first — always. Prints the plan, changes nothing.
SUPABASE_SECRET_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
  npm run bootstrap:production-tenants -- --bossa-owner-email=<real-owner-email> --papai-owner-email=<real-owner-email>

# Review the printed plan carefully, then actually apply it:
SUPABASE_SECRET_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
  npm run bootstrap:production-tenants -- --bossa-owner-email=<real-owner-email> --papai-owner-email=<real-owner-email> --confirm
```

What it does, per organization:

1. Upserts the organization by its real, fixed slug (`bossa` / `papai`) — matching the routes the application already uses.
2. Ensures exactly one primary location exists (inserted only if none is found — never overwrites an existing location).
3. Upserts `organization_branding` and `organization_settings`, mirroring the real BOSSA/Papai branding and dashboard-widget configuration that `supabase/seed.sql` already encodes for local dev (that data is BOSSA's and Papai's actual visual identity, not fake fixture data — only the organization ID, users, and dev password in `seed.sql` are fake).
4. If an owner email is given: invites the real user via Supabase Auth's admin invite API (sends a real email), then creates their `organization_memberships` row (`status = 'active'`) and grants the `organization_owner` role via `membership_roles`.

It can be re-run safely — organizations are matched by slug, locations are only inserted if absent, branding/settings use `on conflict (organization_id) do update`, and memberships/role grants use `on conflict do nothing`. It never deletes or overwrites unrelated data, and never touches any table outside this list.

**Papai's `status` is bootstrapped as `'onboarding'`, not `'active'`, matching its real current business state** (mirroring `seed.sql`'s distinction) — do not activate Papai until the business is actually ready to go live, independent of the technical cutover.

---

## 6. Deployed tenant-isolation smoke tests

Run manually against the real production URL after cutover (§ "Post-cutover verification"). This mirrors issue #20's Lane A smoke gate and Phase 2–4's existing pgTAP/integration tenant-isolation guarantees, exercised live for the first time:

1. Sign in as the real BOSSA owner. Confirm the BOSSA dashboard loads with real (not mock) data.
2. Sign in as the real Papai owner. Confirm the Papai dashboard loads only Papai data, never any BOSSA data.
3. While signed in as the BOSSA owner, attempt to visit `/papai/dashboard` directly — confirm the permission-state "no access" page is shown, not Papai's real data.
4. Sign out. Attempt to visit `/bossa/dashboard` directly — confirm redirect to `/login`.
5. Create and update a lead, a reservation, and an order as each owner; confirm each only ever sees their own organization's records.
6. Run `npm run kpi:generate -- --org=bossa` (and `--org=papai` once active) against production and confirm a `daily_kpi_snapshots` row appears.
7. Run `npm run ai:evaluate -- --org=bossa --as-of=<today>` and confirm signals/recommendations appear on the AI Executive page.
8. Approve and execute exactly one low-risk recommendation (e.g. `assign_lead_owner` on a real test lead created for this purpose) and confirm the domain effect, the action-attempt record, and the audit-log entry all appear correctly.

---

## 7. Mock-to-Supabase cutover checklist

Do these in order, on the production Vercel project, only after steps 1–6 above are complete and verified:

- [ ] Remote migrations applied and verified (step 1).
- [ ] Auth site URL and redirect URLs configured for the real domain (step 3).
- [ ] All four environment variables set correctly in Vercel Production (step 4), with `DASHBOARD_DATA_PROVIDER` **not yet** set to `supabase`.
- [ ] `scripts/bootstrap-production-tenants.ts` run with `--confirm` for at least BOSSA (step 5); Papai bootstrapped but left `onboarding` until its own business launch decision.
- [ ] A new Vercel deployment triggered (redeploy, so the new env vars actually take effect) with `DASHBOARD_DATA_PROVIDER` still unset — confirm the site still behaves exactly as it does today (mock mode), proving the other env vars alone don't change behavior.
- [ ] Set `DASHBOARD_DATA_PROVIDER=supabase` in Vercel Production. **This is the actual cutover moment** (decision D5) — a deliberate, separate action, not bundled with any other change.
- [ ] Redeploy (or wait for the next deploy) so the new value takes effect.

---

## 8. Post-cutover verification checklist

- [ ] Run every smoke test in § 6 against the real production URL.
- [ ] Confirm `/login` works and an unauthenticated visit to any workspace route redirects there.
- [ ] Confirm the root `/` tenant selector (still the static Phase 1 list — see audit § "Root page always renders the mock tenant list") correctly links into the now-real, auth-gated dashboards.
- [ ] Confirm audit history (`audit_logs`) is recording real events for the actions taken during smoke testing.
- [ ] Confirm no console or server errors during the smoke pass.
- [ ] Confirm the Supabase dashboard's Security Advisor still shows a clean (or explicitly accepted) result after real data has been written.

---

## 9. Rollback plan

- **Before the `DASHBOARD_DATA_PROVIDER` flip**: rollback is trivial — no other env var change alone alters user-visible behavior (mock mode is unaffected by the Supabase variables being present). If anything looks wrong before the flip, simply don't flip it.
- **After the flip, if something is wrong**: unset `DASHBOARD_DATA_PROVIDER` (or set it to anything other than `supabase`) in Vercel and redeploy — this immediately reverts the live site to mock mode. No data is lost or changed by this; it only changes which `DashboardDataProvider` the app constructs.
- **A bad migration on the linked project**: per `docs/SUPABASE_OPERATIONS.md`'s existing guidance, write a new forward migration that undoes the mistake (e.g. `drop column`, restore a dropped policy) — never edit or delete an already-applied migration file. `supabase migration repair` exists only for correcting already-desynced tracked history after a manual fix, not as a first resort.
- **A bad bootstrap run**: the script never deletes or overwrites existing rows (§ 5) — if it created something wrong (e.g. a mistyped owner email), fix it with a manual, reviewed `update`/`delete` against the specific row, documented at the time, never a re-run of an automated "undo" script.

---

## 10. Backup and recovery guidance

- Confirm the chosen project's backup tier in Project Settings → Backups **before** cutover (audit § "Discovered risks," item 2) — a project on the Free tier has no point-in-time recovery and only whatever backup cadence the plan provides, if any.
- If the project was recently restored from inactive, treat it as having **no recoverable history before the restoration date** until a fresh backup is confirmed to exist.
- `audit_logs` is append-only by design (no `authenticated` UPDATE/DELETE policy exists on it at all) and is not a substitute for a real database backup — it records what happened, it does not let you undo it.
- Once real business data exists, revisit this section to decide whether the current plan tier's backup cadence is sufficient for BOSSA/Papai's actual risk tolerance, and upgrade if not. This is explicitly out of scope for this PR to decide.

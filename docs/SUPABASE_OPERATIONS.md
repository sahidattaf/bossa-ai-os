# Supabase Operations

Operational guide for the Phase 2 multi-tenant `supabase/` project at the repo root. For the legacy static dashboard's unrelated single-tenant Supabase project, see `docs/SUPABASE_SETUP.md`.

---

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (`npm run supabase:start` etc. shell out to it — install separately, it's not an npm dependency)
- Docker (the CLI's local stack runs Postgres, GoTrue, PostgREST, Studio, etc. as containers)

> This repository was developed in a sandbox without Docker available, so the migrations, RLS policies, and seed data in this PR were validated by the `database` job in `.github/workflows/ci.yml` (which runs on a Docker-capable GitHub Actions runner), not by running the stack locally. Run `supabase start` yourself before relying on local dev — see "First-time local setup" below.

---

## First-time local setup

```bash
npm install
npm run supabase:start     # supabase start — pulls and boots the local stack
npm run supabase:reset     # supabase db reset — applies every migration, then seed.sql
cp .env.example .env.local
```

`supabase start` prints your local `API URL`, `anon key`, and `service_role key`. Put the URL and anon key into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and set `DASHBOARD_DATA_PROVIDER=supabase`. Then:

```bash
npm run dev
```

Visit `/login` and sign in as one of the seeded dev users below.

---

## Seeded local/dev users

`supabase/seed.sql` creates four **local-development-only** accounts, all with password `DevPassword123!`. Never reuse these credentials against a real project.

| Email | Organization | Role |
| --- | --- | --- |
| `owner@bossa.test` | BOSSA Asado i Mar | organization_owner |
| `staff@bossa.test` | BOSSA Asado i Mar | staff |
| `owner@papai.test` | Papai Since 1933 | organization_owner |
| `outsider@example.test` | *(none)* | — used to exercise the "no active membership" permission-state path |

---

## Everyday commands

```bash
npm run supabase:start     # boot the local stack
npm run supabase:stop      # stop it
npm run supabase:reset     # drop, recreate, re-migrate, and re-seed the local database
npm run supabase:test      # supabase test db — pgTAP cross-tenant security suite
npm run supabase:types     # regenerate lib/supabase/database.types.ts from the local schema
npm run test:integration   # vitest against the running local instance (needs SUPABASE_URL / SUPABASE_ANON_KEY — `supabase status -o env` prints them)
```

## Adding a migration

```bash
supabase migration new descriptive_name
```

Edit the generated `supabase/migrations/<timestamp>_descriptive_name.sql`, then `npm run supabase:reset` to apply it from a clean database (the only way local migrations are validated — there's no "just this one file" apply path for local dev). Keep migrations forward-only and idempotent (`create table if not exists`, `create or replace function`, `drop policy if exists` before `create policy`) so `db reset` always succeeds from empty.

After schema changes, regenerate types (`npm run supabase:types`) and commit the result — CI's `database` job will otherwise flag drift (informationally; see below).

## Why `database.types.ts` is hand-authored, and how that's checked

This PR's `lib/supabase/database.types.ts` was written by hand to exactly match the migrations, because the sandbox it was built in has no Docker and therefore couldn't run `supabase gen types typescript --local`. CI's `database` job regenerates the file from the real schema and re-runs `npm run typecheck` against the regenerated version — if the app doesn't compile, that's a hard failure. A textual diff against the committed file is also printed as a `::warning::` (not a failure), since the hand-authored file's doc comment will always differ from generator output even when the types themselves are equivalent. Once you have Docker, prefer just running `npm run supabase:types` normally — this whole hand-authoring situation is a one-time bootstrap artifact, not the intended steady state.

## Row-Level Security is the security boundary

Every tenant-owned table has RLS enabled *and forced*. Access is derived exclusively from `is_org_member()` / `has_permission()`, which read `auth.uid()` against `organization_memberships` / `membership_roles` — never from a route slug or a client-submitted UUID. See `docs/SECURITY_MODEL.md` for the full policy inventory and the reasoning behind each one.

## Rollback and recovery

- **Local dev**: `npm run supabase:reset` always gets you back to a known-good state (drops and rebuilds from migrations + seed). There is no data to lose locally that isn't reproducible from these files.
- **A broken migration on a real linked project**: write a new forward migration that undoes the mistake (e.g. `drop column`, restore a dropped policy) rather than editing history — Supabase's migration history table tracks what's already been applied, and rewriting an already-applied migration file will desync it from what's actually in the database. `supabase migration repair` exists for genuinely correcting the tracked history after a manual fix, but reach for a new forward migration first.
- **Audit trail**: `audit_logs` is append-only (no authenticated UPDATE/DELETE policy exists on it at all) by design, so it isn't part of normal rollback — it's meant to survive whatever else happens.

## Linking a real hosted project (not done in this PR)

This PR deliberately does not link, restore, or modify any real Supabase cloud project — doing so has cost and account implications outside an implementation PR's scope. When you're ready:

```bash
supabase link --project-ref <your-project-ref>
supabase db push          # applies local migrations to the linked project
```

Then set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` (server-only, from Project Settings → API) in your deployment environment. Never commit `SUPABASE_SECRET_KEY` or put it behind `NEXT_PUBLIC_`.

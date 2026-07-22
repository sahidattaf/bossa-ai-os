-- Phase 2: base table privileges for `authenticated`.
--
-- Row-Level Security policies restrict WHICH rows a role can see or change;
-- they do not by themselves grant the role permission to attempt the
-- operation at all. Postgres checks ordinary GRANTs first, and this
-- project's local Supabase Postgres instance does not pre-grant table
-- privileges to `authenticated` for tables created by later migrations —
-- without these, every query below fails with "permission denied for
-- table X" before RLS is ever evaluated (caught by the pgTAP suite against
-- a real database in CI, not assumed).
--
-- Least privilege: only the operations each table's RLS policies actually
-- allow for `authenticated` are granted here. `anon` is intentionally
-- granted nothing — every table requires authentication.

grant usage on schema public to authenticated;

grant select, update on public.profiles to authenticated;
grant select on public.platform_admins to authenticated;
grant select on public.organizations to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, update, delete on public.organization_memberships to authenticated;
grant select on public.roles to authenticated;
grant select on public.permissions to authenticated;
grant select on public.role_permissions to authenticated;
grant select, insert, update, delete on public.membership_roles to authenticated;
grant select, update on public.organization_branding to authenticated;
grant select, update on public.organization_settings to authenticated;
grant select on public.audit_logs to authenticated;

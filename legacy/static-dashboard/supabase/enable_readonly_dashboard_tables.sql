-- Allow the current static dashboard to read non-PII operating data.
-- PII/customer tables remain protected by default-deny policies.

create policy "dashboard_read_campaigns"
on public.campaigns
for select
to anon, authenticated
using (true);

create policy "dashboard_read_kpi_daily"
on public.kpi_daily
for select
to anon, authenticated
using (true);

create policy "dashboard_read_decision_log"
on public.decision_log
for select
to anon, authenticated
using (true);

create policy "dashboard_read_weekly_briefs"
on public.weekly_briefs
for select
to anon, authenticated
using (true);

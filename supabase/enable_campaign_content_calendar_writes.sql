-- BOSSA AI OS Campaign + Content Calendar write flow
-- Approved operators can write campaigns and content_items.

alter table public.content_items
  add column if not exists platform text,
  add column if not exists scheduled_date date,
  add column if not exists scheduled_time time,
  add column if not exists owner text,
  add column if not exists asset_url text,
  add column if not exists notes text;

create index if not exists idx_content_items_scheduled_date on public.content_items(scheduled_date);
create index if not exists idx_content_items_platform on public.content_items(platform);

drop trigger if exists set_campaigns_created_by on public.campaigns;
create trigger set_campaigns_created_by
before insert on public.campaigns
for each row execute function public.set_created_by_from_auth();

drop trigger if exists set_content_items_created_by on public.content_items;
create trigger set_content_items_created_by
before insert on public.content_items
for each row execute function public.set_created_by_from_auth();

drop policy if exists "operator_insert_campaigns" on public.campaigns;
create policy "operator_insert_campaigns"
on public.campaigns
for insert
to authenticated
with check (private.is_bossa_operator());

drop policy if exists "operator_update_campaigns" on public.campaigns;
create policy "operator_update_campaigns"
on public.campaigns
for update
to authenticated
using (private.is_bossa_operator())
with check (private.is_bossa_operator());

-- Content items are non-PII marketing assets, so dashboard/calendar can read them.
drop policy if exists "dashboard_read_content_items" on public.content_items;
create policy "dashboard_read_content_items"
on public.content_items
for select
to anon, authenticated
using (true);

drop policy if exists "operator_insert_content_items" on public.content_items;
create policy "operator_insert_content_items"
on public.content_items
for insert
to authenticated
with check (private.is_bossa_operator());

drop policy if exists "operator_update_content_items" on public.content_items;
create policy "operator_update_content_items"
on public.content_items
for update
to authenticated
using (private.is_bossa_operator())
with check (private.is_bossa_operator());

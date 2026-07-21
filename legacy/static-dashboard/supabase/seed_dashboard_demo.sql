-- Optional demo seed for the BOSSA AI OS live dashboard reader.
-- Non-PII rows only.

insert into public.campaigns (name, offer, platform, status, start_date, end_date, goal)
values
  ('Weekend Fire Box Push', 'Fire Box promo for locals, tourists, and hotel guests near Avila/Pietermaai', 'Instagram + WhatsApp', 'active', current_date, current_date + 7, 'Increase weekend orders and WhatsApp inquiries'),
  ('Rooftop Teaser', 'Coming-soon rooftop fire-grill and sea-view concept', 'Instagram Stories', 'draft', current_date, current_date + 14, 'Build pre-launch interest')
on conflict do nothing;

insert into public.kpi_daily (date, revenue, whatsapp_inquiries, bookings, orders, posts_published, reach, notes)
values
  (current_date, 0, 0, 0, 0, 0, 0, 'Initial BOSSA AI OS Supabase live dashboard row')
on conflict (date) do update set
  notes = excluded.notes,
  updated_at = now();

insert into public.decision_log (decision, reason, expected_result, status, owner, decision_date)
values
  ('Connect BOSSA dashboard to Supabase live data', 'Move from static demo data toward live operating intelligence', 'Dashboard can read campaigns, KPIs, weekly briefs, and decision log from Supabase', 'active', 'Coach Sahid', current_date),
  ('Keep customer PII tables blocked for browser access', 'Protect WhatsApp leads, bookings, and orders until authenticated flows are ready', 'No public exposure of sensitive customer data', 'active', 'BOSSA AI OS', current_date)
on conflict do nothing;

insert into public.weekly_briefs (week_start, week_end, summary, opportunities, risks, next_actions)
values
  (current_date, current_date + 6, 'Supabase live data layer is now connected to BOSSA AI OS. The next step is to feed real campaign and KPI rows into the dashboard.', 'Use campaigns and decisions as the first live operating signals.', 'Do not expose customer/PII tables before auth and policies are designed.', 'Test dashboard read flow, then build authenticated input forms.')
on conflict do nothing;

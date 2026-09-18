-- Issue #30 ACL hardening.
--
-- Supabase's local database role defaults can pre-grant broad privileges to
-- anon/authenticated. A later GRANT of a narrower privilege does not remove
-- those existing privileges, so explicitly revoke first and then re-grant
-- only the documented least-privilege surface.

-- AI tables: authenticated is read-only; anon gets no access.
revoke all on table public.ai_approvals from anon, authenticated;
grant select on table public.ai_approvals to authenticated;

revoke all on table public.ai_action_attempts from anon, authenticated;
grant select on table public.ai_action_attempts to authenticated;

-- Orders: authenticated may read/delete rows permitted by RLS, insert/update
-- only the documented non-derived columns. subtotal/total stay DB-controlled.
revoke all on table public.orders from anon, authenticated;

grant select, delete on table public.orders to authenticated;

grant insert (
  id, organization_id, location_id, lead_id, reservation_id, order_number,
  channel, fulfillment_type, customer_name, phone, discount_total, tax_total,
  delivery_fee, currency, requested_for, status, payment_status, notes,
  created_at, updated_at
) on table public.orders to authenticated;

grant update (
  location_id, lead_id, reservation_id, order_number, channel,
  fulfillment_type, customer_name, phone, discount_total, tax_total,
  delivery_fee, currency, requested_for, status, payment_status, notes
) on table public.orders to authenticated;

-- The production-only legacy cleanup function may already exist in some
-- environments. Harden it when present without creating or invoking it.
do $$
begin
  if to_regprocedure('public.perform_legacy_bossa_schema_cleanup(text,text)') is not null then
    revoke all on function public.perform_legacy_bossa_schema_cleanup(text, text)
      from public, anon, authenticated;
    grant execute on function public.perform_legacy_bossa_schema_cleanup(text, text)
      to service_role;
  end if;
end
$$;

-- The cleanup function is intentionally defined outside migrations during a
-- controlled production procedure. Ensure that when postgres creates that
-- future function, Supabase default privileges do not re-grant EXECUTE to
-- anon/authenticated before the standalone script applies its own hardening.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

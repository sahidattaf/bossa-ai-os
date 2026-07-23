-- Phase 4B: complete the same-location check in
-- validate_ai_source_entity_reference() (issue: the review found `lead` and
-- `order_item` never populated v_source_location_id at all, so a piece of
-- evidence or a signal could reference a real lead/order_item from a
-- *different location in the same organization* and the location-mismatch
-- branch would simply never fire for those two entity types — reservation,
-- order, and daily_kpi_snapshot were already checked correctly).
--
-- leads.location_id is a direct column. order_items has no location_id of
-- its own (Phase 3's schema) — its location is its parent order's, so this
-- resolves it via a join to public.orders. Organization validation and the
-- five-entity-type allow-list are unchanged.

create or replace function public.validate_ai_source_entity_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_entity_type text;
  v_source_entity_id uuid;
  v_organization_id uuid := new.organization_id;
  v_context_location_id uuid;
  v_source_location_id uuid;
  v_found boolean;
begin
  v_source_entity_type := to_jsonb(new) ->> 'source_entity_type';
  v_source_entity_id := nullif(to_jsonb(new) ->> 'source_entity_id', '')::uuid;

  if v_source_entity_type is null or v_source_entity_id is null then
    return new;
  end if;

  if tg_table_name = 'ai_recommendation_evidence' then
    select location_id into v_context_location_id
    from public.ai_recommendations
    where id = new.recommendation_id and organization_id = v_organization_id;
  else
    v_context_location_id := nullif(to_jsonb(new) ->> 'location_id', '')::uuid;
  end if;

  if v_source_entity_type = 'lead' then
    select location_id, true into v_source_location_id, v_found
    from public.leads where id = v_source_entity_id and organization_id = v_organization_id;
  elsif v_source_entity_type = 'reservation' then
    select location_id, true into v_source_location_id, v_found
    from public.reservations where id = v_source_entity_id and organization_id = v_organization_id;
  elsif v_source_entity_type = 'order' then
    select location_id, true into v_source_location_id, v_found
    from public.orders where id = v_source_entity_id and organization_id = v_organization_id;
  elsif v_source_entity_type = 'order_item' then
    select o.location_id, true into v_source_location_id, v_found
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.organization_id = oi.organization_id
    where oi.id = v_source_entity_id and oi.organization_id = v_organization_id;
  elsif v_source_entity_type = 'daily_kpi_snapshot' then
    select location_id, true into v_source_location_id, v_found
    from public.daily_kpi_snapshots where id = v_source_entity_id and organization_id = v_organization_id;
  else
    raise exception 'VALIDATION_FAILED: unsupported source_entity_type "%"', v_source_entity_type;
  end if;

  if v_found is not true then
    raise exception 'RELATED_ENTITY_MISMATCH: % source_entity_id % not found for organization %',
      v_source_entity_type, v_source_entity_id, v_organization_id;
  end if;

  if v_context_location_id is not null and v_source_location_id is not null and v_context_location_id <> v_source_location_id then
    raise exception 'RELATED_ENTITY_MISMATCH: % source_entity_id % belongs to a different location',
      v_source_entity_type, v_source_entity_id;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_ai_source_entity_reference() from public;

comment on function public.validate_ai_source_entity_reference() is
  'Generic BEFORE INSERT/UPDATE trigger for ai_signals and ai_recommendation_evidence. Validates the polymorphic source_entity_type/source_entity_id reference exists, matches organization_id, and (for all five supported types, including lead via its own location_id and order_item via its parent order''s location_id) matches location when the referencing row has a location context.';

-- Phase 4A: polymorphic source-entity validation (issue #18 decision #6).
-- ai_signals.source_entity_id / ai_recommendation_evidence.source_entity_id
-- can reference a lead, reservation, order, order_item, or daily_kpi_snapshot
-- — no single Postgres FK can express a reference that targets a different
-- table depending on a sibling column's value. This generic trigger is the
-- schema-level substitute: it verifies the referenced row actually exists,
-- belongs to the same organization, and (for entity types that carry their
-- own location_id) the same location as the evidence's parent recommendation
-- or the signal's own location_id.

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
    select true into v_found from public.leads where id = v_source_entity_id and organization_id = v_organization_id;
  elsif v_source_entity_type = 'reservation' then
    select location_id, true into v_source_location_id, v_found
    from public.reservations where id = v_source_entity_id and organization_id = v_organization_id;
  elsif v_source_entity_type = 'order' then
    select location_id, true into v_source_location_id, v_found
    from public.orders where id = v_source_entity_id and organization_id = v_organization_id;
  elsif v_source_entity_type = 'order_item' then
    select true into v_found from public.order_items where id = v_source_entity_id and organization_id = v_organization_id;
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
  'Generic BEFORE INSERT/UPDATE trigger for ai_signals and ai_recommendation_evidence. Validates the polymorphic source_entity_type/source_entity_id reference exists, matches organization_id, and (where the target type carries one) matches location.';

drop trigger if exists validate_ai_signal_source_entity on public.ai_signals;
create trigger validate_ai_signal_source_entity
before insert or update of source_entity_type, source_entity_id on public.ai_signals
for each row execute function public.validate_ai_source_entity_reference();

drop trigger if exists validate_ai_evidence_source_entity on public.ai_recommendation_evidence;
create trigger validate_ai_evidence_source_entity
before insert or update of source_entity_type, source_entity_id on public.ai_recommendation_evidence
for each row execute function public.validate_ai_source_entity_reference();

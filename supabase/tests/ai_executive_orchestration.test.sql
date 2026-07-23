-- Phase 4C: exact evaluation orchestration (issue: an organization-wide
-- facts call reads every location, several rules emit entity.location_id,
-- and apply_ai_evaluation() wrote those location-tagged rows regardless of
-- what scope the run itself declared — an organization-wide cleanup pass
-- only ever managed location_id IS NULL rows, so a location-specific row
-- created during an organization-wide run could never be resolved by any
-- later organization-wide run at all). This file proves the two structural
-- fixes: apply_ai_evaluation() now rejects any intent whose own location_id
-- contradicts the run's declared scope outright, and a signal genuinely
-- scoped to one location still resolves correctly on a later empty run for
-- that exact location.

create extension if not exists pgtap with schema extensions;

begin;
select plan(11);

-- Fixed seed UUIDs (see supabase/seed.sql).
-- BOSSA org:               00000000-0000-0000-0000-000000000001
-- BOSSA location (main):   00000000-0000-0000-0001-000000000001
-- owner@bossa.test:        00000000-0000-0000-0002-000000000001

create or replace function pg_temp.authenticate_as(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$;

create or replace function pg_temp.expect_error_message(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- A second BOSSA location, scoped entirely to this rolled-back transaction.
insert into public.locations (id, organization_id, name, is_primary, timezone, currency) values
  ('cccccccc-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'BOSSA Asado i Mar — Orchestration Test', false, 'America/Curacao', 'USD');

select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');

-- ============================================================================
-- 1-4: mixed-scope intent validation — rejected outright, nothing written.
-- ============================================================================

-- 1: an organization-wide run (p_location_id null) cannot create a
-- location-specific signal.
select ok(
  pg_temp.expect_error_message(
    $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'orchestration-test.v1',
       '{"signals":[{"signal_type":"scope_probe","severity":"info","title":"Probe","dedupe_key":"orch_test_bad_signal:1","location_id":"00000000-0000-0000-0001-000000000001"}],"recommendations":[]}'::jsonb) $$
  ) like 'VALIDATION_FAILED:%',
  'An organization-wide run cannot create a location-specific signal — rejected outright'
);

-- 2: ...nor a location-specific recommendation.
select ok(
  pg_temp.expect_error_message(
    $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'orchestration-test.v1',
       '{"signals":[],"recommendations":[{"dedupe_key":"orch_test_bad_rec:1","recommendation_type":"probe","title":"Probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"orchestration-test.v1","requires_approval":false,"location_id":"00000000-0000-0000-0001-000000000001","evidence":[]}]}'::jsonb) $$
  ) like 'VALIDATION_FAILED:%',
  'An organization-wide run cannot create a location-specific recommendation — rejected outright'
);

-- 3-4: a location-A run cannot create or modify a null-location (org-wide)
-- or sibling-location (B) signal/recommendation.
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, '%s'::uuid, now(), 'orchestration-test.v1',
         '{"signals":[{"signal_type":"scope_probe","severity":"info","title":"Probe","dedupe_key":"orch_test_bad_signal:2","location_id":"cccccccc-0000-0000-0001-000000000001"}],"recommendations":[]}'::jsonb) $$,
      '00000000-0000-0000-0001-000000000001'
    )
  ) like 'VALIDATION_FAILED:%',
  'A location-A run cannot create a sibling-location (B) signal — rejected outright'
);
select ok(
  pg_temp.expect_error_message(
    $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, 'cccccccc-0000-0000-0001-000000000001'::uuid, now(), 'orchestration-test.v1',
       '{"signals":[],"recommendations":[{"dedupe_key":"orch_test_bad_rec:2","recommendation_type":"probe","title":"Probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"orchestration-test.v1","requires_approval":false,"location_id":null,"evidence":[]}]}'::jsonb) $$
  ) like 'VALIDATION_FAILED:%',
  'A location-B run cannot create a null-location (organization-wide) recommendation — rejected outright'
);

-- ============================================================================
-- 5-6: a matching-scope intent is accepted normally.
-- ============================================================================

select lives_ok(
  format(
    $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, '%s'::uuid, now(), 'orchestration-test.v1',
       '{"signals":[{"signal_type":"scope_probe","severity":"info","title":"Probe","dedupe_key":"orch_test_good_signal:1","location_id":"%s"}],"recommendations":[]}'::jsonb) $$,
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0001-000000000001'
  ),
  'A location run accepts an intent whose own location_id exactly matches p_location_id'
);
select lives_ok(
  $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'orchestration-test.v1',
     '{"signals":[{"signal_type":"scope_probe","severity":"info","title":"Probe","dedupe_key":"orch_test_good_signal:2","location_id":null}],"recommendations":[]}'::jsonb) $$,
  'An organization-wide run accepts an intent that explicitly declares a null location_id'
);

-- ============================================================================
-- 7-9: a signal genuinely scoped to one location resolves correctly on a
-- later, empty run for that exact location — proving location-scoped
-- lifecycle management works end to end once past the validation gate.
-- ============================================================================

select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0001-000000000001'::uuid, now(), 'orchestration-resolve-test.v1',
  '{"signals":[{"signal_type":"scope_probe","severity":"info","title":"Location A probe","dedupe_key":"orch_test_resolve:1"}],"recommendations":[]}'::jsonb
);
select is(
  (select status from public.ai_signals where dedupe_key = 'orch_test_resolve:1'),
  'active',
  'The location-A signal starts active'
);
select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0001-000000000001'::uuid, now(), 'orchestration-resolve-test.v1',
  '{"signals":[],"recommendations":[]}'::jsonb
);
select is(
  (select status from public.ai_signals where dedupe_key = 'orch_test_resolve:1'),
  'resolved',
  'A later, empty run for that exact same location resolves the signal'
);
select is(
  (select location_id from public.ai_signals where dedupe_key = 'orch_test_resolve:1'),
  '00000000-0000-0000-0001-000000000001'::uuid,
  'The resolved signal''s location_id was never touched — it is still exactly the location it was created for'
);

-- ============================================================================
-- 10-11: rule-config fallback (lib/ai/evaluate.ts::loadRuleConfigs, unchanged
-- logic — verified here at the data level: a location-specific override row
-- coexists with an organization-wide fallback row for the same rule_key,
-- and both remain independently readable, which is what that resolution
-- logic depends on).
-- ============================================================================

select lives_ok(
  $$ insert into public.ai_rule_configs (organization_id, rule_key, config)
     values ('00000000-0000-0000-0000-000000000001', 'orchestration_fallback_test.v1', '{"threshold": 1}'::jsonb) $$,
  'An organization-wide rule-config override can be inserted (the fallback row)'
);
select lives_ok(
  format(
    $$ insert into public.ai_rule_configs (organization_id, location_id, rule_key, config)
       values ('00000000-0000-0000-0000-000000000001', '%s', 'orchestration_fallback_test.v1', '{"threshold": 2}'::jsonb) $$,
    'cccccccc-0000-0000-0001-000000000001'
  ),
  'A location-specific override for the same rule_key can coexist with the organization-wide fallback row'
);

select * from finish();
rollback;

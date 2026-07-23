-- Phase 4B AI Executive hardening suite (post-merge principal-engineer
-- security review of PR #19). Complements ai_executive_security.test.sql
-- (unchanged assertion count, only adapted for the record_ai_action_attempt/
-- record_ai_outcome execution_token parameter): same-location evidence
-- validation (lead + order_item, both previously unchecked), exact
-- organization-wide-vs-location-specific evaluation scope, executing-
-- recommendation immutability during re-evaluation, the duplicate-success
-- database constraint, and crash/abandoned-execution recovery.
--
-- True concurrent races (two overlapping network calls) cannot be expressed
-- in pgTAP — everything here runs sequentially in one session/transaction.
-- What pgTAP *can* prove is that the compare-and-swap guards behave
-- correctly when exercised in sequence (e.g. "decide twice, the second
-- fails"), which is a necessary (though not sufficient on its own) condition
-- for correctness under real concurrency. The actual concurrent-race proof —
-- two simultaneous network calls, only one winning — lives in
-- tests/integration/ai-executive.test.ts against a real Postgres instance.

create extension if not exists pgtap with schema extensions;

begin;
select plan(27);

-- Fixed seed UUIDs (see supabase/seed.sql).
-- BOSSA org:               00000000-0000-0000-0000-000000000001
-- BOSSA location (main):   00000000-0000-0000-0001-000000000001
-- owner@bossa.test:        00000000-0000-0000-0002-000000000001
-- staff@bossa.test:        00000000-0000-0000-0002-000000000002
-- BOSSA lead 1 (Maria):    00000000-0000-0000-0004-000000000001 (at the main location)

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

-- Test-only fixtures, scoped entirely to this rolled-back transaction — a
-- second BOSSA location, plus a lead/order/order_item at each of the two
-- locations, needed for the location-validation and exact-scope sections
-- below. Not added to supabase/seed.sql since nothing outside this file
-- needs them.
insert into public.locations (id, organization_id, name, is_primary, timezone, currency) values
  ('aaaaaaaa-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'BOSSA Asado i Mar — Secondary', false, 'America/Curacao', 'USD');

insert into public.leads (id, organization_id, location_id, lead_type, source, contact_name, phone, status) values
  ('aaaaaaaa-0000-0000-0004-000000000001', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0001-000000000001', 'general', 'phone', 'Test Lead (Location B)', '+5990000001', 'new');

insert into public.orders (id, organization_id, location_id, order_number, channel, fulfillment_type, customer_name) values
  ('aaaaaaaa-0000-0000-0006-000000000001', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0001-000000000001', 'TEST-LOC-B-1', 'dine_in', 'dine_in', 'Test Customer B'),
  ('aaaaaaaa-0000-0000-0006-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0001-000000000001', 'TEST-LOC-A-1', 'dine_in', 'dine_in', 'Test Customer A');

insert into public.order_items (id, organization_id, order_id, item_name, quantity, unit_price) values
  ('aaaaaaaa-0000-0000-0007-000000000001', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0006-000000000001', 'Test Item (Location B)', 1, 10.00),
  ('aaaaaaaa-0000-0000-0007-000000000002', '00000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0006-000000000002', 'Test Item (Location A)', 1, 10.00);

select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');

-- ============================================================================
-- 1-5: same-location source-entity validation (issue: `lead` and
-- `order_item` never populated their source location at all, so the
-- location-mismatch branch could never fire for either type).
-- ============================================================================

-- 1: cross-location lead evidence rejected — recommendation anchored at the
-- main location, evidence references a lead that lives at the secondary one.
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, '%s'::uuid, now(), 'location-test.v1',
         '{"signals":[],"recommendations":[{"dedupe_key":"loc_test_cross_lead:1","recommendation_type":"probe","title":"Probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"location-test.v1","requires_approval":false,
           "evidence":[{"metric_name":"m","observed_value":{},"calculation_definition":"d","source_entity_type":"lead","source_entity_id":"%s"}]}]}'::jsonb) $$,
      '00000000-0000-0000-0001-000000000001',
      'aaaaaaaa-0000-0000-0004-000000000001'
    )
  ) like 'RELATED_ENTITY_MISMATCH:%',
  'Evidence referencing a lead from a different location (same organization) is rejected'
);

-- 2: cross-location order_item evidence rejected — order_item's location is
-- resolved via its parent order, which lives at the secondary location.
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, '%s'::uuid, now(), 'location-test.v1',
         '{"signals":[],"recommendations":[{"dedupe_key":"loc_test_cross_item:1","recommendation_type":"probe","title":"Probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"location-test.v1","requires_approval":false,
           "evidence":[{"metric_name":"m","observed_value":{},"calculation_definition":"d","source_entity_type":"order_item","source_entity_id":"%s"}]}]}'::jsonb) $$,
      '00000000-0000-0000-0001-000000000001',
      'aaaaaaaa-0000-0000-0007-000000000001'
    )
  ) like 'RELATED_ENTITY_MISMATCH:%',
  'Evidence referencing an order_item from a different location (via its parent order) is rejected'
);

-- 3: same-location lead reference accepted.
select lives_ok(
  format(
    $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, '%s'::uuid, now(), 'location-test.v1',
       '{"signals":[],"recommendations":[{"dedupe_key":"loc_test_same_lead:1","recommendation_type":"probe","title":"Probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"location-test.v1","requires_approval":false,
         "evidence":[{"metric_name":"m","observed_value":{},"calculation_definition":"d","source_entity_type":"lead","source_entity_id":"%s"}]}]}'::jsonb) $$,
    '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0004-000000000001'
  ),
  'Evidence referencing a lead from the same location as its recommendation is accepted'
);

-- 4: same-location order_item reference accepted.
select lives_ok(
  format(
    $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, '%s'::uuid, now(), 'location-test.v1',
       '{"signals":[],"recommendations":[{"dedupe_key":"loc_test_same_item:1","recommendation_type":"probe","title":"Probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"location-test.v1","requires_approval":false,
         "evidence":[{"metric_name":"m","observed_value":{},"calculation_definition":"d","source_entity_type":"order_item","source_entity_id":"%s"}]}]}'::jsonb) $$,
    '00000000-0000-0000-0001-000000000001',
    'aaaaaaaa-0000-0000-0007-000000000002'
  ),
  'Evidence referencing an order_item from the same location (via its parent order) is accepted'
);

-- 5: organization-wide recommendation semantics, explicitly tested — a
-- recommendation with no location_id at all has no location context to
-- mismatch against, so it may reference evidence from any real location.
select lives_ok(
  $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'location-test.v1',
     '{"signals":[],"recommendations":[{"dedupe_key":"loc_test_orgwide:1","recommendation_type":"probe","title":"Probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"location-test.v1","requires_approval":false,
       "evidence":[{"metric_name":"m","observed_value":{},"calculation_definition":"d","source_entity_type":"lead","source_entity_id":"aaaaaaaa-0000-0000-0004-000000000001"}]}]}'::jsonb) $$,
  'An organization-wide recommendation (location_id is null) may reference evidence from any location, by design'
);

-- ============================================================================
-- 6-11: exact evaluation scope (issue: stale-signal/obsolete-recommendation
-- predicates used "p_location_id is null or location_id = p_location_id or
-- location_id is null", which let a location-specific run also touch
-- organization-wide and even sibling-location rows).
-- ============================================================================

select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'scope-test.v1',
  '{"signals":[{"signal_type":"scope_probe","severity":"info","title":"Org-wide probe","dedupe_key":"scope_test_org:1"}],
    "recommendations":[{"dedupe_key":"scope_test_org_rec:1","recommendation_type":"probe","title":"Org probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"scope-test.v1","requires_approval":false,"evidence":[]}]}'::jsonb
);
select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0001-000000000001'::uuid, now(), 'scope-test.v1',
  '{"signals":[{"signal_type":"scope_probe","severity":"info","title":"Location A probe","dedupe_key":"scope_test_loc_a:1"}],
    "recommendations":[{"dedupe_key":"scope_test_loc_a_rec:1","recommendation_type":"probe","title":"Loc A probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"scope-test.v1","requires_approval":false,"evidence":[]}]}'::jsonb
);
select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0001-000000000001'::uuid, now(), 'scope-test.v1',
  '{"signals":[{"signal_type":"scope_probe","severity":"info","title":"Location B probe","dedupe_key":"scope_test_loc_b:1"}],
    "recommendations":[{"dedupe_key":"scope_test_loc_b_rec:1","recommendation_type":"probe","title":"Loc B probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"scope-test.v1","requires_approval":false,"evidence":[]}]}'::jsonb
);

-- Re-run location A ONLY, with an empty signal/recommendation set — only
-- location A's own signal/recommendation should resolve/expire.
select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0001-000000000001'::uuid, now(), 'scope-test.v1',
  '{"signals":[],"recommendations":[]}'::jsonb
);

select is(
  (select status from public.ai_signals where dedupe_key = 'scope_test_loc_a:1'),
  'resolved',
  'A location-specific run resolves that exact location''s own stale signal'
);
select is(
  (select status from public.ai_signals where dedupe_key = 'scope_test_org:1'),
  'active',
  'A location-specific run leaves an organization-wide signal completely unchanged'
);
select is(
  (select status from public.ai_signals where dedupe_key = 'scope_test_loc_b:1'),
  'active',
  'A location-specific run leaves a sibling location''s signal completely unchanged'
);
select is(
  (select status from public.ai_recommendations where dedupe_key = 'scope_test_loc_a_rec:1'),
  'expired',
  'A location-specific run expires that exact location''s own obsolete recommendation'
);
select is(
  (select status from public.ai_recommendations where dedupe_key = 'scope_test_org_rec:1'),
  'proposed',
  'A location-specific run leaves an organization-wide recommendation completely unchanged'
);
select is(
  (select status from public.ai_recommendations where dedupe_key = 'scope_test_loc_b_rec:1'),
  'proposed',
  'A location-specific run leaves a sibling location''s recommendation completely unchanged'
);

-- ============================================================================
-- 12-19: executing-recommendation immutability (issue: apply_ai_evaluation's
-- upsert could overwrite an 'executing' row's payload/title/evidence out
-- from under an in-flight execution). Chosen behavior: park the changed
-- intent as a separate `<dedupe_key>:pending-reevaluation` recommendation
-- instead (documented option B — see docs/AI_EXECUTIVE_ARCHITECTURE.md).
-- ============================================================================

select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'immutability-test.v1',
  '{"signals":[],"recommendations":[{"dedupe_key":"immutable_test:1","recommendation_type":"probe","title":"Original title","executive_summary":"Original summary","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/original"},"rule_id":"immutability-test.v1","requires_approval":true,"evidence":[{"metric_name":"m","observed_value":{"v":1},"calculation_definition":"d"}]}]}'::jsonb
);

select lives_ok(
  format(
    $$ select public.approve_ai_recommendation((select id from public.ai_approvals where recommendation_id = (select id from public.ai_recommendations where dedupe_key = 'immutable_test:1')), 1) $$
  ),
  'Immutability test fixture: the recommendation approves cleanly'
);
select lives_ok(
  format(
    $$ select public.begin_ai_recommendation_execution((select id from public.ai_recommendations where dedupe_key = 'immutable_test:1')) $$
  ),
  'Immutability test fixture: execution begins cleanly, capturing an execution_token'
);

create temporary table immutability_snapshot (payload_hash text not null);
insert into immutability_snapshot (payload_hash)
select payload_hash from public.ai_recommendations where dedupe_key = 'immutable_test:1';

-- Re-evaluate with a materially different payload for the SAME dedupe_key
-- while the original recommendation is still 'executing'.
select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'immutability-test.v1',
  '{"signals":[],"recommendations":[{"dedupe_key":"immutable_test:1","recommendation_type":"probe","title":"CHANGED title","executive_summary":"CHANGED summary","severity":"warning","recommended_action_type":"navigate","recommended_action_payload":{"route":"/changed"},"rule_id":"immutability-test.v1","requires_approval":true,"evidence":[{"metric_name":"m","observed_value":{"v":2},"calculation_definition":"d"}]}]}'::jsonb
);

select is(
  (select title from public.ai_recommendations where dedupe_key = 'immutable_test:1'),
  'Original title',
  'The executing recommendation''s title is byte-for-byte unchanged by a re-evaluation with a materially different intent'
);
select is(
  (select (recommended_action_payload ->> 'route') from public.ai_recommendations where dedupe_key = 'immutable_test:1'),
  '/original',
  'The executing recommendation''s payload is unchanged'
);
select is(
  (select payload_hash from public.ai_recommendations where dedupe_key = 'immutable_test:1'),
  (select payload_hash from immutability_snapshot),
  'The executing recommendation''s server-computed payload_hash is byte-for-byte unchanged'
);
select ok(
  (select status from public.ai_recommendations where dedupe_key = 'immutable_test:1:pending-reevaluation') = 'proposed',
  'The changed intent is not lost — it is parked as a separate, distinctly-keyed proposed recommendation'
);
select ok(
  (select (recommended_action_payload ->> 'route') from public.ai_recommendations where dedupe_key = 'immutable_test:1:pending-reevaluation') = '/changed',
  'The deferred recommendation carries the actual changed payload'
);

-- The active execution can still finalize normally, using its original,
-- untouched execution_token and payload_hash.
select lives_ok(
  format(
    $$ select public.record_ai_action_attempt('%s'::uuid, '%s'::uuid, 'succeeded', '{}'::jsonb) $$,
    (select id from public.ai_recommendations where dedupe_key = 'immutable_test:1'),
    (select execution_token from public.ai_recommendations where dedupe_key = 'immutable_test:1')
  ),
  'The in-flight execution finalizes successfully against its original, untouched execution_token — immutability did not disturb it'
);

-- ============================================================================
-- 20: duplicate-success database constraint (issue: concurrent execution
-- requests must produce only one domain mutation — this is the
-- database-level backstop beyond the execution_token compare-and-swap).
-- ============================================================================

-- ai_action_attempts has no authenticated INSERT grant at all (function-
-- mediated only) — this test targets the CONSTRAINT itself, independent of
-- record_ai_action_attempt()'s own guards, so it runs as the connection's
-- own RLS-bypassing role rather than as an authenticated tenant user
-- (which would just fail with 42501 before ever reaching the index).
reset role;
select throws_ok(
  format(
    $$ insert into public.ai_action_attempts (organization_id, recommendation_id, action_type, action_payload, payload_hash, result_status)
       select organization_id, id, recommended_action_type, recommended_action_payload, payload_hash, 'succeeded'
       from public.ai_recommendations where dedupe_key = 'immutable_test:1' $$
  ),
  '23505',
  null::text,
  'A second "succeeded" action attempt for the same recommendation_id/payload_hash violates the duplicate-success unique index'
);
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');

-- ============================================================================
-- 21-27: crash / abandoned-execution recovery.
-- ============================================================================

select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'recovery-test.v1',
  '{"signals":[],"recommendations":[{"dedupe_key":"recovery_test:1","recommendation_type":"probe","title":"Recovery probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"recovery-test.v1","requires_approval":true,"evidence":[]}]}'::jsonb
);
select public.approve_ai_recommendation(
  (select id from public.ai_approvals where recommendation_id = (select id from public.ai_recommendations where dedupe_key = 'recovery_test:1')),
  1
);
select public.begin_ai_recommendation_execution((select id from public.ai_recommendations where dedupe_key = 'recovery_test:1'));

-- 21: too early — the claim was just taken, nowhere near the lease.
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.recover_stalled_ai_execution('%s'::uuid) $$,
      (select id from public.ai_recommendations where dedupe_key = 'recovery_test:1')
    )
  ) like 'CONFLICT:%',
  'Recovery attempted before the execution lease has elapsed is rejected'
);

-- Simulate the lease elapsing: bypass RLS/grants as the connection's own
-- (superuser) role to backdate executing_at directly — the only way to
-- deterministically test a time-based lease without a real 15-minute wait.
reset role;
update public.ai_recommendations
set executing_at = now() - interval '20 minutes'
where dedupe_key = 'recovery_test:1';

-- 22: an ordinary staff member (no ai.recommendations.manage) cannot recover.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000002');
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.recover_stalled_ai_execution('%s'::uuid) $$,
      (select id from public.ai_recommendations where dedupe_key = 'recovery_test:1')
    )
  ) like 'PERMISSION_DENIED:%',
  'A normal user (no ai.recommendations.manage) cannot recover a stalled execution'
);

-- 23: an authorized organization_owner recovers the now-stale execution.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select lives_ok(
  format(
    $$ select public.recover_stalled_ai_execution('%s'::uuid) $$,
    (select id from public.ai_recommendations where dedupe_key = 'recovery_test:1')
  ),
  'An authorized organization_owner can recover an execution past its lease'
);
select is(
  (select status from public.ai_recommendations where dedupe_key = 'recovery_test:1'),
  'failed',
  'A recovered recommendation lands in failed — a legal, existing retry-starting status'
);

-- 24: the old, now-invalidated token cannot finalize anything.
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.record_ai_action_attempt('%s'::uuid, '%s'::uuid, 'succeeded', '{}'::jsonb) $$,
      (select id from public.ai_recommendations where dedupe_key = 'recovery_test:1'),
      gen_random_uuid()
    )
  ) is not null,
  'The stale execution_token from before recovery cannot finalize an action attempt'
);

-- 25-27: a fresh claim after recovery gets a new token and can execute once.
select lives_ok(
  format(
    $$ select public.begin_ai_recommendation_execution('%s'::uuid) $$,
    (select id from public.ai_recommendations where dedupe_key = 'recovery_test:1')
  ),
  'A fresh execution claim succeeds after recovery (failed -> executing is a legal retry)'
);
select lives_ok(
  format(
    $$ select public.record_ai_action_attempt('%s'::uuid, '%s'::uuid, 'succeeded', '{}'::jsonb) $$,
    (select id from public.ai_recommendations where dedupe_key = 'recovery_test:1'),
    (select execution_token from public.ai_recommendations where dedupe_key = 'recovery_test:1')
  ),
  'The new execution_token issued after recovery finalizes successfully'
);

select * from finish();
rollback;

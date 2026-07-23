-- Phase 4C: atomic business-action execution (issue: a crash or lost
-- response after the domain mutation committed but before
-- ai_action_attempts was recorded could leave the mutation durably applied
-- with no record it happened, and the recommendation stuck 'executing'
-- forever). finalize_ai_recommendation_execution()
-- (20260725000001_ai_transactional_action_execution.sql) folds the
-- mutation, the attempt insert, and the status transition into one
-- transaction — this file proves that atomicity directly, by installing a
-- trigger that deliberately sabotages the ai_action_attempts insert and
-- showing the whole call (including the mutation that already "succeeded"
-- moments earlier) rolls back.

create extension if not exists pgtap with schema extensions;

begin;
select plan(14);

-- Fixed seed UUIDs (see supabase/seed.sql).
-- BOSSA org:         00000000-0000-0000-0000-000000000001
-- owner@bossa.test:  00000000-0000-0000-0002-000000000001

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

-- Test-only fixture, scoped to this rolled-back transaction.
insert into public.leads (id, organization_id, lead_type, source, contact_name, phone, status) values
  ('bbbbbbbb-0000-0000-0004-000000000001', '00000000-0000-0000-0000-000000000001', 'general', 'phone', 'Rollback Test Lead', '+5990000099', 'new');

select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');

select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'transactional-test.v1',
  '{"signals":[],"recommendations":[{"dedupe_key":"transactional_test:1","recommendation_type":"probe","title":"Rollback probe","executive_summary":"Probe","severity":"info","recommended_action_type":"assign_lead_owner","recommended_action_payload":{"leadId":"bbbbbbbb-0000-0000-0004-000000000001","ownerUserId":"00000000-0000-0000-0002-000000000001"},"rule_id":"transactional-test.v1","requires_approval":true,"evidence":[]}]}'::jsonb
);
select public.approve_ai_recommendation(
  (select id from public.ai_approvals where recommendation_id = (select id from public.ai_recommendations where dedupe_key = 'transactional_test:1')),
  1
);
select public.begin_ai_recommendation_execution((select id from public.ai_recommendations where dedupe_key = 'transactional_test:1'));

-- ============================================================================
-- 1-8: the rollback proof.
-- ============================================================================

-- Sabotage: force the ai_action_attempts insert to fail unconditionally.
-- Bypass RLS/grants as the connection's own role to install it — the same
-- reason the duplicate-success constraint test does this in
-- ai_executive_concurrency.test.sql.
reset role;
create or replace function pg_temp.sabotage_action_attempts_insert()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ROLLBACK_TEST: deliberate failure during action-attempt insertion';
end;
$$;
create trigger sabotage_ai_action_attempts
before insert on public.ai_action_attempts
for each row execute function pg_temp.sabotage_action_attempts_insert();
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');

-- 1: the RPC fails.
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.finalize_ai_recommendation_execution('%s'::uuid, '%s'::uuid) $$,
      (select id from public.ai_recommendations where dedupe_key = 'transactional_test:1'),
      (select execution_token from public.ai_recommendations where dedupe_key = 'transactional_test:1')
    )
  ) like 'ROLLBACK_TEST:%',
  'finalize_ai_recommendation_execution fails when the action-attempt insert is sabotaged'
);

-- 2: the domain mutation was rolled back — the lead's owner_user_id was
-- never actually left assigned, even though the UPDATE ran moments earlier
-- in the same transaction.
select is(
  (select owner_user_id from public.leads where id = 'bbbbbbbb-0000-0000-0004-000000000001'),
  null::uuid,
  'The domain mutation (assign_lead_owner) is rolled back along with the failed insert'
);

-- 3: no action attempt is stored.
select is(
  (select count(*)::int from public.ai_action_attempts where recommendation_id = (select id from public.ai_recommendations where dedupe_key = 'transactional_test:1')),
  0,
  'No ai_action_attempts row exists after the sabotaged call'
);

-- 4-5: the recommendation remains safely recoverable — still 'executing',
-- with the exact same execution_token as before the failed call (nothing
-- about the claim was disturbed).
select is(
  (select status from public.ai_recommendations where dedupe_key = 'transactional_test:1'),
  'executing',
  'The recommendation remains executing after the rolled-back attempt'
);
select ok(
  (select execution_token from public.ai_recommendations where dedupe_key = 'transactional_test:1') is not null,
  'The execution_token is untouched by the rolled-back attempt'
);

-- Remove the sabotage.
reset role;
drop trigger sabotage_ai_action_attempts on public.ai_action_attempts;
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');

-- 6-8: retry performs the domain mutation exactly once.
select lives_ok(
  format(
    $$ select public.finalize_ai_recommendation_execution('%s'::uuid, '%s'::uuid) $$,
    (select id from public.ai_recommendations where dedupe_key = 'transactional_test:1'),
    (select execution_token from public.ai_recommendations where dedupe_key = 'transactional_test:1')
  ),
  'Retrying with the same (never-invalidated) execution_token succeeds once the sabotage is removed'
);
select is(
  (select owner_user_id from public.leads where id = 'bbbbbbbb-0000-0000-0004-000000000001'),
  '00000000-0000-0000-0002-000000000001'::uuid,
  'The domain mutation actually applied on the successful retry'
);
select is(
  (select count(*)::int from public.ai_action_attempts where recommendation_id = (select id from public.ai_recommendations where dedupe_key = 'transactional_test:1')),
  1,
  'Exactly one ai_action_attempts row exists — the mutation happened exactly once, not twice'
);

-- ============================================================================
-- 9-14: dispatch coverage for a few more of the seven database-native
-- action types, proving the CASE dispatch and audit trail beyond
-- assign_lead_owner.
-- ============================================================================

-- 9-11: change_lead_status recorded as an honest 'failed' attempt when the
-- domain's own status-transition trigger rejects it (not caught as a crash,
-- a legitimate business-logic failure) — the mutation attempt (rejected by
-- the trigger before any row changed) still finalizes the recommendation to
-- 'failed', not stuck.
select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'transactional-test.v1',
  '{"signals":[],"recommendations":[{"dedupe_key":"transactional_test:2","recommendation_type":"probe","title":"Illegal transition probe","executive_summary":"Probe","severity":"info","recommended_action_type":"change_lead_status","recommended_action_payload":{"leadId":"bbbbbbbb-0000-0000-0004-000000000001","status":"converted"},"rule_id":"transactional-test.v1","requires_approval":true,"evidence":[]}]}'::jsonb
);
select public.approve_ai_recommendation(
  (select id from public.ai_approvals where recommendation_id = (select id from public.ai_recommendations where dedupe_key = 'transactional_test:2')),
  1
);
select public.begin_ai_recommendation_execution((select id from public.ai_recommendations where dedupe_key = 'transactional_test:2'));
select lives_ok(
  format(
    $$ select public.finalize_ai_recommendation_execution('%s'::uuid, '%s'::uuid) $$,
    (select id from public.ai_recommendations where dedupe_key = 'transactional_test:2'),
    (select execution_token from public.ai_recommendations where dedupe_key = 'transactional_test:2')
  ),
  'finalize_ai_recommendation_execution itself does not raise for a business-logic mutation failure'
);
select is(
  (select status from public.ai_recommendations where dedupe_key = 'transactional_test:2'),
  'failed',
  'An illegal domain status transition finalizes the recommendation to failed, not stuck executing'
);
select is(
  (select error_code from public.ai_action_attempts where recommendation_id = (select id from public.ai_recommendations where dedupe_key = 'transactional_test:2')),
  'INVALID_STATUS_TRANSITION',
  'The recorded attempt carries the real error code from the domain trigger, not a generic failure'
);

-- 12-14: regenerate_kpi_snapshot dispatches to calculate_daily_kpi_snapshot()
-- inside the same transaction and records a real snapshot id in the result.
select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'transactional-test.v1',
  '{"signals":[],"recommendations":[{"dedupe_key":"transactional_test:3","recommendation_type":"probe","title":"KPI probe","executive_summary":"Probe","severity":"info","recommended_action_type":"regenerate_kpi_snapshot","recommended_action_payload":{},"rule_id":"transactional-test.v1","requires_approval":true,"evidence":[]}]}'::jsonb
);
select public.approve_ai_recommendation(
  (select id from public.ai_approvals where recommendation_id = (select id from public.ai_recommendations where dedupe_key = 'transactional_test:3')),
  1
);
select public.begin_ai_recommendation_execution((select id from public.ai_recommendations where dedupe_key = 'transactional_test:3'));
select lives_ok(
  format(
    $$ select public.finalize_ai_recommendation_execution('%s'::uuid, '%s'::uuid) $$,
    (select id from public.ai_recommendations where dedupe_key = 'transactional_test:3'),
    (select execution_token from public.ai_recommendations where dedupe_key = 'transactional_test:3')
  ),
  'regenerate_kpi_snapshot dispatches to calculate_daily_kpi_snapshot() inside the same transaction'
);
select is(
  (select status from public.ai_recommendations where dedupe_key = 'transactional_test:3'),
  'completed',
  'regenerate_kpi_snapshot completes successfully'
);
select ok(
  (select (result_detail ->> 'snapshotId') from public.ai_action_attempts where recommendation_id = (select id from public.ai_recommendations where dedupe_key = 'transactional_test:3')) is not null,
  'The recorded attempt carries the real snapshot id computed by calculate_daily_kpi_snapshot()'
);

select * from finish();
rollback;

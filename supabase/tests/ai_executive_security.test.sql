-- Phase 4A AI Executive security suite (issue #18 "Tests / Database / pgTAP").
-- Complements rls_cross_tenant.test.sql (Phase 2) and operational_security.test.sql
-- (Phase 3): cross-tenant isolation on all 7 new tables, permission-scoped
-- visibility (ai.executive.read, finance.read evidence redaction,
-- ai.actions.approve, ai.recommendations.manage), the full function-mediated
-- approval → execution → outcome pipeline, payload-hash tamper detection,
-- retry-safety, append-only action history, evaluation idempotency, and the
-- polymorphic evidence source-entity validation trigger.
--
-- Run via `supabase test db` against the database seeded by seed.sql — the
-- BOSSA/Papai AI fixtures there are pinned to the same 2026-07-20 anchor as
-- every other Phase 3/4 fixture.

create extension if not exists pgtap with schema extensions;

begin;
select plan(40);

-- Fixed seed UUIDs (see supabase/seed.sql and Phase 3's fixture comments).
-- BOSSA org:              00000000-0000-0000-0000-000000000001
-- Papai org:              00000000-0000-0000-0000-000000000002
-- owner@bossa.test:       00000000-0000-0000-0002-000000000001
-- staff@bossa.test:       00000000-0000-0000-0002-000000000002
-- owner@papai.test:       00000000-0000-0000-0002-000000000003
-- outsider@example.test:  00000000-0000-0000-0002-000000000004
-- BOSSA lead 1 (Maria):   00000000-0000-0000-0004-000000000001
-- Papai lead 1 (Ronnie):  00000000-0000-0000-0004-000000000004

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

-- Captured now, before any authenticate_as() switches the session role away
-- from this connection's default (RLS-bypassing) role — ai_approvals/
-- ai_recommendations rows are gen_random_uuid()'d by apply_ai_evaluation(),
-- not fixed literals like Phase 3's seeded leads/orders, so later
-- cross-tenant assertions need a way to reference "BOSSA's row" without a
-- live subquery that RLS would filter to zero rows once we're authenticated
-- as a user with no BOSSA membership at all.
create temporary table ai_test_ids (key text primary key, id uuid not null);
grant select, insert on ai_test_ids to authenticated;

insert into ai_test_ids (key, id)
select 'bossa_assign_lead_owner_approval', a.id
from public.ai_approvals a
join public.ai_recommendations r on r.id = a.recommendation_id
where a.organization_id = '00000000-0000-0000-0000-000000000001'
  and r.recommended_action_type = 'assign_lead_owner';

insert into ai_test_ids (key, id)
select 'bossa_navigate_recommendation', id
from public.ai_recommendations
where organization_id = '00000000-0000-0000-0000-000000000001'
  and recommended_action_type = 'navigate'
limit 1;

-- 1-3: permission-scoped visibility. BOSSA owner sees BOSSA's 2 seeded
-- recommendations; nothing from Papai; an outsider with no membership
-- anywhere sees none at all (has_permission requires membership first).
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select is(
  (select count(*)::int from public.ai_recommendations where organization_id = '00000000-0000-0000-0000-000000000001'),
  2,
  'BOSSA owner sees both seeded BOSSA recommendations'
);
select is(
  (select count(*)::int from public.ai_recommendations where organization_id = '00000000-0000-0000-0000-000000000002'),
  0,
  'BOSSA owner cannot see Papai recommendations'
);
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000004');
select is(
  (select count(*)::int from public.ai_recommendations where organization_id = '00000000-0000-0000-0000-000000000001'),
  0,
  'An outsider with no membership anywhere sees zero recommendations'
);

-- 4-6: finance-sensitive evidence redaction is at the evidence row level,
-- not the whole recommendation. BOSSA owner (finance.read) sees the
-- revenue_below_target recommendation's evidence; BOSSA staff (no
-- finance.read) sees zero evidence rows for it, but can still see the
-- recommendation itself.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select is(
  (select count(*)::int from public.ai_recommendation_evidence e
   join public.ai_recommendations r on r.id = e.recommendation_id
   where r.dedupe_key like 'revenue_below_target:%' and r.organization_id = '00000000-0000-0000-0000-000000000001'),
  1,
  'BOSSA owner (finance.read) sees the finance-sensitive evidence row'
);
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000002');
select is(
  (select count(*)::int from public.ai_recommendation_evidence e
   join public.ai_recommendations r on r.id = e.recommendation_id
   where r.dedupe_key like 'revenue_below_target:%' and r.organization_id = '00000000-0000-0000-0000-000000000001'),
  0,
  'BOSSA staff (no finance.read) sees zero rows for the same finance-sensitive evidence'
);
select ok(
  (select count(*)::int from public.ai_recommendations where organization_id = '00000000-0000-0000-0000-000000000001') = 2,
  'BOSSA staff can still see the recommendation shell itself (ai.executive.read), just not the redacted evidence'
);

-- 7-8: ai_rule_configs is the one directly-writable AI table (issue #18
-- decision #9's explicit exclusion) — gated by ai.recommendations.manage,
-- and still tenant-scoped like every other table.
select throws_ok(
  $$ insert into public.ai_rule_configs (organization_id, rule_key, config)
     values ('00000000-0000-0000-0000-000000000002', 'test_rule.v1', '{}'::jsonb) $$,
  '42501',
  null::text,
  'BOSSA staff cannot insert an ai_rule_configs row into Papai (cross-tenant, and lacks ai.recommendations.manage)'
);
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select lives_ok(
  $$ insert into public.ai_rule_configs (organization_id, rule_key, config)
     values ('00000000-0000-0000-0000-000000000001', 'test_rule.v1', '{"maxUnanswered": 5}'::jsonb) $$,
  'BOSSA owner (ai.recommendations.manage) can insert an ai_rule_configs row for BOSSA'
);

-- 9-12: six of the seven AI tables are function-mediated only — no direct
-- authenticated INSERT/UPDATE grant exists at all (issue #18 decisions #2, #9).
select throws_ok(
  $$ insert into public.ai_signals (organization_id, signal_type, severity, title, dedupe_key, rule_version)
     values ('00000000-0000-0000-0000-000000000001', 'test_signal', 'info', 'Test', 'test:1', 'test.v1') $$,
  '42501',
  null::text,
  'No direct authenticated INSERT into ai_signals (function-mediated only)'
);
select throws_ok(
  $$ insert into public.ai_recommendations (organization_id, recommendation_type, title, executive_summary, severity, recommended_action_type, recommended_action_payload, rule_id, rule_version, dedupe_key)
     values ('00000000-0000-0000-0000-000000000001', 'test', 'Test', 'Test', 'info', 'navigate', '{"route":"/x"}'::jsonb, 'test.v1', 'test.v1', 'test:1') $$,
  '42501',
  null::text,
  'No direct authenticated INSERT into ai_recommendations (function-mediated only)'
);
select throws_ok(
  format(
    $$ update public.ai_approvals set status = 'approved' where organization_id = '00000000-0000-0000-0000-000000000001' $$
  ),
  '42501',
  null::text,
  'No direct authenticated UPDATE on ai_approvals (function-mediated only — issue #18 decision #2)'
);
select throws_ok(
  $$ insert into public.ai_action_attempts (organization_id, recommendation_id, action_type, action_payload, payload_hash, result_status)
     values ('00000000-0000-0000-0000-000000000001', (select id from public.ai_recommendations where organization_id = '00000000-0000-0000-0000-000000000001' limit 1), 'navigate', '{}'::jsonb, 'x', 'succeeded') $$,
  '42501',
  null::text,
  'ai_action_attempts is append-only — no direct authenticated INSERT even from an organization_owner'
);

-- 13: apply_ai_evaluation requires ai.recommendations.manage.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000002');
select ok(
  pg_temp.expect_error_message(
    $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'test.v1', '{"signals":[],"recommendations":[]}'::jsonb) $$
  ) like 'PERMISSION_DENIED:%',
  'BOSSA staff (no ai.recommendations.manage) cannot call apply_ai_evaluation'
);

-- 14: apply_ai_evaluation is idempotent for a brand-new dedupe key — calling
-- it twice with identical intents leaves exactly one signal and one
-- recommendation row, not two.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, null, '2026-07-20T15:00:00Z'::timestamptz, 'idempotency-test.v1',
  '{"signals":[{"signal_type":"idempotency_probe","severity":"info","title":"Probe","dedupe_key":"idempotency_probe:1"}],
    "recommendations":[{"dedupe_key":"idempotency_probe_rec:1","recommendation_type":"probe","title":"Probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"idempotency-test.v1","requires_approval":false,"evidence":[]}]}'::jsonb
);
select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, null, '2026-07-20T15:00:00Z'::timestamptz, 'idempotency-test.v1',
  '{"signals":[{"signal_type":"idempotency_probe","severity":"info","title":"Probe","dedupe_key":"idempotency_probe:1"}],
    "recommendations":[{"dedupe_key":"idempotency_probe_rec:1","recommendation_type":"probe","title":"Probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"idempotency-test.v1","requires_approval":false,"evidence":[]}]}'::jsonb
);
select is(
  (select count(*)::int from public.ai_signals where dedupe_key = 'idempotency_probe:1'),
  1,
  'Calling apply_ai_evaluation twice with the same signal dedupe_key still leaves exactly one row'
);
select is(
  (select count(*)::int from public.ai_recommendations where dedupe_key = 'idempotency_probe_rec:1'),
  1,
  'Calling apply_ai_evaluation twice with the same recommendation dedupe_key still leaves exactly one row'
);

-- 15: re-running the same rule_version with an empty signals array resolves
-- the previously-active signal.
select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, null, '2026-07-20T16:00:00Z'::timestamptz, 'idempotency-test.v1',
  '{"signals":[],"recommendations":[]}'::jsonb
);
select is(
  (select status from public.ai_signals where dedupe_key = 'idempotency_probe:1'),
  'resolved',
  'A signal no longer present in the active set is resolved on the next evaluation run'
);

-- 16-17: cross-tenant / unsupported evidence source-entity references are
-- rejected before the row is ever written (issue #18 decision #6).
select ok(
  pg_temp.expect_error_message(
    $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'evidence-test.v1',
       '{"signals":[],"recommendations":[{"dedupe_key":"evidence_test:1","recommendation_type":"probe","title":"Probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"evidence-test.v1","requires_approval":false,
         "evidence":[{"metric_name":"m","observed_value":{},"calculation_definition":"d","source_entity_type":"lead","source_entity_id":"00000000-0000-0000-0004-000000000004"}]}]}'::jsonb) $$
  ) like 'RELATED_ENTITY_MISMATCH:%',
  'Evidence referencing a real lead from a *different* organization is rejected'
);
select ok(
  pg_temp.expect_error_message(
    $$ select public.apply_ai_evaluation('00000000-0000-0000-0000-000000000001'::uuid, null, now(), 'evidence-test.v1',
       '{"signals":[],"recommendations":[{"dedupe_key":"evidence_test:2","recommendation_type":"probe","title":"Probe","executive_summary":"Probe","severity":"info","recommended_action_type":"navigate","recommended_action_payload":{"route":"/x"},"rule_id":"evidence-test.v1","requires_approval":false,
         "evidence":[{"metric_name":"m","observed_value":{},"calculation_definition":"d","source_entity_type":"lead","source_entity_id":"ffffffff-ffff-ffff-ffff-ffffffffffff"}]}]}'::jsonb) $$
  ) like 'RELATED_ENTITY_MISMATCH:%',
  'Evidence referencing a source_entity_id that does not exist at all is rejected'
);

-- 18: the approval/recommendation status machines are readable by any
-- authenticated user (global rulebook, same pattern as Phase 3's).
select ok(
  (select count(*)::int from public.status_transitions where machine = 'recommendation_status') >= 9,
  'Any authenticated user can read the recommendation_status transition rulebook'
);

-- 19-20: approve_ai_recommendation requires ai.actions.approve, and its
-- permission/tenant checks are resolved from the approval row itself, not a
-- client-supplied organization_id — Papai's owner cannot approve BOSSA's
-- pending approval, and BOSSA staff (no ai.actions.approve) cannot either.
-- Neither attempt may succeed, so the approval is still 'pending' at
-- version 1 for the real approval in test 21.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000003');
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.approve_ai_recommendation('%s'::uuid, 1) $$,
      (select id from ai_test_ids where key = 'bossa_assign_lead_owner_approval')
    )
  ) like 'PERMISSION_DENIED:%',
  'Papai owner cannot approve BOSSA''s pending approval (resolved from the row, not a client-supplied org id)'
);
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000002');
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.approve_ai_recommendation('%s'::uuid, 1) $$,
      (select id from ai_test_ids where key = 'bossa_assign_lead_owner_approval')
    )
  ) like 'PERMISSION_DENIED:%',
  'BOSSA staff (no ai.actions.approve) cannot approve BOSSA''s own pending approval'
);

-- 21-22: the happy path — BOSSA owner approves, and a second decision
-- attempt with the original (now-stale) version is rejected: approval is
-- single-use.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select lives_ok(
  format(
    $$ select public.approve_ai_recommendation('%s'::uuid, 1) $$,
    (select id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001')
  ),
  'BOSSA owner (ai.actions.approve) can approve BOSSA''s pending approval'
);
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.approve_ai_recommendation('%s'::uuid, 1) $$,
      (select id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001')
    )
  ) like 'INVALID_STATUS_TRANSITION:%',
  'A second approval attempt on the same approval fails — it is no longer pending (single-use)'
);

-- 23: re-evaluating with a changed payload for the same (still-open, now
-- 'approved') recommendation updates its payload_hash and — since the prior
-- decision no longer matches what would be approved now — reopens both the
-- recommendation and its approval for a fresh decision (issue #18 decision
-- #5's tamper/staleness guarantee). Attempting to execute the reopened
-- recommendation is refused: it no longer has a current approval at all.
-- Uses its own rule_version (not 'seed-fixture.v1') — step 4's expiry pass
-- is scoped by rule_version specifically so a partial re-evaluation like
-- this one (only re-sending the assign_lead_owner recommendation) can't
-- accidentally expire BOSSA's other seed-fixture.v1 recommendation
-- (revenue_below_target), which this call's intents don't mention at all.
select public.apply_ai_evaluation(
  '00000000-0000-0000-0000-000000000001'::uuid, null, '2026-07-20T17:00:00Z'::timestamptz, 'reopen-test.v1',
  format(
    '{"signals":[],"recommendations":[{"dedupe_key":"assign_lead_owner:00000000-0000-0000-0004-000000000001","recommendation_type":"unanswered_lead_followup","title":"Follow up with Maria Fernandez","executive_summary":"Updated","severity":"warning","recommended_action_type":"assign_lead_owner","recommended_action_payload":{"leadId":"00000000-0000-0000-0004-000000000001","ownerUserId":"%s"},"rule_id":"unanswered_leads.v1","requires_approval":true,"evidence":[]}]}',
    '00000000-0000-0000-0002-000000000002'
  )::jsonb
);
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.begin_ai_recommendation_execution('%s'::uuid) $$,
      (select recommendation_id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001')
    )
  ) like 'CONFLICT:%',
  'Execution is refused when the recommendation payload changed after approval — the snapshotted payload_hash no longer matches'
);

-- 24-25: begin_ai_recommendation_execution requires ai.actions.approve at
-- execution time too (not just at approval time), and refuses when there is
-- no current approval at all.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000002');
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.begin_ai_recommendation_execution('%s'::uuid) $$,
      (select recommendation_id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001')
    )
  ) like 'PERMISSION_DENIED:%',
  'BOSSA staff (no ai.actions.approve) cannot begin execution even on an approved recommendation'
);
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000003');
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.begin_ai_recommendation_execution('%s'::uuid) $$,
      (select id from public.ai_recommendations where organization_id = '00000000-0000-0000-0000-000000000002' and status = 'proposed' limit 1)
    )
  ) like 'CONFLICT:%',
  'A recommendation with no approved decision yet cannot begin execution'
);

-- 26-28: apply_ai_evaluation's reopening step (triggered by test 23's
-- payload change while the recommendation was 'approved') put both the
-- recommendation back to 'proposed' and the approval back to 'pending' at
-- version 3 (2 after test 21's approval, +1 for reopening) — the corrected
-- payload is re-approved, execution begins, an action attempt is recorded,
-- and the recommendation completes: exactly one ai_recommendation.executed
-- audit event, no duplicates.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select is(
  (select status from public.ai_recommendations
   where id = (select recommendation_id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001')),
  'proposed',
  'The material payload change in test 23 reopened the recommendation back to proposed for a fresh decision'
);
select lives_ok(
  format(
    $$ select public.approve_ai_recommendation('%s'::uuid, 3) $$,
    (select id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001')
  ),
  'Re-approving the corrected payload succeeds with the reopened version'
);
select lives_ok(
  format(
    $$ select public.begin_ai_recommendation_execution('%s'::uuid) $$,
    (select recommendation_id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001')
  ),
  'begin_ai_recommendation_execution succeeds once the approval is current and the payload hash matches'
);

-- Captured from the table (not the function's own return value) — the
-- claim's effect is already durable by the time lives_ok() above returns,
-- and record_ai_action_attempt()/record_ai_outcome() below both require this
-- exact token to finalize.
insert into ai_test_ids (key, id)
select 'bossa_execution_token', execution_token
from public.ai_recommendations
where id = (select recommendation_id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001');

select lives_ok(
  format(
    $$ select public.record_ai_action_attempt('%s'::uuid, '%s'::uuid, 'succeeded', '{}'::jsonb) $$,
    (select recommendation_id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001'),
    (select id from ai_test_ids where key = 'bossa_execution_token')
  ),
  'record_ai_action_attempt succeeds for a recommendation that is currently executing, given the current execution token'
);

-- 29: retry-safety — a completed recommendation cannot re-enter 'executing'.
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.begin_ai_recommendation_execution('%s'::uuid) $$,
      (select recommendation_id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001')
    )
  ) like 'INVALID_STATUS_TRANSITION:%',
  'A completed recommendation cannot be re-executed — retry-safety comes from the status machine itself'
);

-- 30: exactly one ai_recommendation.executed audit event exists for it.
select is(
  (select count(*)::int from public.audit_logs
   where entity_type = 'ai_recommendation' and action = 'ai_recommendation.executed'
     and entity_id = (select recommendation_id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001')),
  1,
  'Exactly one ai_recommendation.executed audit event was written for the completed recommendation'
);

-- 31: ai_action_attempts remains append-only even for the row just created.
select throws_ok(
  format(
    $$ update public.ai_action_attempts set result_status = 'failed' where recommendation_id = '%s' $$,
    (select recommendation_id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001')
  ),
  '42501',
  null::text,
  'ai_action_attempts rows cannot be edited after the fact, even by the organization_owner who triggered them'
);

-- 32: record_ai_outcome records an honest outcome tied to the completed
-- attempt, given the same execution token that attempt was finalized under.
select lives_ok(
  format(
    $$ select public.record_ai_outcome('%s'::uuid, (select id from public.ai_action_attempts where recommendation_id = '%s' limit 1), '%s'::uuid, 'successful') $$,
    (select recommendation_id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001'),
    (select recommendation_id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000001'),
    (select id from ai_test_ids where key = 'bossa_execution_token')
  ),
  'record_ai_outcome succeeds for the completed recommendation, given the execution token that produced its action attempt'
);

-- 33-34: reject_ai_recommendation requires a non-empty reason, and rejecting
-- is itself single-use, exercised against Papai's still-pending seeded approval.
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000003');
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.reject_ai_recommendation('%s'::uuid, 1, '') $$,
      (select id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000002')
    )
  ) like 'VALIDATION_FAILED:%',
  'reject_ai_recommendation refuses an empty reason'
);
select lives_ok(
  format(
    $$ select public.reject_ai_recommendation('%s'::uuid, 1, 'Not enough information yet') $$,
    (select id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000002')
  ),
  'Papai owner can reject Papai''s pending approval with a reason'
);
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.reject_ai_recommendation('%s'::uuid, 2, 'Second attempt') $$,
      (select id from public.ai_approvals where organization_id = '00000000-0000-0000-0000-000000000002')
    )
  ) like 'INVALID_STATUS_TRANSITION:%',
  'A second rejection attempt on the same approval fails — it is no longer pending'
);

-- 35-37: dismiss_ai_recommendation requires ai.recommendations.manage and is
-- tenant-scoped from the row, tested against BOSSA's requires_approval=false
-- navigate recommendation (no approval row at all).
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000003');
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.dismiss_ai_recommendation('%s'::uuid) $$,
      (select id from ai_test_ids where key = 'bossa_navigate_recommendation')
    )
  ) like 'PERMISSION_DENIED:%',
  'Papai owner cannot dismiss a BOSSA recommendation (resolved from the row, cross-tenant denied)'
);
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000002');
select ok(
  pg_temp.expect_error_message(
    format(
      $$ select public.dismiss_ai_recommendation('%s'::uuid) $$,
      (select id from ai_test_ids where key = 'bossa_navigate_recommendation')
    )
  ) like 'PERMISSION_DENIED:%',
  'BOSSA staff (no ai.recommendations.manage) cannot dismiss a BOSSA recommendation'
);
select pg_temp.authenticate_as('00000000-0000-0000-0002-000000000001');
select lives_ok(
  format(
    $$ select public.dismiss_ai_recommendation('%s'::uuid) $$,
    (select id from ai_test_ids where key = 'bossa_navigate_recommendation')
  ),
  'BOSSA owner (ai.recommendations.manage) can dismiss BOSSA''s no-approval-required recommendation'
);

select * from finish();
rollback;

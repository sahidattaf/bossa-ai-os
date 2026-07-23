-- Phase 4B: concurrency, execution-claim, and crash-recovery hardening,
-- driven by a principal-engineer security review of the Phase 4A merge
-- (PR #19). The review's core finding: several "decision" functions read
-- status/version in one statement and updated a *different* statement later
-- keyed only by id — a classic time-of-check-to-time-of-use gap that lets
-- two concurrent callers both believe they won a decision. Every fix below
-- replaces that pattern with a single atomic UPDATE ... WHERE <every
-- expected condition> ... RETURNING, relying on Postgres's default READ
-- COMMITTED isolation: a second concurrent UPDATE against the same row
-- blocks until the first commits, then re-evaluates its own WHERE clause
-- against the now-committed row, so at most one of two racing statements
-- can ever match. This is the exact same compare-and-swap technique Phase
-- 3's claimLeadConversion() already established for reservation/order
-- conversion — extended here to approvals, rejections, dismissals, and the
-- new execution-claim lifecycle.

-- 1. Execution-claim columns -------------------------------------------------
-- execution_token is the caller's proof of holding the *current* claim on an
-- executing recommendation — begin_ai_recommendation_execution() mints a
-- fresh one atomically with the approved/failed -> executing transition, and
-- record_ai_action_attempt()/record_ai_outcome() require it to match before
-- finalizing anything. execution_attempt_number is a plain observability
-- counter (how many times this recommendation has been claimed), not itself
-- a security mechanism.
alter table public.ai_recommendations
  add column if not exists execution_token uuid,
  add column if not exists executing_at timestamptz,
  add column if not exists execution_attempt_number integer not null default 0;

-- execution_token/execution_attempt_number are always populated by
-- record_ai_action_attempt()'s single insert path (never any other writer,
-- per this table's function-mediated-only design) — left nullable at the
-- column level rather than NOT NULL so this migration never risks failing
-- against pre-existing rows in a non-fresh database; the guarantee is
-- structural (one writer, always supplies both), not a column constraint.
alter table public.ai_action_attempts
  add column if not exists execution_token uuid,
  add column if not exists execution_attempt_number integer;

-- 2. Duplicate-success prevention (issue: concurrent execution requests must
-- produce only one domain mutation) --------------------------------------
-- A database-level backstop beyond the execution_token compare-and-swap
-- below: even if some future bug ever let two calls both reach the insert
-- for the same recommendation with the same authoritative payload_hash, only
-- one may ever be recorded as 'succeeded'. Failed attempts are unrestricted
-- (retries must remain possible), and this is a *partial* index so it never
-- constrains anything but the one row-shape it exists to prevent.
create unique index if not exists idx_ai_action_attempts_success_once
  on public.ai_action_attempts (recommendation_id, payload_hash)
  where result_status = 'succeeded';

-- 3. Atomic approve/reject/dismiss ------------------------------------------
-- All three now perform their status-changing UPDATE with every precondition
-- (status = 'pending'/'proposed'/'approved', version match where applicable,
-- not expired) *inside the WHERE clause of the single UPDATE that makes the
-- decision*, not as a preceding SELECT. record_audit_event() is only ever
-- reached by whichever call's UPDATE actually matched a row — the losing
-- side of a race raises before any audit event is written, so no duplicate
-- decision audit event can ever be created.

create or replace function public.approve_ai_recommendation(
  p_approval_id uuid,
  p_expected_version integer
)
returns public.ai_approvals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_approval public.ai_approvals;
  v_current public.ai_approvals;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: approval requires an authenticated actor';
  end if;

  select organization_id into v_organization_id from public.ai_approvals where id = p_approval_id;
  if not found then
    raise exception 'VALIDATION_FAILED: approval % was not found', p_approval_id;
  end if;

  if not public.has_permission(v_organization_id, 'ai.actions.approve') then
    raise exception 'PERMISSION_DENIED: ai.actions.approve is required to decide approval %', p_approval_id;
  end if;

  -- The compare-and-swap: status/version/expiry are re-checked in this one
  -- statement, not in a prior SELECT. payload_hash is read from the
  -- recommendation's own generated column inside the same statement, never
  -- client-supplied.
  update public.ai_approvals a
  set status = 'approved',
      decided_by_user_id = v_actor,
      decided_at = now(),
      payload_hash_at_decision = r.payload_hash,
      version = a.version + 1
  from public.ai_recommendations r
  where a.id = p_approval_id
    and a.status = 'pending'
    and a.version = p_expected_version
    and (a.expires_at is null or a.expires_at >= now())
    and r.id = a.recommendation_id
    and r.organization_id = a.organization_id
  returning a.* into v_approval;

  if not found then
    -- Diagnostic-only re-read: the decision has already, definitively, not
    -- been applied by the statement above — this is purely for a precise
    -- error message, not a second chance to succeed.
    select * into v_current from public.ai_approvals where id = p_approval_id;
    if v_current.status <> 'pending' then
      raise exception 'INVALID_STATUS_TRANSITION: approval_status cannot go from "%" to "approved" (no longer pending)', v_current.status;
    elsif v_current.expires_at is not null and v_current.expires_at < now() then
      raise exception 'CONFLICT: approval % has expired and can no longer be decided', p_approval_id;
    else
      raise exception 'CONFLICT: approval % was modified since it was loaded (expected version %, found %)',
        p_approval_id, p_expected_version, v_current.version;
    end if;
  end if;

  update public.ai_recommendations set status = 'approved' where id = v_approval.recommendation_id;

  perform public.record_audit_event(
    v_approval.organization_id, 'ai_recommendation.approved', 'ai_recommendation', v_approval.recommendation_id,
    jsonb_build_object('approval_id', p_approval_id, 'payload_hash', v_approval.payload_hash_at_decision)
  );

  return v_approval;
end;
$$;

revoke all on function public.approve_ai_recommendation(uuid, integer) from public;
grant execute on function public.approve_ai_recommendation(uuid, integer) to authenticated;

create or replace function public.reject_ai_recommendation(
  p_approval_id uuid,
  p_expected_version integer,
  p_reason text
)
returns public.ai_approvals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_approval public.ai_approvals;
  v_current public.ai_approvals;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: rejection requires an authenticated actor';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'VALIDATION_FAILED: a rejection reason is required';
  end if;

  select organization_id into v_organization_id from public.ai_approvals where id = p_approval_id;
  if not found then
    raise exception 'VALIDATION_FAILED: approval % was not found', p_approval_id;
  end if;

  if not public.has_permission(v_organization_id, 'ai.actions.approve') then
    raise exception 'PERMISSION_DENIED: ai.actions.approve is required to decide approval %', p_approval_id;
  end if;

  update public.ai_approvals
  set status = 'rejected', decided_by_user_id = v_actor, decided_at = now(), reason = p_reason, version = version + 1
  where id = p_approval_id
    and status = 'pending'
    and version = p_expected_version
    and (expires_at is null or expires_at >= now())
  returning * into v_approval;

  if not found then
    select * into v_current from public.ai_approvals where id = p_approval_id;
    if v_current.status <> 'pending' then
      raise exception 'INVALID_STATUS_TRANSITION: approval_status cannot go from "%" to "rejected" (no longer pending)', v_current.status;
    elsif v_current.expires_at is not null and v_current.expires_at < now() then
      raise exception 'CONFLICT: approval % has expired and can no longer be decided', p_approval_id;
    else
      raise exception 'CONFLICT: approval % was modified since it was loaded (expected version %, found %)',
        p_approval_id, p_expected_version, v_current.version;
    end if;
  end if;

  update public.ai_recommendations set status = 'rejected' where id = v_approval.recommendation_id;

  perform public.record_audit_event(
    v_approval.organization_id, 'ai_recommendation.rejected', 'ai_recommendation', v_approval.recommendation_id,
    jsonb_build_object('approval_id', p_approval_id, 'reason', p_reason)
  );

  return v_approval;
end;
$$;

revoke all on function public.reject_ai_recommendation(uuid, integer, text) from public;
grant execute on function public.reject_ai_recommendation(uuid, integer, text) to authenticated;

-- dismiss_ai_recommendation had the same race as approve/reject (a status
-- check in an `if`, then an unguarded UPDATE by id alone) even though the
-- review named only approve/reject explicitly — fixed the same way for
-- consistency, since leaving one decision function racy while hardening its
-- siblings would just relocate the same defect.
create or replace function public.dismiss_ai_recommendation(p_recommendation_id uuid)
returns public.ai_recommendations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_recommendation public.ai_recommendations;
  v_approval public.ai_approvals;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: dismissal requires an authenticated actor';
  end if;

  select * into v_recommendation from public.ai_recommendations where id = p_recommendation_id;
  if not found then
    raise exception 'VALIDATION_FAILED: recommendation % was not found', p_recommendation_id;
  end if;

  if not public.has_permission(v_recommendation.organization_id, 'ai.recommendations.manage') then
    raise exception 'PERMISSION_DENIED: ai.recommendations.manage is required to dismiss recommendation %', p_recommendation_id;
  end if;

  update public.ai_recommendations
  set status = 'dismissed'
  where id = p_recommendation_id
    and status in ('proposed', 'approved')
  returning * into v_recommendation;

  if not found then
    raise exception 'INVALID_STATUS_TRANSITION: recommendation_status cannot go from its current status to "dismissed"';
  end if;

  select * into v_approval from public.ai_approvals where recommendation_id = p_recommendation_id;
  if found and v_approval.status = 'pending' then
    update public.ai_approvals set status = 'expired', version = version + 1
    where id = v_approval.id and status = 'pending';
  end if;

  perform public.record_audit_event(
    v_recommendation.organization_id, 'ai_recommendation.dismissed', 'ai_recommendation', p_recommendation_id, '{}'::jsonb
  );

  return v_recommendation;
end;
$$;

revoke all on function public.dismiss_ai_recommendation(uuid) from public;
grant execute on function public.dismiss_ai_recommendation(uuid) to authenticated;

-- 4. Atomic execution claim ---------------------------------------------------
-- Permission/approval-hash checks still happen as plain reads before the
-- claim (they gate *whether this caller may ever claim it*, not the race
-- itself). The claim — approved/failed -> executing — is the one statement
-- that must be race-proof, because two concurrent callers could both have
-- observed 'approved' before either writes: the UPDATE's WHERE clause
-- re-checks status against the committed row, so only one caller's
-- statement can ever match, and the loser raises CONFLICT before calling
-- into any domain mutation (lib/ai/action-router.ts calls this before
-- executing the underlying lib/operations/* action, never after).
create or replace function public.begin_ai_recommendation_execution(p_recommendation_id uuid)
returns public.ai_recommendations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_recommendation public.ai_recommendations;
  v_approval public.ai_approvals;
  v_claimed public.ai_recommendations;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: execution requires an authenticated actor';
  end if;

  select * into v_recommendation from public.ai_recommendations where id = p_recommendation_id;
  if not found then
    raise exception 'VALIDATION_FAILED: recommendation % was not found', p_recommendation_id;
  end if;

  if v_recommendation.requires_approval then
    if not public.has_permission(v_recommendation.organization_id, 'ai.actions.approve') then
      raise exception 'PERMISSION_DENIED: ai.actions.approve is required to execute recommendation %', p_recommendation_id;
    end if;

    select * into v_approval from public.ai_approvals where recommendation_id = p_recommendation_id;
    if not found or v_approval.status <> 'approved' then
      raise exception 'CONFLICT: recommendation % does not have a current approval', p_recommendation_id;
    end if;

    if v_approval.payload_hash_at_decision is distinct from v_recommendation.payload_hash then
      raise exception 'CONFLICT: recommendation % payload changed since it was approved — re-approval required', p_recommendation_id;
    end if;
  end if;

  update public.ai_recommendations
  set status = 'executing',
      execution_token = gen_random_uuid(),
      executing_at = now(),
      execution_attempt_number = execution_attempt_number + 1
  where id = p_recommendation_id
    and status in ('approved', 'failed')
  returning * into v_claimed;

  if not found then
    -- Diagnostic-only re-read, same pattern as approve/reject: the claim has
    -- already, definitively, not been won by this call. Distinguishes a
    -- genuine invalid transition (e.g. already completed/rejected/expired) —
    -- preserving the exact status-machine error message every other
    -- transition in this schema raises — from a true concurrency race
    -- (someone else's claim is the current 'executing' one).
    select * into v_recommendation from public.ai_recommendations where id = p_recommendation_id;
    if v_recommendation.status = 'executing' then
      raise exception 'CONFLICT: recommendation % is already executing (a concurrent claim won the race)', p_recommendation_id;
    else
      raise exception 'INVALID_STATUS_TRANSITION: recommendation_status cannot go from "%" to "executing"', v_recommendation.status;
    end if;
  end if;

  return v_claimed;
end;
$$;

revoke all on function public.begin_ai_recommendation_execution(uuid) from public;
grant execute on function public.begin_ai_recommendation_execution(uuid) to authenticated;

-- 5. Token-guarded finalization ------------------------------------------------
-- record_ai_action_attempt()'s signature grows a required p_execution_token —
-- dropped and recreated since its argument list changed (not just its body).
drop function if exists public.record_ai_action_attempt(uuid, text, jsonb, text, text, integer);

create or replace function public.record_ai_action_attempt(
  p_recommendation_id uuid,
  p_execution_token uuid,
  p_result_status text,
  p_result_detail jsonb default '{}'::jsonb,
  p_error_code text default null,
  p_error_message text default null,
  p_duration_ms integer default null
)
returns public.ai_action_attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_recommendation public.ai_recommendations;
  v_finalized public.ai_recommendations;
  v_approval_id uuid;
  v_attempt public.ai_action_attempts;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: recording an action attempt requires an authenticated actor';
  end if;

  if p_result_status not in ('succeeded', 'failed') then
    raise exception 'VALIDATION_FAILED: result_status must be "succeeded" or "failed"';
  end if;

  if p_execution_token is null then
    raise exception 'VALIDATION_FAILED: an execution_token is required to finalize an action attempt';
  end if;

  select * into v_recommendation from public.ai_recommendations where id = p_recommendation_id;
  if not found then
    raise exception 'VALIDATION_FAILED: recommendation % was not found', p_recommendation_id;
  end if;

  if not public.has_permission(v_recommendation.organization_id, 'ai.actions.approve') then
    raise exception 'PERMISSION_DENIED: ai.actions.approve is required to record an action attempt for recommendation %', p_recommendation_id;
  end if;

  if v_recommendation.status <> 'executing' then
    raise exception 'INVALID_STATUS_TRANSITION: recommendation % is not currently executing (status "%")', p_recommendation_id, v_recommendation.status;
  end if;

  if v_recommendation.execution_token is distinct from p_execution_token then
    raise exception 'CONFLICT: execution token for recommendation % does not match the current execution claim', p_recommendation_id;
  end if;

  -- The atomic finalize: guarded by both status and the exact token this
  -- caller was issued. A second finalize attempt for the same claim (same or
  -- stale token, from this caller or another) cannot also match — whichever
  -- statement commits first moves the row out of 'executing', so the loser's
  -- WHERE clause finds nothing.
  update public.ai_recommendations
  set status = case when p_result_status = 'succeeded' then 'completed' else 'failed' end
  where id = p_recommendation_id
    and status = 'executing'
    and execution_token = p_execution_token
  returning * into v_finalized;

  if not found then
    raise exception 'CONFLICT: recommendation % execution claim is no longer current (already finalized or reclaimed)', p_recommendation_id;
  end if;

  select id into v_approval_id from public.ai_approvals where recommendation_id = p_recommendation_id;

  -- action_type/action_payload/payload_hash are read from the row just
  -- finalized under definer privileges — never taken from a client-supplied
  -- argument, so a caller cannot misattribute an attempt to a different
  -- action type or tamper with what payload it claims to have executed.
  insert into public.ai_action_attempts (
    organization_id, recommendation_id, approval_id, actor_user_id, action_type,
    action_payload, payload_hash, execution_token, execution_attempt_number,
    result_status, result_detail, error_code, error_message, duration_ms
  ) values (
    v_finalized.organization_id, p_recommendation_id, v_approval_id, v_actor,
    v_finalized.recommended_action_type, v_finalized.recommended_action_payload,
    v_finalized.payload_hash, p_execution_token, v_finalized.execution_attempt_number,
    p_result_status, coalesce(p_result_detail, '{}'::jsonb),
    p_error_code, p_error_message, p_duration_ms
  )
  returning * into v_attempt;

  perform public.record_audit_event(
    v_finalized.organization_id,
    case when p_result_status = 'succeeded' then 'ai_recommendation.executed' else 'ai_recommendation.execution_failed' end,
    'ai_recommendation',
    p_recommendation_id,
    jsonb_build_object('action_attempt_id', v_attempt.id, 'action_type', v_finalized.recommended_action_type, 'execution_token', p_execution_token)
  );

  return v_attempt;
end;
$$;

revoke all on function public.record_ai_action_attempt(uuid, uuid, text, jsonb, text, text, integer) from public;
grant execute on function public.record_ai_action_attempt(uuid, uuid, text, jsonb, text, text, integer) to authenticated;

-- record_ai_outcome's signature also grows a required p_execution_token,
-- validated against the *action attempt's own* stored token (ai_action_attempts
-- is append-only and already carries the token record_ai_action_attempt
-- stamped it with) — by the time an outcome is recorded the recommendation
-- itself is normally already 'completed'/'failed', so the token is checked
-- against the attempt row, not the recommendation's current (likely
-- superseded) token.
drop function if exists public.record_ai_outcome(uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text);

create or replace function public.record_ai_outcome(
  p_recommendation_id uuid,
  p_action_attempt_id uuid,
  p_execution_token uuid,
  p_status text,
  p_before_snapshot jsonb default '{}'::jsonb,
  p_after_snapshot jsonb default '{}'::jsonb,
  p_outcome_metrics jsonb default '{}'::jsonb,
  p_human_notes text default null,
  p_failure_code text default null,
  p_failure_message text default null
)
returns public.ai_outcomes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_recommendation public.ai_recommendations;
  v_attempt public.ai_action_attempts;
  v_outcome public.ai_outcomes;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: recording an outcome requires an authenticated actor';
  end if;

  if p_status not in ('pending', 'successful', 'partially_successful', 'failed', 'cancelled', 'unknown') then
    raise exception 'VALIDATION_FAILED: invalid outcome status "%"', p_status;
  end if;

  if p_execution_token is null then
    raise exception 'VALIDATION_FAILED: an execution_token is required to record an outcome';
  end if;

  select * into v_recommendation from public.ai_recommendations where id = p_recommendation_id;
  if not found then
    raise exception 'VALIDATION_FAILED: recommendation % was not found', p_recommendation_id;
  end if;

  if not public.has_permission(v_recommendation.organization_id, 'ai.actions.approve') then
    raise exception 'PERMISSION_DENIED: ai.actions.approve is required to record an outcome for recommendation %', p_recommendation_id;
  end if;

  -- Tenant- and recommendation-scoped lookup: an attempt id belonging to
  -- another recommendation or another organization simply will not be found
  -- here, regardless of the token supplied.
  select * into v_attempt
  from public.ai_action_attempts
  where id = p_action_attempt_id
    and recommendation_id = p_recommendation_id
    and organization_id = v_recommendation.organization_id;
  if not found then
    raise exception 'VALIDATION_FAILED: action attempt % was not found for recommendation %', p_action_attempt_id, p_recommendation_id;
  end if;

  if v_attempt.execution_token is distinct from p_execution_token then
    raise exception 'CONFLICT: execution token does not match the execution claim that produced action attempt %', p_action_attempt_id;
  end if;

  insert into public.ai_outcomes (
    organization_id, recommendation_id, action_attempt_id, status, measured_at,
    before_snapshot, after_snapshot, outcome_metrics, human_notes, failure_code, failure_message
  ) values (
    v_recommendation.organization_id, p_recommendation_id, p_action_attempt_id, p_status, now(),
    coalesce(p_before_snapshot, '{}'::jsonb), coalesce(p_after_snapshot, '{}'::jsonb),
    coalesce(p_outcome_metrics, '{}'::jsonb), p_human_notes, p_failure_code, p_failure_message
  )
  on conflict (recommendation_id) do update set
    action_attempt_id = excluded.action_attempt_id,
    status = excluded.status,
    measured_at = excluded.measured_at,
    before_snapshot = excluded.before_snapshot,
    after_snapshot = excluded.after_snapshot,
    outcome_metrics = excluded.outcome_metrics,
    human_notes = excluded.human_notes,
    failure_code = excluded.failure_code,
    failure_message = excluded.failure_message,
    updated_at = now()
  returning * into v_outcome;

  return v_outcome;
end;
$$;

revoke all on function public.record_ai_outcome(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text) from public;
grant execute on function public.record_ai_outcome(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text) to authenticated;

-- 6. Crash / abandoned-execution recovery -------------------------------------
-- A process that claims execution (begin_ai_recommendation_execution) and
-- then crashes before calling record_ai_action_attempt leaves a
-- recommendation permanently stuck 'executing' with no way back — normal
-- retry only accepts 'approved'/'failed' as claimable starting points. This
-- is the one narrow, permissioned, audited path back from a stalled claim.
create or replace function public.ai_execution_lease_duration()
returns interval
language sql
immutable
as $$ select interval '15 minutes' $$;

revoke all on function public.ai_execution_lease_duration() from public;
grant execute on function public.ai_execution_lease_duration() to authenticated;

comment on function public.ai_execution_lease_duration() is
  'Single source of truth for how long an execution claim may sit unfinalized before recover_stalled_ai_execution() may reclaim it. See docs/AI_APPROVAL_AND_ACTION_SECURITY.md.';

create or replace function public.recover_stalled_ai_execution(p_recommendation_id uuid)
returns public.ai_recommendations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_recommendation public.ai_recommendations;
  v_previous_token uuid;
  v_previous_executing_at timestamptz;
  v_stale_seconds numeric;
  v_recovered public.ai_recommendations;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: execution recovery requires an authenticated actor';
  end if;

  select * into v_recommendation from public.ai_recommendations where id = p_recommendation_id;
  if not found then
    raise exception 'VALIDATION_FAILED: recommendation % was not found', p_recommendation_id;
  end if;

  -- Deliberately gated on ai.recommendations.manage (organization_owner /
  -- general_manager only), not the broader ai.actions.approve — resetting a
  -- stuck execution claim is an administrative recovery action, not an
  -- ordinary approve/execute decision, so an ordinary staff approver cannot
  -- arbitrarily reset an in-flight execution.
  if not public.has_permission(v_recommendation.organization_id, 'ai.recommendations.manage') then
    raise exception 'PERMISSION_DENIED: ai.recommendations.manage is required to recover a stalled execution for recommendation %', p_recommendation_id;
  end if;

  if v_recommendation.status <> 'executing' then
    raise exception 'INVALID_STATUS_TRANSITION: recommendation % is not currently executing (status "%")', p_recommendation_id, v_recommendation.status;
  end if;

  if v_recommendation.executing_at is null or v_recommendation.executing_at > now() - public.ai_execution_lease_duration() then
    raise exception 'CONFLICT: recommendation % has not exceeded the execution lease yet — too early to recover', p_recommendation_id;
  end if;

  v_previous_token := v_recommendation.execution_token;
  v_previous_executing_at := v_recommendation.executing_at;
  v_stale_seconds := extract(epoch from (now() - v_recommendation.executing_at));

  -- Atomic recovery, guarded by the exact executing_at just read, so a
  -- legitimate finalize racing this recovery attempt (or a second concurrent
  -- recovery attempt) cannot both apply. Moves to 'failed' — an existing,
  -- legal retry-starting status — and clears the token so it can never
  -- again match a stale finalize call. ai_action_attempts history is never
  -- touched: no deletion, no rewriting.
  update public.ai_recommendations
  set status = 'failed',
      execution_token = null,
      executing_at = null
  where id = p_recommendation_id
    and status = 'executing'
    and executing_at = v_previous_executing_at
  returning * into v_recovered;

  if not found then
    raise exception 'CONFLICT: recommendation % execution state changed concurrently — recovery aborted', p_recommendation_id;
  end if;

  perform public.record_audit_event(
    v_recovered.organization_id, 'ai_recommendation.execution_recovered', 'ai_recommendation', p_recommendation_id,
    jsonb_build_object('previous_execution_token', v_previous_token, 'stale_seconds', v_stale_seconds)
  );

  return v_recovered;
end;
$$;

revoke all on function public.recover_stalled_ai_execution(uuid) from public;
grant execute on function public.recover_stalled_ai_execution(uuid) to authenticated;

comment on function public.recover_stalled_ai_execution(uuid) is
  'Narrow, permissioned, audited recovery from a crashed/abandoned execution claim. Requires ai.recommendations.manage and executing_at older than ai_execution_lease_duration(). Resets to failed (a legal retry-starting status) and invalidates the execution_token; never touches ai_action_attempts history.';

-- Phase 4A: function-mediated approval/execution transitions (issue #18
-- decisions #2, #3, #5, #7, #9). No authenticated INSERT/UPDATE grant exists
-- on ai_approvals or ai_recommendations at all (20260723000006) — every
-- transition below is the *only* way these rows change, and every function:
--   - sets search_path = public, pg_temp
--   - is REVOKE ALL FROM PUBLIC, GRANT EXECUTE TO authenticated only
--   - derives the actor from auth.uid() — never a client-supplied parameter
--   - resolves organization_id by loading the row itself (never trusts a
--     client-supplied p_organization_id for an existing row), so a caller
--     cannot claim an id belongs to a different tenant than it actually does
--   - never touches a domain table (leads/reservations/orders/etc.) — those
--     mutations happen through the ordinary RLS-scoped lib/operations path,
--     from the TS action router, never from inside these functions
--
-- Approval and execution are two distinct, durable operations (decision #3):
-- approve_ai_recommendation() persists the approval decision and nothing
-- else. begin_ai_recommendation_execution() / record_ai_action_attempt() are
-- called by the TS action router only *after* that decision is durable, and
-- a failed execution never reverts or hides the approval — the recommendation
-- moves to 'failed' (retryable via begin_ai_recommendation_execution() again,
-- a legal 'failed' -> 'executing' transition), while the approval itself
-- stays 'approved'.

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
  v_approval public.ai_approvals;
  v_recommendation public.ai_recommendations;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: approval requires an authenticated actor';
  end if;

  select * into v_approval from public.ai_approvals where id = p_approval_id;
  if not found then
    raise exception 'VALIDATION_FAILED: approval % was not found', p_approval_id;
  end if;

  if not public.has_permission(v_approval.organization_id, 'ai.actions.approve') then
    raise exception 'PERMISSION_DENIED: ai.actions.approve is required to decide approval %', p_approval_id;
  end if;

  if v_approval.status <> 'pending' then
    raise exception 'INVALID_STATUS_TRANSITION: approval_status cannot go from "%" to "approved" (no longer pending)', v_approval.status;
  end if;

  if v_approval.version <> p_expected_version then
    raise exception 'CONFLICT: approval % was modified since it was loaded (expected version %, found %)',
      p_approval_id, p_expected_version, v_approval.version;
  end if;

  if v_approval.expires_at is not null and v_approval.expires_at < now() then
    raise exception 'CONFLICT: approval % has expired and can no longer be decided', p_approval_id;
  end if;

  select * into v_recommendation from public.ai_recommendations
  where id = v_approval.recommendation_id and organization_id = v_approval.organization_id;
  if not found then
    raise exception 'VALIDATION_FAILED: recommendation for approval % was not found', p_approval_id;
  end if;

  update public.ai_approvals
  set status = 'approved',
      decided_by_user_id = v_actor,
      decided_at = now(),
      -- Server-derived from the recommendation's own generated payload_hash
      -- column — never a client-supplied hash (decision #5).
      payload_hash_at_decision = v_recommendation.payload_hash,
      version = version + 1
  where id = p_approval_id
  returning * into v_approval;

  update public.ai_recommendations set status = 'approved' where id = v_recommendation.id;

  perform public.record_audit_event(
    v_approval.organization_id, 'ai_recommendation.approved', 'ai_recommendation', v_recommendation.id,
    jsonb_build_object('approval_id', p_approval_id, 'payload_hash', v_recommendation.payload_hash)
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
  v_approval public.ai_approvals;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: rejection requires an authenticated actor';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'VALIDATION_FAILED: a rejection reason is required';
  end if;

  select * into v_approval from public.ai_approvals where id = p_approval_id;
  if not found then
    raise exception 'VALIDATION_FAILED: approval % was not found', p_approval_id;
  end if;

  if not public.has_permission(v_approval.organization_id, 'ai.actions.approve') then
    raise exception 'PERMISSION_DENIED: ai.actions.approve is required to decide approval %', p_approval_id;
  end if;

  if v_approval.status <> 'pending' then
    raise exception 'INVALID_STATUS_TRANSITION: approval_status cannot go from "%" to "rejected" (no longer pending)', v_approval.status;
  end if;

  if v_approval.version <> p_expected_version then
    raise exception 'CONFLICT: approval % was modified since it was loaded (expected version %, found %)',
      p_approval_id, p_expected_version, v_approval.version;
  end if;

  update public.ai_approvals
  set status = 'rejected', decided_by_user_id = v_actor, decided_at = now(), reason = p_reason, version = version + 1
  where id = p_approval_id
  returning * into v_approval;

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

create or replace function public.dismiss_ai_recommendation(p_recommendation_id uuid)
returns public.ai_recommendations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recommendation public.ai_recommendations;
  v_approval public.ai_approvals;
  v_actor uuid := auth.uid();
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

  if v_recommendation.status not in ('proposed', 'approved') then
    raise exception 'INVALID_STATUS_TRANSITION: recommendation_status cannot go from "%" to "dismissed"', v_recommendation.status;
  end if;

  update public.ai_recommendations set status = 'dismissed' where id = p_recommendation_id
  returning * into v_recommendation;

  select * into v_approval from public.ai_approvals where recommendation_id = p_recommendation_id;
  if found and v_approval.status = 'pending' then
    update public.ai_approvals set status = 'expired', version = version + 1 where id = v_approval.id;
  end if;

  perform public.record_audit_event(
    v_recommendation.organization_id, 'ai_recommendation.dismissed', 'ai_recommendation', p_recommendation_id, '{}'::jsonb
  );

  return v_recommendation;
end;
$$;

revoke all on function public.dismiss_ai_recommendation(uuid) from public;
grant execute on function public.dismiss_ai_recommendation(uuid) to authenticated;

-- Called by the TS action router *before* it performs the underlying domain
-- mutation. Re-verifies ai.actions.approve against the *currently*
-- authenticated actor (not just whoever approved it earlier — decision #3's
-- "verify ai.actions.approve where applicable" is an execution-time check,
-- not only an approval-time one) and that the approval's snapshotted
-- payload_hash still matches the recommendation's live payload_hash,
-- rejecting a stale/tampered approval before anything executes.
create or replace function public.begin_ai_recommendation_execution(p_recommendation_id uuid)
returns public.ai_recommendations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recommendation public.ai_recommendations;
  v_approval public.ai_approvals;
  v_actor uuid := auth.uid();
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

  if v_recommendation.status not in ('approved', 'failed') then
    raise exception 'INVALID_STATUS_TRANSITION: recommendation_status cannot go from "%" to "executing"', v_recommendation.status;
  end if;

  update public.ai_recommendations set status = 'executing' where id = p_recommendation_id
  returning * into v_recommendation;

  return v_recommendation;
end;
$$;

revoke all on function public.begin_ai_recommendation_execution(uuid) from public;
grant execute on function public.begin_ai_recommendation_execution(uuid) to authenticated;

-- Append-only insert into ai_action_attempts, plus the recommendation's
-- resulting status transition. payload_hash is copied from the
-- recommendation's own generated column, never recomputed from client input.
create or replace function public.record_ai_action_attempt(
  p_recommendation_id uuid,
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
  v_recommendation public.ai_recommendations;
  v_approval_id uuid;
  v_attempt public.ai_action_attempts;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: recording an action attempt requires an authenticated actor';
  end if;

  if p_result_status not in ('succeeded', 'failed') then
    raise exception 'VALIDATION_FAILED: result_status must be "succeeded" or "failed"';
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

  select id into v_approval_id from public.ai_approvals where recommendation_id = p_recommendation_id;

  insert into public.ai_action_attempts (
    organization_id, recommendation_id, approval_id, actor_user_id, action_type,
    action_payload, payload_hash, result_status, result_detail, error_code, error_message, duration_ms
  ) values (
    v_recommendation.organization_id, p_recommendation_id, v_approval_id, v_actor,
    v_recommendation.recommended_action_type, v_recommendation.recommended_action_payload,
    v_recommendation.payload_hash, p_result_status, coalesce(p_result_detail, '{}'::jsonb),
    p_error_code, p_error_message, p_duration_ms
  )
  returning * into v_attempt;

  update public.ai_recommendations
  set status = case when p_result_status = 'succeeded' then 'completed' else 'failed' end
  where id = p_recommendation_id;

  perform public.record_audit_event(
    v_recommendation.organization_id,
    case when p_result_status = 'succeeded' then 'ai_recommendation.executed' else 'ai_recommendation.execution_failed' end,
    'ai_recommendation',
    p_recommendation_id,
    jsonb_build_object('action_attempt_id', v_attempt.id, 'action_type', v_recommendation.recommended_action_type)
  );

  return v_attempt;
end;
$$;

revoke all on function public.record_ai_action_attempt(uuid, text, jsonb, text, text, integer) from public;
grant execute on function public.record_ai_action_attempt(uuid, text, jsonb, text, text, integer) to authenticated;

create or replace function public.record_ai_outcome(
  p_recommendation_id uuid,
  p_action_attempt_id uuid,
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
  v_recommendation public.ai_recommendations;
  v_outcome public.ai_outcomes;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: recording an outcome requires an authenticated actor';
  end if;

  if p_status not in ('pending', 'successful', 'partially_successful', 'failed', 'cancelled', 'unknown') then
    raise exception 'VALIDATION_FAILED: invalid outcome status "%"', p_status;
  end if;

  select * into v_recommendation from public.ai_recommendations where id = p_recommendation_id;
  if not found then
    raise exception 'VALIDATION_FAILED: recommendation % was not found', p_recommendation_id;
  end if;

  if not public.has_permission(v_recommendation.organization_id, 'ai.actions.approve') then
    raise exception 'PERMISSION_DENIED: ai.actions.approve is required to record an outcome for recommendation %', p_recommendation_id;
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

revoke all on function public.record_ai_outcome(uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text) from public;
grant execute on function public.record_ai_outcome(uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text) to authenticated;

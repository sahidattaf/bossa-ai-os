-- Phase 4C: consistent lock order between approval decisions and
-- re-evaluation (issue: approve_ai_recommendation() CAS-updated ai_approvals
-- and then updated ai_recommendations separately, with no lock held on the
-- recommendation row in between; apply_ai_evaluation() could concurrently
-- upsert/reopen the same recommendation between those two statements,
-- risking a committed state where an approval's payload_hash_at_decision no
-- longer matches its recommendation's live payload_hash — exactly the
-- tamper condition begin_ai_recommendation_execution() is supposed to catch,
-- reached instead through a race rather than a stale client).
--
-- The fix: every path that can transition an approval or its recommendation
-- now takes an explicit `SELECT ... FOR UPDATE` lock on the recommendation
-- row FIRST, before touching ai_approvals — the same order
-- apply_ai_evaluation() already used (it locks the recommendation row via
-- its own UPDATE/upsert before ever reaching the reopening branch that
-- touches ai_approvals). Two transactions taking locks in the same fixed
-- order can never deadlock waiting on each other, and whichever commits
-- first is authoritative for the other's subsequent (now-unblocked) reads —
-- this is what makes the two documented outcomes of the approve/re-evaluate
-- race mutually exclusive and jointly exhaustive: either the evaluation
-- commits first (the approval decision that follows sees the new, matching
-- payload_hash), or the approval commits first (a later evaluation with a
-- materially different payload reopens it to proposed/pending, per the
-- existing reopening mechanism) — never a payload_hash mismatch left behind
-- in committed state, never a deadlock, never an orphaned decision.

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
  v_recommendation_id uuid;
  v_organization_id uuid;
  v_recommendation public.ai_recommendations;
  v_approval public.ai_approvals;
  v_current public.ai_approvals;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: approval requires an authenticated actor';
  end if;

  select recommendation_id, organization_id into v_recommendation_id, v_organization_id
  from public.ai_approvals where id = p_approval_id;
  if not found then
    raise exception 'VALIDATION_FAILED: approval % was not found', p_approval_id;
  end if;

  if not public.has_permission(v_organization_id, 'ai.actions.approve') then
    raise exception 'PERMISSION_DENIED: ai.actions.approve is required to decide approval %', p_approval_id;
  end if;

  -- Lock order: recommendation row first. Blocks here for the duration of
  -- any concurrent apply_ai_evaluation() call already holding this row's
  -- lock, and once unblocked reflects that call's fully-committed result —
  -- never a half-applied re-evaluation.
  select * into v_recommendation
  from public.ai_recommendations
  where id = v_recommendation_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'VALIDATION_FAILED: recommendation for approval % was not found', p_approval_id;
  end if;

  -- The compare-and-swap: status/version/expiry are re-checked in this one
  -- statement, plus the recommendation's own status (read from the row just
  -- locked above, not a live subquery) — an approval can only be decided
  -- while its recommendation is genuinely still 'proposed'. payload_hash is
  -- taken from that same locked read, never client-supplied and never
  -- stale relative to a concurrent evaluation.
  update public.ai_approvals
  set status = 'approved',
      decided_by_user_id = v_actor,
      decided_at = now(),
      payload_hash_at_decision = v_recommendation.payload_hash,
      version = version + 1
  where id = p_approval_id
    and status = 'pending'
    and version = p_expected_version
    and (expires_at is null or expires_at >= now())
    and v_recommendation.status = 'proposed'
  returning * into v_approval;

  if not found then
    -- Diagnostic-only re-read: the decision has already, definitively, not
    -- been applied by the statement above.
    select * into v_current from public.ai_approvals where id = p_approval_id;
    if v_current.status <> 'pending' then
      raise exception 'INVALID_STATUS_TRANSITION: approval_status cannot go from "%" to "approved" (no longer pending)', v_current.status;
    elsif v_current.expires_at is not null and v_current.expires_at < now() then
      raise exception 'CONFLICT: approval % has expired and can no longer be decided', p_approval_id;
    elsif v_recommendation.status <> 'proposed' then
      raise exception 'INVALID_STATUS_TRANSITION: recommendation is "%", not "proposed" — it cannot be approved right now', v_recommendation.status;
    else
      raise exception 'CONFLICT: approval % was modified since it was loaded (expected version %, found %)',
        p_approval_id, p_expected_version, v_current.version;
    end if;
  end if;

  update public.ai_recommendations set status = 'approved' where id = v_recommendation.id;

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
  v_recommendation_id uuid;
  v_organization_id uuid;
  v_recommendation public.ai_recommendations;
  v_approval public.ai_approvals;
  v_current public.ai_approvals;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: rejection requires an authenticated actor';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'VALIDATION_FAILED: a rejection reason is required';
  end if;

  select recommendation_id, organization_id into v_recommendation_id, v_organization_id
  from public.ai_approvals where id = p_approval_id;
  if not found then
    raise exception 'VALIDATION_FAILED: approval % was not found', p_approval_id;
  end if;

  if not public.has_permission(v_organization_id, 'ai.actions.approve') then
    raise exception 'PERMISSION_DENIED: ai.actions.approve is required to decide approval %', p_approval_id;
  end if;

  -- Same lock order as approve_ai_recommendation: recommendation row first.
  select * into v_recommendation
  from public.ai_recommendations
  where id = v_recommendation_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'VALIDATION_FAILED: recommendation for approval % was not found', p_approval_id;
  end if;

  update public.ai_approvals
  set status = 'rejected', decided_by_user_id = v_actor, decided_at = now(), reason = p_reason, version = version + 1
  where id = p_approval_id
    and status = 'pending'
    and version = p_expected_version
    and (expires_at is null or expires_at >= now())
    and v_recommendation.status = 'proposed'
  returning * into v_approval;

  if not found then
    select * into v_current from public.ai_approvals where id = p_approval_id;
    if v_current.status <> 'pending' then
      raise exception 'INVALID_STATUS_TRANSITION: approval_status cannot go from "%" to "rejected" (no longer pending)', v_current.status;
    elsif v_current.expires_at is not null and v_current.expires_at < now() then
      raise exception 'CONFLICT: approval % has expired and can no longer be decided', p_approval_id;
    elsif v_recommendation.status <> 'proposed' then
      raise exception 'INVALID_STATUS_TRANSITION: recommendation is "%", not "proposed" — it cannot be rejected right now', v_recommendation.status;
    else
      raise exception 'CONFLICT: approval % was modified since it was loaded (expected version %, found %)',
        p_approval_id, p_expected_version, v_current.version;
    end if;
  end if;

  update public.ai_recommendations set status = 'rejected' where id = v_recommendation.id;

  perform public.record_audit_event(
    v_approval.organization_id, 'ai_recommendation.rejected', 'ai_recommendation', v_approval.recommendation_id,
    jsonb_build_object('approval_id', p_approval_id, 'reason', p_reason)
  );

  return v_approval;
end;
$$;

revoke all on function public.reject_ai_recommendation(uuid, integer, text) from public;
grant execute on function public.reject_ai_recommendation(uuid, integer, text) to authenticated;

-- Phase 4C: atomic business-action execution + finalization (issue: the
-- router previously performed begin-claim -> actionModule.execute() (a
-- separate lib/operations/* round trip) -> record_ai_action_attempt() as
-- three independent steps. A crash or lost response after the domain
-- mutation committed but before record_ai_action_attempt() ran left the
-- mutation durably applied while the recommendation stayed 'executing'
-- forever — lease recovery could then permit a retry with no way to know
-- the business action had already happened once.
--
-- finalize_ai_recommendation_execution() folds validate-token -> load
-- authoritative action_type/payload -> verify the exact domain permission ->
-- perform the domain mutation -> insert ai_action_attempts -> transition the
-- recommendation -> write audit history into ONE PL/pgSQL function call,
-- which Postgres always executes as a single atomic transaction: if the
-- ai_action_attempts insert (or anything after the mutation) raises, the
-- domain mutation performed moments earlier in the SAME call is rolled back
-- too, because nothing in this call has committed until the call returns.
--
-- This function handles the seven *database-native* action types only —
-- assign_lead_owner, change_lead_status, confirm_reservation,
-- cancel_reservation, change_order_status, change_order_payment_status,
-- regenerate_kpi_snapshot. A future external/network action (anything that
-- calls out to a third-party API) cannot be made atomic this way — a
-- network call can succeed while the local commit that would record it
-- fails, with no local transaction able to undo an already-sent HTTP
-- request. That requires a transactional outbox (durably record "attempt
-- this call" in the same transaction as everything else, with a separate
-- worker actually making the call and a stable idempotency key so retrying
-- the call is provably safe) — out of scope until Phase 4A's guarded-action
-- allow-list actually includes one.
--
-- record_ai_action_attempt() (20260724000001) is NOT replaced or removed —
-- it remains the general-purpose "record an externally-computed finalize
-- result" primitive (used by existing tests exercising the token/status
-- contract in isolation, and the intended extension point for a future
-- outbox-backed external action). The TS router now calls this new function
-- for the seven known database-native types specifically, never a
-- dynamically-constructed function name — the compiled TypeScript allow-list
-- in lib/ai/action-router.ts is unchanged in kind, just no longer performs
-- the mutation itself.

create or replace function public.finalize_ai_recommendation_execution(
  p_recommendation_id uuid,
  p_execution_token uuid
)
returns public.ai_action_attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_recommendation public.ai_recommendations;
  v_approval_id uuid;
  v_attempt public.ai_action_attempts;
  v_payload jsonb;
  v_result_status text;
  v_result_detail jsonb := '{}'::jsonb;
  v_error_code text;
  v_error_message text;
  v_full_message text;
  v_lead public.leads;
  v_reservation public.reservations;
  v_order public.orders;
  v_snapshot public.daily_kpi_snapshots;
  v_started_at timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED: finalizing an execution requires an authenticated actor';
  end if;

  if p_execution_token is null then
    raise exception 'VALIDATION_FAILED: an execution_token is required to finalize an action attempt';
  end if;

  select * into v_recommendation from public.ai_recommendations where id = p_recommendation_id;
  if not found then
    raise exception 'VALIDATION_FAILED: recommendation % was not found', p_recommendation_id;
  end if;

  -- ai.actions.approve gates whether this actor may drive execution at all.
  -- The exact domain permission for the action itself (crm.write,
  -- reservations.write, orders.write, or finance.read) is checked per action
  -- type below — the same permission RLS would require of a human
  -- performing the equivalent write directly.
  if not public.has_permission(v_recommendation.organization_id, 'ai.actions.approve') then
    raise exception 'PERMISSION_DENIED: ai.actions.approve is required to record an action attempt for recommendation %', p_recommendation_id;
  end if;

  if v_recommendation.status <> 'executing' then
    raise exception 'INVALID_STATUS_TRANSITION: recommendation % is not currently executing (status "%")', p_recommendation_id, v_recommendation.status;
  end if;

  if v_recommendation.execution_token is distinct from p_execution_token then
    raise exception 'CONFLICT: execution token for recommendation % does not match the current execution claim', p_recommendation_id;
  end if;

  v_payload := v_recommendation.recommended_action_payload;

  -- Domain-permission verification (uncaught — a caller lacking the exact
  -- permission for this action type is refused outright, the same as the
  -- ai.actions.approve check above: no attempt is recorded for an
  -- authorization failure, only for a business-logic failure).
  if v_recommendation.recommended_action_type in ('assign_lead_owner', 'change_lead_status') then
    if not public.has_permission(v_recommendation.organization_id, 'crm.write') then
      raise exception 'PERMISSION_DENIED: crm.write is required for %', v_recommendation.recommended_action_type;
    end if;
  elsif v_recommendation.recommended_action_type in ('confirm_reservation', 'cancel_reservation') then
    if not public.has_permission(v_recommendation.organization_id, 'reservations.write') then
      raise exception 'PERMISSION_DENIED: reservations.write is required for %', v_recommendation.recommended_action_type;
    end if;
  elsif v_recommendation.recommended_action_type in ('change_order_status', 'change_order_payment_status') then
    if not public.has_permission(v_recommendation.organization_id, 'orders.write') then
      raise exception 'PERMISSION_DENIED: orders.write is required for %', v_recommendation.recommended_action_type;
    end if;
  elsif v_recommendation.recommended_action_type = 'regenerate_kpi_snapshot' then
    if not public.has_permission(v_recommendation.organization_id, 'finance.read') then
      raise exception 'PERMISSION_DENIED: finance.read is required for regenerate_kpi_snapshot';
    end if;
  else
    raise exception 'VALIDATION_FAILED: unsupported or non-executable action type "%"', v_recommendation.recommended_action_type;
  end if;

  -- The domain mutation itself. Wrapped in its own exception-catching block
  -- (an implicit savepoint): a business-logic failure here (row not found,
  -- illegal status transition) rolls back only the mutation, and control
  -- passes to the handler below to record an honest 'failed' attempt — the
  -- outer call still completes and commits normally. A failure *after* this
  -- block (the ai_action_attempts insert, or the recommendation-status
  -- update) is NOT caught anywhere and aborts the entire call, rolling back
  -- a mutation that already "succeeded" moments earlier in this same
  -- transaction — see the rollback test in ai_executive_transactional.test.sql.
  begin
    if v_recommendation.recommended_action_type = 'assign_lead_owner' then
      update public.leads
      set owner_user_id = (v_payload ->> 'ownerUserId')::uuid
      where id = (v_payload ->> 'leadId')::uuid and organization_id = v_recommendation.organization_id
      returning * into v_lead;
      if not found then
        raise exception 'VALIDATION_FAILED: lead % was not found for organization %', v_payload ->> 'leadId', v_recommendation.organization_id;
      end if;
      v_result_detail := jsonb_build_object('leadId', v_lead.id, 'ownerUserId', v_lead.owner_user_id);

    elsif v_recommendation.recommended_action_type = 'change_lead_status' then
      update public.leads
      set status = (v_payload ->> 'status')
      where id = (v_payload ->> 'leadId')::uuid and organization_id = v_recommendation.organization_id
      returning * into v_lead;
      if not found then
        raise exception 'VALIDATION_FAILED: lead % was not found for organization %', v_payload ->> 'leadId', v_recommendation.organization_id;
      end if;
      v_result_detail := jsonb_build_object('leadId', v_lead.id, 'status', v_lead.status);

    elsif v_recommendation.recommended_action_type = 'confirm_reservation' then
      update public.reservations
      set status = 'confirmed'
      where id = (v_payload ->> 'reservationId')::uuid and organization_id = v_recommendation.organization_id
      returning * into v_reservation;
      if not found then
        raise exception 'VALIDATION_FAILED: reservation % was not found for organization %', v_payload ->> 'reservationId', v_recommendation.organization_id;
      end if;
      v_result_detail := jsonb_build_object('reservationId', v_reservation.id, 'status', v_reservation.status);

    elsif v_recommendation.recommended_action_type = 'cancel_reservation' then
      update public.reservations
      set status = 'cancelled'
      where id = (v_payload ->> 'reservationId')::uuid and organization_id = v_recommendation.organization_id
      returning * into v_reservation;
      if not found then
        raise exception 'VALIDATION_FAILED: reservation % was not found for organization %', v_payload ->> 'reservationId', v_recommendation.organization_id;
      end if;
      v_result_detail := jsonb_build_object('reservationId', v_reservation.id, 'status', v_reservation.status);

    elsif v_recommendation.recommended_action_type = 'change_order_status' then
      update public.orders
      set status = (v_payload ->> 'status')
      where id = (v_payload ->> 'orderId')::uuid and organization_id = v_recommendation.organization_id
      returning * into v_order;
      if not found then
        raise exception 'VALIDATION_FAILED: order % was not found for organization %', v_payload ->> 'orderId', v_recommendation.organization_id;
      end if;
      v_result_detail := jsonb_build_object('orderId', v_order.id, 'status', v_order.status);

    elsif v_recommendation.recommended_action_type = 'change_order_payment_status' then
      update public.orders
      set payment_status = (v_payload ->> 'paymentStatus')
      where id = (v_payload ->> 'orderId')::uuid and organization_id = v_recommendation.organization_id
      returning * into v_order;
      if not found then
        raise exception 'VALIDATION_FAILED: order % was not found for organization %', v_payload ->> 'orderId', v_recommendation.organization_id;
      end if;
      v_result_detail := jsonb_build_object('orderId', v_order.id, 'paymentStatus', v_order.payment_status);

    elsif v_recommendation.recommended_action_type = 'regenerate_kpi_snapshot' then
      -- calculate_daily_kpi_snapshot() enforces finance.read itself too (and
      -- skips the check for a null auth.uid(), the service-role convention
      -- every scheduled-job-shaped function in this schema follows) — called
      -- directly so it runs inside this same transaction, not a separate
      -- round trip.
      select * into v_snapshot from public.calculate_daily_kpi_snapshot(
        v_recommendation.organization_id,
        coalesce(nullif(v_payload ->> 'date', '')::date, current_date),
        nullif(v_payload ->> 'locationId', '')::uuid
      );
      v_result_detail := jsonb_build_object('snapshotId', v_snapshot.id, 'revenue', v_snapshot.revenue, 'snapshotDate', v_snapshot.snapshot_date);
    end if;

    v_result_status := 'succeeded';
  exception when others then
    v_result_status := 'failed';
    get stacked diagnostics v_full_message = message_text;
    v_error_code := substring(v_full_message from '^([A-Z_]+):');
    if v_error_code is not null then
      v_error_message := btrim(substring(v_full_message from '^[A-Z_]+:(.*)$'));
    else
      v_error_code := 'UNEXPECTED_ERROR';
      v_error_message := v_full_message;
    end if;
  end;

  -- Atomic finalize CAS, same guard as begin's claim: only a caller whose
  -- token still matches AND observes the row still 'executing' can flip it.
  -- If this fails to match (a concurrent finalize somehow already ran), the
  -- whole call aborts here, rolling back whatever the mutation block above
  -- just did.
  update public.ai_recommendations
  set status = case when v_result_status = 'succeeded' then 'completed' else 'failed' end
  where id = p_recommendation_id
    and status = 'executing'
    and execution_token = p_execution_token
  returning * into v_recommendation;

  if not found then
    raise exception 'CONFLICT: recommendation % execution claim is no longer current (already finalized or reclaimed)', p_recommendation_id;
  end if;

  select id into v_approval_id from public.ai_approvals where recommendation_id = p_recommendation_id;

  -- action_type/action_payload/payload_hash are read from the row itself
  -- under definer privileges — never a client-supplied argument.
  insert into public.ai_action_attempts (
    organization_id, recommendation_id, approval_id, actor_user_id, action_type,
    action_payload, payload_hash, execution_token, execution_attempt_number,
    result_status, result_detail, error_code, error_message, duration_ms
  ) values (
    v_recommendation.organization_id, p_recommendation_id, v_approval_id, v_actor,
    v_recommendation.recommended_action_type, v_recommendation.recommended_action_payload,
    v_recommendation.payload_hash, p_execution_token, v_recommendation.execution_attempt_number,
    v_result_status, v_result_detail, v_error_code, v_error_message,
    round(extract(epoch from (clock_timestamp() - v_started_at)) * 1000)::integer
  )
  returning * into v_attempt;

  perform public.record_audit_event(
    v_recommendation.organization_id,
    case when v_result_status = 'succeeded' then 'ai_recommendation.executed' else 'ai_recommendation.execution_failed' end,
    'ai_recommendation',
    p_recommendation_id,
    jsonb_build_object('action_attempt_id', v_attempt.id, 'action_type', v_recommendation.recommended_action_type, 'execution_token', p_execution_token)
  );

  return v_attempt;
end;
$$;

revoke all on function public.finalize_ai_recommendation_execution(uuid, uuid) from public;
grant execute on function public.finalize_ai_recommendation_execution(uuid, uuid) to authenticated;

comment on function public.finalize_ai_recommendation_execution(uuid, uuid) is
  'Atomic execution of a database-native guarded action (issue: crash-window between domain mutation and attempt recording). Validates the execution token, verifies the exact domain permission for the authoritative action type, performs the mutation, records the attempt, and transitions the recommendation — all in one transaction, so a failure anywhere after the mutation rolls the mutation back too. See docs/AI_APPROVAL_AND_ACTION_SECURITY.md.';

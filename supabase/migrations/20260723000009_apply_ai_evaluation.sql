-- Phase 4A: apply_ai_evaluation() — the single transactional RPC that
-- applies the deterministic rule engine's output (issue #18 decision #4).
-- Fact-gathering is get_ai_evaluation_facts() (SECURITY INVOKER, previous
-- migration); rule evaluation is pure TypeScript (lib/ai/rules/*.ts,
-- zero DB dependency, unit-tested); this function is the only place any of
-- it gets written, and it writes ALL of it — signals, recommendations,
-- evidence, expiry — as one PL/pgSQL function body, which Postgres always
-- executes as a single atomic unit: if any step raises, everything applied
-- so far in this call rolls back, so the database can never be left with a
-- half-applied evaluation.
--
-- Idempotency: every upsert is keyed by (organization_id, dedupe_key) (or
-- (recommendation_id, metric_name) for evidence), so calling this twice with
-- identical p_intents for the same organization/location/as_of/rule_version
-- produces the same end state, not duplicate rows.
--
-- p_intents contract (produced by lib/ai/evaluate.ts, validated by zod
-- before this call):
-- {
--   "signals": [{ signal_type, location_id?, severity, title, facts, observed_at?, dedupe_key, source_entity_type?, source_entity_id? }],
--   "recommendations": [{
--     dedupe_key, location_id?, recommendation_type, title, executive_summary,
--     severity, priority_score?, recommended_action_type, action_schema_version?,
--     recommended_action_payload, expected_benefit?, risk_level?, requires_approval?,
--     rule_id, expires_at?,
--     evidence: [{ metric_name, observed_value, expected_value?, source_entity_type?, source_entity_id?, calculation_definition, is_finance_sensitive? }]
--   }]
-- }
create or replace function public.apply_ai_evaluation(
  p_organization_id uuid,
  p_location_id uuid,
  p_as_of timestamptz,
  p_rule_version text,
  p_intents jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_signal jsonb;
  v_recommendation jsonb;
  v_evidence jsonb;
  v_recommendation_id uuid;
  v_previous_status text;
  v_previous_payload_hash text;
  v_new_payload_hash text;
  v_signals_upserted int := 0;
  v_signals_resolved int := 0;
  v_recommendations_upserted int := 0;
  v_recommendations_expired int := 0;
  v_approvals_expired int := 0;
  v_active_signal_keys text[];
  v_active_recommendation_keys text[];
  v_expired_recommendation_ids uuid[];
begin
  if auth.uid() is not null and not public.has_permission(p_organization_id, 'ai.recommendations.manage') then
    raise exception 'PERMISSION_DENIED: ai.recommendations.manage is required to apply an AI evaluation for organization %', p_organization_id;
  end if;

  -- 1. Upsert current signals.
  for v_signal in select * from jsonb_array_elements(coalesce(p_intents -> 'signals', '[]'::jsonb))
  loop
    insert into public.ai_signals (
      organization_id, location_id, signal_type, source_entity_type, source_entity_id,
      severity, title, facts, observed_at, dedupe_key, status, rule_version
    ) values (
      p_organization_id,
      coalesce(nullif(v_signal ->> 'location_id', '')::uuid, p_location_id),
      v_signal ->> 'signal_type',
      nullif(v_signal ->> 'source_entity_type', ''),
      nullif(v_signal ->> 'source_entity_id', '')::uuid,
      v_signal ->> 'severity',
      v_signal ->> 'title',
      coalesce(v_signal -> 'facts', '{}'::jsonb),
      coalesce(nullif(v_signal ->> 'observed_at', '')::timestamptz, p_as_of),
      v_signal ->> 'dedupe_key',
      'active',
      p_rule_version
    )
    on conflict (organization_id, dedupe_key) do update set
      severity = excluded.severity,
      title = excluded.title,
      facts = excluded.facts,
      observed_at = excluded.observed_at,
      status = 'active',
      rule_version = excluded.rule_version,
      updated_at = now();

    v_signals_upserted := v_signals_upserted + 1;
  end loop;

  -- 2. Resolve stale signals: anything this rule_version last marked active
  -- that isn't in this run's active set anymore.
  select coalesce(array_agg(elem ->> 'dedupe_key'), array[]::text[])
  into v_active_signal_keys
  from jsonb_array_elements(coalesce(p_intents -> 'signals', '[]'::jsonb)) as elem;

  with resolved as (
    update public.ai_signals
    set status = 'resolved', updated_at = now()
    where organization_id = p_organization_id
      and status = 'active'
      and rule_version = p_rule_version
      and not (dedupe_key = any(v_active_signal_keys))
      and (p_location_id is null or location_id = p_location_id or location_id is null)
    returning 1
  )
  select count(*) into v_signals_resolved from resolved;

  -- 3. Upsert recommendations (+ their approval row + evidence).
  for v_recommendation in select * from jsonb_array_elements(coalesce(p_intents -> 'recommendations', '[]'::jsonb))
  loop
    -- Captured before the upsert so we can detect a *material* change to an
    -- already-approved recommendation (see the reopening step below) — the
    -- generated payload_hash column makes "materially changed" precise.
    select status, payload_hash into v_previous_status, v_previous_payload_hash
    from public.ai_recommendations
    where organization_id = p_organization_id
      and dedupe_key = v_recommendation ->> 'dedupe_key'
      and status in ('proposed', 'approved', 'executing');

    insert into public.ai_recommendations (
      organization_id, location_id, recommendation_type, title, executive_summary,
      severity, priority_score, recommended_action_type, action_schema_version,
      recommended_action_payload, expected_benefit, risk_level, requires_approval,
      rule_id, rule_version, dedupe_key, expires_at
    ) values (
      p_organization_id,
      coalesce(nullif(v_recommendation ->> 'location_id', '')::uuid, p_location_id),
      v_recommendation ->> 'recommendation_type',
      v_recommendation ->> 'title',
      v_recommendation ->> 'executive_summary',
      v_recommendation ->> 'severity',
      coalesce((v_recommendation ->> 'priority_score')::int, 0),
      v_recommendation ->> 'recommended_action_type',
      coalesce(v_recommendation ->> 'action_schema_version', 'v1'),
      coalesce(v_recommendation -> 'recommended_action_payload', '{}'::jsonb),
      v_recommendation ->> 'expected_benefit',
      coalesce(v_recommendation ->> 'risk_level', 'low'),
      coalesce((v_recommendation ->> 'requires_approval')::boolean, true),
      v_recommendation ->> 'rule_id',
      p_rule_version,
      v_recommendation ->> 'dedupe_key',
      nullif(v_recommendation ->> 'expires_at', '')::timestamptz
    )
    on conflict (organization_id, dedupe_key) where status in ('proposed', 'approved', 'executing') do update set
      title = excluded.title,
      executive_summary = excluded.executive_summary,
      severity = excluded.severity,
      priority_score = excluded.priority_score,
      recommended_action_payload = excluded.recommended_action_payload,
      expected_benefit = excluded.expected_benefit,
      risk_level = excluded.risk_level,
      rule_version = excluded.rule_version,
      expires_at = excluded.expires_at,
      updated_at = now()
    returning id, payload_hash into v_recommendation_id, v_new_payload_hash;

    if coalesce((v_recommendation ->> 'requires_approval')::boolean, true) then
      insert into public.ai_approvals (organization_id, recommendation_id, status, version)
      values (p_organization_id, v_recommendation_id, 'pending', 1)
      on conflict (recommendation_id) do nothing;

      -- Reopening: this recommendation was already 'approved', but the
      -- payload just changed materially (a re-evaluation found the
      -- underlying facts moved since it was decided). The previously
      -- approved action no longer matches what would be approved now, so
      -- it goes back to 'proposed' for a fresh decision rather than
      -- silently executing (or silently blocking forever) — issue #18
      -- decision #5's tamper/staleness guarantee, extended to legitimate
      -- re-evaluation, not just tampering.
      if v_previous_status = 'approved' and v_previous_payload_hash is distinct from v_new_payload_hash then
        update public.ai_recommendations set status = 'proposed' where id = v_recommendation_id;
        update public.ai_approvals
        set status = 'pending', version = version + 1, payload_hash_at_decision = null, decided_by_user_id = null, decided_at = null
        where recommendation_id = v_recommendation_id and status = 'approved';
      end if;
    end if;

    for v_evidence in select * from jsonb_array_elements(coalesce(v_recommendation -> 'evidence', '[]'::jsonb))
    loop
      insert into public.ai_recommendation_evidence (
        organization_id, recommendation_id, metric_name, observed_value, expected_value,
        source_entity_type, source_entity_id, calculation_definition, is_finance_sensitive
      ) values (
        p_organization_id,
        v_recommendation_id,
        v_evidence ->> 'metric_name',
        v_evidence -> 'observed_value',
        v_evidence -> 'expected_value',
        nullif(v_evidence ->> 'source_entity_type', ''),
        nullif(v_evidence ->> 'source_entity_id', '')::uuid,
        v_evidence ->> 'calculation_definition',
        coalesce((v_evidence ->> 'is_finance_sensitive')::boolean, false)
      )
      on conflict (recommendation_id, metric_name) do update set
        observed_value = excluded.observed_value,
        expected_value = excluded.expected_value,
        source_entity_type = excluded.source_entity_type,
        source_entity_id = excluded.source_entity_id,
        calculation_definition = excluded.calculation_definition,
        is_finance_sensitive = excluded.is_finance_sensitive;
    end loop;

    v_recommendations_upserted := v_recommendations_upserted + 1;
  end loop;

  -- 4. Expire obsolete recommendations: still open, but either the
  -- underlying signal is gone (dedupe_key no longer active) or the
  -- recommendation's own expires_at has passed. Cascade to any pending
  -- approval — a recommendation that no longer needs deciding shouldn't
  -- leave a dangling pending approval behind.
  select coalesce(array_agg(elem ->> 'dedupe_key'), array[]::text[])
  into v_active_recommendation_keys
  from jsonb_array_elements(coalesce(p_intents -> 'recommendations', '[]'::jsonb)) as elem;

  with expired as (
    update public.ai_recommendations
    set status = 'expired', updated_at = now()
    where organization_id = p_organization_id
      and status in ('proposed', 'approved')
      and rule_version = p_rule_version
      and (
        not (dedupe_key = any(v_active_recommendation_keys))
        or (expires_at is not null and expires_at < p_as_of)
      )
      and (p_location_id is null or location_id = p_location_id or location_id is null)
    returning id
  )
  select count(*), coalesce(array_agg(id), array[]::uuid[])
  into v_recommendations_expired, v_expired_recommendation_ids
  from expired;

  if array_length(v_expired_recommendation_ids, 1) > 0 then
    update public.ai_approvals
    set status = 'expired', updated_at = now()
    where recommendation_id = any(v_expired_recommendation_ids)
      and status = 'pending';
  end if;

  -- 4b. Expire approvals whose own expires_at has passed even though the
  -- underlying signal is still active (nobody decided in time), cascading
  -- their still-proposed recommendation.
  with approval_expired as (
    update public.ai_approvals
    set status = 'expired', updated_at = now()
    where organization_id = p_organization_id
      and status = 'pending'
      and expires_at is not null
      and expires_at < p_as_of
    returning recommendation_id
  )
  update public.ai_recommendations r
  set status = 'expired', updated_at = now()
  from approval_expired a
  where r.id = a.recommendation_id and r.status = 'proposed';

  get diagnostics v_approvals_expired = row_count;

  -- 5. Audit the evaluation run itself (skipped for unattended/service-role
  -- invocations with no JWT, same convention as calculate_daily_kpi_snapshot).
  if auth.uid() is not null then
    perform public.record_audit_event(
      p_organization_id,
      'ai_evaluation.applied',
      'ai_evaluation',
      null,
      jsonb_build_object(
        'as_of', p_as_of,
        'rule_version', p_rule_version,
        'location_id', p_location_id,
        'signals_upserted', v_signals_upserted,
        'signals_resolved', v_signals_resolved,
        'recommendations_upserted', v_recommendations_upserted,
        'recommendations_expired', v_recommendations_expired,
        'approvals_expired', v_approvals_expired
      )
    );
  end if;

  return jsonb_build_object(
    'signals_upserted', v_signals_upserted,
    'signals_resolved', v_signals_resolved,
    'recommendations_upserted', v_recommendations_upserted,
    'recommendations_expired', v_recommendations_expired,
    'approvals_expired', v_approvals_expired
  );
end;
$$;

revoke all on function public.apply_ai_evaluation(uuid, uuid, timestamptz, text, jsonb) from public;
grant execute on function public.apply_ai_evaluation(uuid, uuid, timestamptz, text, jsonb) to authenticated;

comment on function public.apply_ai_evaluation(uuid, uuid, timestamptz, text, jsonb) is
  'Single transactional apply of one deterministic evaluation run: upserts signals, resolves stale ones, upserts recommendations + evidence, expires obsolete recommendations/approvals, writes one audit event. Idempotent per (organization_id, location_id, as_of, rule_version, dedupe keys). See lib/ai/evaluate.ts.';

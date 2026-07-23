-- Phase 4A: RLS for the AI Executive tables. Same pattern as every prior
-- phase: RLS enabled + forced, every policy derived from has_permission().
--
-- Per issue #18 decisions #2 and #9, six of the seven tables get NO
-- authenticated INSERT/UPDATE/DELETE policy at all — every write to
-- ai_signals, ai_recommendations, ai_recommendation_evidence, ai_approvals,
-- ai_action_attempts, and ai_outcomes happens exclusively through the
-- SECURITY DEFINER functions in 20260723000007/20260723000008. This is the
-- same append-only-via-function pattern audit_logs and daily_kpi_snapshots
-- already established — RLS SELECT policies below are what a normal
-- authenticated user can do with these tables; everything else requires
-- going through a function that does its own internal permission check.
--
-- ai_rule_configs is the one exception: it's current-state *configuration*,
-- not history, so authenticated users with ai.recommendations.manage can
-- write it directly (audited by a dedicated trigger, not by being
-- function-mediated).

-- ai_rule_configs --------------------------------------------------------

alter table public.ai_rule_configs enable row level security;
alter table public.ai_rule_configs force row level security;

create policy "ai_rule_configs_select_authorized" on public.ai_rule_configs
for select to authenticated
using (public.has_permission(organization_id, 'ai.executive.read'));

create policy "ai_rule_configs_insert_authorized" on public.ai_rule_configs
for insert to authenticated
with check (public.has_permission(organization_id, 'ai.recommendations.manage'));

create policy "ai_rule_configs_update_authorized" on public.ai_rule_configs
for update to authenticated
using (public.has_permission(organization_id, 'ai.recommendations.manage'))
with check (public.has_permission(organization_id, 'ai.recommendations.manage'));

-- No DELETE policy: a config is disabled via enabled = false, preserving its
-- prior threshold values and audit trail.

-- ai_signals ---------------------------------------------------------------

alter table public.ai_signals enable row level security;
alter table public.ai_signals force row level security;

create policy "ai_signals_select_authorized" on public.ai_signals
for select to authenticated
using (public.has_permission(organization_id, 'ai.executive.read'));

-- ai_recommendations ---------------------------------------------------------

alter table public.ai_recommendations enable row level security;
alter table public.ai_recommendations force row level security;

create policy "ai_recommendations_select_authorized" on public.ai_recommendations
for select to authenticated
using (public.has_permission(organization_id, 'ai.executive.read'));

-- ai_recommendation_evidence ---------------------------------------------------
-- Finance-sensitive evidence is invisible to viewers without finance.read —
-- a database guarantee, not a UI convention that can be forgotten to redact.

alter table public.ai_recommendation_evidence enable row level security;
alter table public.ai_recommendation_evidence force row level security;

create policy "ai_recommendation_evidence_select_authorized" on public.ai_recommendation_evidence
for select to authenticated
using (
  public.has_permission(organization_id, 'ai.executive.read')
  and (not is_finance_sensitive or public.has_permission(organization_id, 'finance.read'))
);

-- ai_approvals ------------------------------------------------------------------

alter table public.ai_approvals enable row level security;
alter table public.ai_approvals force row level security;

create policy "ai_approvals_select_authorized" on public.ai_approvals
for select to authenticated
using (public.has_permission(organization_id, 'ai.executive.read'));

-- ai_action_attempts ---------------------------------------------------------------

alter table public.ai_action_attempts enable row level security;
alter table public.ai_action_attempts force row level security;

create policy "ai_action_attempts_select_authorized" on public.ai_action_attempts
for select to authenticated
using (public.has_permission(organization_id, 'ai.executive.read'));

-- ai_outcomes -----------------------------------------------------------------------

alter table public.ai_outcomes enable row level security;
alter table public.ai_outcomes force row level security;

create policy "ai_outcomes_select_authorized" on public.ai_outcomes
for select to authenticated
using (public.has_permission(organization_id, 'ai.executive.read'));

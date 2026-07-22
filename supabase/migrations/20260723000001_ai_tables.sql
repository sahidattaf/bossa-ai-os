-- Phase 4A: AI Executive schema (issue #18, scope "Database and security").
-- Every table carries organization_id. Cross-references use the same
-- composite-FK-against-(organization_id, id) pattern Phase 3 established, so
-- "belongs to the same organization" is a schema-level guarantee wherever a
-- single target table exists. source_entity_id/source_entity_type on
-- ai_signals/ai_recommendation_evidence are the one polymorphic exception
-- (a lead, reservation, order, order_item, or daily_kpi_snapshot) — no single
-- FK can express that, so 20260723000002 adds a validation trigger instead.

-- ai_rule_configs ------------------------------------------------------------
-- Tenant-scoped threshold *overrides* only. Secure defaults live in
-- lib/ai/rules/*.ts, not as a nullable-organization "platform default" row —
-- every row here is a real, tenant-owned override, keeping RLS uniform with
-- every other table (no nullable-organization_id special case).

create table if not exists public.ai_rule_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  rule_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id)
);

create unique index if not exists idx_ai_rule_configs_org_loc_rule on public.ai_rule_configs (
  organization_id,
  coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
  rule_key
);

drop trigger if exists set_ai_rule_configs_updated_at on public.ai_rule_configs;
create trigger set_ai_rule_configs_updated_at
before update on public.ai_rule_configs
for each row execute function public.set_updated_at();

-- ai_signals ------------------------------------------------------------------
-- A signal is a continuously re-evaluated gauge, not a discrete event: the
-- same dedupe_key always upserts the same row, flipping status in place
-- across evaluation runs, rather than accumulating a new row every time.

create table if not exists public.ai_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  signal_type text not null,
  source_entity_type text check (source_entity_type in ('lead', 'reservation', 'order', 'order_item', 'daily_kpi_snapshot')),
  source_entity_id uuid,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null,
  facts jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  dedupe_key text not null,
  status text not null default 'active' check (status in ('active', 'resolved', 'suppressed')),
  rule_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id),
  check ((source_entity_type is null) = (source_entity_id is null)),
  unique (organization_id, dedupe_key)
);

create index if not exists idx_ai_signals_organization_id on public.ai_signals(organization_id);
create index if not exists idx_ai_signals_status on public.ai_signals(organization_id, status);

drop trigger if exists set_ai_signals_updated_at on public.ai_signals;
create trigger set_ai_signals_updated_at
before update on public.ai_signals
for each row execute function public.set_updated_at();

-- ai_recommendations -----------------------------------------------------------
-- payload_hash is the server-controlled, tamper-evident anchor for the whole
-- approval/execution flow (issue decision #5): a STORED GENERATED column, so
-- Postgres itself refuses any client-supplied value, computed from this row's
-- own id + organization_id + action type/schema version + canonical payload
-- — never from the payload alone, so a byte-identical payload can never be
-- replayed against a different recommendation or action type.
--
-- The partial unique index (not a plain one) is what makes "repeated
-- evaluation must not create duplicate *active* recommendations" precise: a
-- recommendation legitimately recurs once its predecessor is no longer open
-- (completed/failed/rejected/expired/dismissed).

create table if not exists public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  recommendation_type text not null,
  title text not null,
  executive_summary text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  priority_score integer not null default 0 check (priority_score between 0 and 100),
  recommended_action_type text not null check (recommended_action_type in (
    'assign_lead_owner', 'change_lead_status', 'confirm_reservation', 'cancel_reservation',
    'change_order_status', 'change_order_payment_status', 'regenerate_kpi_snapshot', 'navigate'
  )),
  action_schema_version text not null default 'v1',
  recommended_action_payload jsonb not null default '{}'::jsonb,
  payload_hash text generated always as (
    encode(
      digest(
        id::text || '|' || organization_id::text || '|' || recommended_action_type || '|' ||
        action_schema_version || '|' || recommended_action_payload::text,
        'sha256'
      ),
      'hex'
    )
  ) stored,
  expected_benefit text,
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  requires_approval boolean not null default true,
  rule_id text not null,
  rule_version text not null,
  status text not null default 'proposed' check (status in (
    'proposed', 'approved', 'rejected', 'expired', 'executing', 'completed', 'failed', 'dismissed'
  )),
  dedupe_key text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id),
  unique (organization_id, id)
);

create index if not exists idx_ai_recommendations_organization_id on public.ai_recommendations(organization_id);
create index if not exists idx_ai_recommendations_status on public.ai_recommendations(organization_id, status);

create unique index if not exists idx_ai_recommendations_org_dedupe_open on public.ai_recommendations (organization_id, dedupe_key)
where status in ('proposed', 'approved', 'executing');

drop trigger if exists set_ai_recommendations_updated_at on public.ai_recommendations;
create trigger set_ai_recommendations_updated_at
before update on public.ai_recommendations
for each row execute function public.set_updated_at();

-- ai_recommendation_evidence -----------------------------------------------------
-- unique(recommendation_id, metric_name) is what lets a re-evaluation
-- "replace/update evidence safely" via a plain upsert rather than a
-- delete-then-insert that would leave a transient evidence-less window.

create table if not exists public.ai_recommendation_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_id uuid not null,
  metric_name text not null,
  observed_value jsonb not null,
  expected_value jsonb,
  source_entity_type text check (source_entity_type in ('lead', 'reservation', 'order', 'order_item', 'daily_kpi_snapshot')),
  source_entity_id uuid,
  calculation_definition text not null,
  is_finance_sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (organization_id, recommendation_id) references public.ai_recommendations(organization_id, id) on delete cascade,
  check ((source_entity_type is null) = (source_entity_id is null)),
  unique (recommendation_id, metric_name)
);

create index if not exists idx_ai_recommendation_evidence_recommendation_id on public.ai_recommendation_evidence(recommendation_id);
create index if not exists idx_ai_recommendation_evidence_organization_id on public.ai_recommendation_evidence(organization_id);

-- ai_approvals -------------------------------------------------------------------
-- Exactly one approval row per recommendation (unique(recommendation_id)).
-- version is the optimistic-concurrency guard; payload_hash_at_decision is
-- captured server-side at decision time and compared against the
-- recommendation's *current* payload_hash at execution time — a mismatch
-- means the recommendation was refreshed after approval, and execution must
-- be refused.

create table if not exists public.ai_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_by_user_id uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  reason text,
  payload_hash_at_decision text,
  version integer not null default 1,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, recommendation_id) references public.ai_recommendations(organization_id, id) on delete cascade,
  unique (organization_id, id),
  unique (recommendation_id)
);

create index if not exists idx_ai_approvals_organization_id on public.ai_approvals(organization_id);
create index if not exists idx_ai_approvals_status on public.ai_approvals(organization_id, status);

drop trigger if exists set_ai_approvals_updated_at on public.ai_approvals;
create trigger set_ai_approvals_updated_at
before update on public.ai_approvals
for each row execute function public.set_updated_at();

-- ai_action_attempts ---------------------------------------------------------------
-- Append-only (no authenticated UPDATE/DELETE policy anywhere — see
-- 20260723000005), same pattern as audit_logs. Retry-safety comes from
-- checking, before executing, whether a 'succeeded' row already exists for
-- this (recommendation_id, payload_hash) pair.

create table if not exists public.ai_action_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_id uuid not null,
  approval_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  action_payload jsonb not null,
  payload_hash text not null,
  result_status text not null check (result_status in ('succeeded', 'failed')),
  result_detail jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  attempted_at timestamptz not null default now(),
  duration_ms integer,
  foreign key (organization_id, recommendation_id) references public.ai_recommendations(organization_id, id),
  foreign key (organization_id, approval_id) references public.ai_approvals(organization_id, id),
  unique (organization_id, id)
);

create index if not exists idx_ai_action_attempts_organization_id on public.ai_action_attempts(organization_id);
create index if not exists idx_ai_action_attempts_retry_lookup on public.ai_action_attempts(recommendation_id, payload_hash, result_status);

-- ai_outcomes -----------------------------------------------------------------------

create table if not exists public.ai_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_id uuid not null,
  action_attempt_id uuid,
  status text not null default 'pending' check (status in (
    'pending', 'successful', 'partially_successful', 'failed', 'cancelled', 'unknown'
  )),
  measured_at timestamptz,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  outcome_metrics jsonb not null default '{}'::jsonb,
  human_notes text,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, recommendation_id) references public.ai_recommendations(organization_id, id),
  foreign key (organization_id, action_attempt_id) references public.ai_action_attempts(organization_id, id),
  unique (recommendation_id)
);

create index if not exists idx_ai_outcomes_organization_id on public.ai_outcomes(organization_id);

drop trigger if exists set_ai_outcomes_updated_at on public.ai_outcomes;
create trigger set_ai_outcomes_updated_at
before update on public.ai_outcomes
for each row execute function public.set_updated_at();

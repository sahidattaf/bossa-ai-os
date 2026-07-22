-- Phase 4A: base table privileges for `authenticated`. RLS restricts which
-- rows; Postgres checks ordinary GRANTs first — the lesson every prior
-- phase's CI run has independently confirmed. Only ai_rule_configs gets a
-- write grant; every other AI table is select-only, matching the
-- function-mediated-write design in 20260723000005's header comment.

grant usage on schema public to authenticated;

grant select, insert, update on public.ai_rule_configs to authenticated;
grant select on public.ai_signals to authenticated;
grant select on public.ai_recommendations to authenticated;
grant select on public.ai_recommendation_evidence to authenticated;
grant select on public.ai_approvals to authenticated;
grant select on public.ai_action_attempts to authenticated;
grant select on public.ai_outcomes to authenticated;

-- ai_rule_configs is the one AI table with direct authenticated writes
-- (issue #18 decision #9 explicitly excludes it from the function-mediated
-- list), so "audit every configuration change" is enforced here by a
-- dedicated trigger rather than by routing writes through a function.
create or replace function public.audit_ai_rule_config_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.record_audit_event(
    new.organization_id,
    case when tg_op = 'INSERT' then 'ai_rule_config.created' else 'ai_rule_config.updated' end,
    'ai_rule_config',
    new.id,
    jsonb_build_object(
      'rule_key', new.rule_key,
      'location_id', new.location_id,
      'enabled', new.enabled,
      'config', new.config,
      'previous_config', case when tg_op = 'UPDATE' then old.config else null end
    )
  );
  return new;
end;
$$;

revoke all on function public.audit_ai_rule_config_change() from public;

drop trigger if exists audit_ai_rule_configs_change on public.ai_rule_configs;
create trigger audit_ai_rule_configs_change
after insert or update on public.ai_rule_configs
for each row execute function public.audit_ai_rule_config_change();

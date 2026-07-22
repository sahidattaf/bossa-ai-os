-- Phase 4A: two new permission keys added to Phase 2's existing global
-- catalog (no new tables — role_permissions already models exactly this).
-- ai.actions.approve already exists (added in Phase 2 for this exact
-- purpose) and needs no changes here.

insert into public.permissions (key, description) values
  ('ai.executive.read', 'View the AI Executive workspace: signals, recommendations, evidence, approvals, and outcomes.'),
  ('ai.recommendations.manage', 'Configure AI rule thresholds, dismiss recommendations, and trigger manual re-evaluation.')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  -- ai.executive.read mirrors dashboard.read's existing holder set exactly —
  -- visibility into the AI Executive workspace is as broad as the dashboard
  -- itself; finance-sensitive evidence is separately redacted by RLS
  -- regardless of this permission (see 20260723000005).
  ('organization_owner', 'ai.executive.read'),
  ('general_manager', 'ai.executive.read'),
  ('finance_manager', 'ai.executive.read'),
  ('operations_manager', 'ai.executive.read'),
  ('marketing_manager', 'ai.executive.read'),
  ('staff', 'ai.executive.read'),
  ('viewer', 'ai.executive.read'),

  -- ai.recommendations.manage mirrors ai.actions.approve's holder set —
  -- rule configuration and recommendation dismissal are as high-trust as
  -- approving an action.
  ('organization_owner', 'ai.recommendations.manage'),
  ('general_manager', 'ai.recommendations.manage')
) as grants(role_key, permission_key)
join public.roles r on r.key = grants.role_key
join public.permissions p on p.key = grants.permission_key
on conflict do nothing;

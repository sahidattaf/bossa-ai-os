-- Phase 4A: status machines for ai_recommendations.status and
-- ai_approvals.status, reusing Phase 3's generic
-- enforce_status_transition()/audit_status_transition() trigger functions
-- verbatim — no new trigger *functions* needed, only new status_transitions
-- rows and two new machine wirings. See
-- docs/AI_APPROVAL_AND_ACTION_SECURITY.md for the full state diagrams.
--
-- Even though every mutation of these columns happens exclusively through
-- the SECURITY DEFINER functions in 20260723000006 (issue decision #2/#9),
-- these triggers still fire on those functions' own UPDATEs — a second,
-- independent guard against a bug in that function logic ever performing an
-- illegal transition, and the source of the exactly-one audit event per
-- transition.

insert into public.status_transitions (machine, from_status, to_status) values
  -- recommendation_status: proposed -> approved|rejected|expired|dismissed;
  -- approved -> executing|dismissed|proposed (reopened); executing ->
  -- completed|failed; failed -> executing (retry).
  -- completed/rejected/expired/dismissed are terminal.
  ('recommendation_status', 'proposed', 'approved'),
  ('recommendation_status', 'proposed', 'rejected'),
  ('recommendation_status', 'proposed', 'expired'),
  ('recommendation_status', 'proposed', 'dismissed'),
  ('recommendation_status', 'approved', 'executing'),
  ('recommendation_status', 'approved', 'dismissed'),
  -- A re-evaluation that materially changes an already-approved
  -- recommendation's payload reopens it for a fresh decision — the
  -- previously-approved action no longer matches what would be approved
  -- now. See apply_ai_evaluation()'s reopening step (20260723000009).
  ('recommendation_status', 'approved', 'proposed'),
  ('recommendation_status', 'executing', 'completed'),
  ('recommendation_status', 'executing', 'failed'),
  ('recommendation_status', 'failed', 'executing'),

  -- approval_status: pending -> approved|rejected|expired; approved ->
  -- pending (reopened alongside its recommendation, same trigger as above).
  -- rejected/expired are terminal.
  ('approval_status', 'pending', 'approved'),
  ('approval_status', 'pending', 'rejected'),
  ('approval_status', 'pending', 'expired'),
  ('approval_status', 'approved', 'pending')
on conflict do nothing;

drop trigger if exists enforce_ai_recommendations_status_transition on public.ai_recommendations;
create trigger enforce_ai_recommendations_status_transition
before update of status on public.ai_recommendations
for each row execute function public.enforce_status_transition('recommendation_status', 'status');

drop trigger if exists audit_ai_recommendations_status_transition on public.ai_recommendations;
create trigger audit_ai_recommendations_status_transition
after update of status on public.ai_recommendations
for each row execute function public.audit_status_transition('status', 'ai_recommendation', 'ai_recommendation.status_changed');

drop trigger if exists enforce_ai_approvals_status_transition on public.ai_approvals;
create trigger enforce_ai_approvals_status_transition
before update of status on public.ai_approvals
for each row execute function public.enforce_status_transition('approval_status', 'status');

drop trigger if exists audit_ai_approvals_status_transition on public.ai_approvals;
create trigger audit_ai_approvals_status_transition
after update of status on public.ai_approvals
for each row execute function public.audit_status_transition('status', 'ai_approval', 'ai_approval.status_changed');

-- Phase 3A: status machines (issue #16 rule 5 — "CHECK constraints for
-- possible values are not sufficient by themselves"). CHECK constraints in
-- 20260722000001 already fence in the *set* of valid values; this migration
-- fences in valid *transitions* between them, and separately guarantees every
-- material transition is audited (rule 1). Both concerns are handled by one
-- generic, table-driven mechanism reused across leads/reservations/orders
-- instead of four near-duplicate hand-written trigger functions.

-- The transition rulebook itself — documented here and mirrored in
-- docs/ORDER_RESERVATION_LEAD_WORKFLOWS.md. `machine` groups rows by which
-- status column they govern (a table can have more than one, e.g. orders has
-- both order_status and order_payment_status).
create table if not exists public.status_transitions (
  machine text not null,
  from_status text not null,
  to_status text not null,
  primary key (machine, from_status, to_status)
);

comment on table public.status_transitions is
  'Allow-list of valid status transitions per machine. Enforced by public.enforce_status_transition(); see docs/ORDER_RESERVATION_LEAD_WORKFLOWS.md.';

insert into public.status_transitions (machine, from_status, to_status) values
  -- lead_status: new -> contacted -> qualified -> converted. A lead can also
  -- convert straight from contacted (not every lead needs a distinct
  -- "qualified" step — e.g. a WhatsApp lead that immediately books), and
  -- "lost" is reachable from any non-terminal state. converted/lost are
  -- terminal.
  ('lead_status', 'new', 'contacted'),
  ('lead_status', 'new', 'lost'),
  ('lead_status', 'contacted', 'qualified'),
  ('lead_status', 'contacted', 'converted'),
  ('lead_status', 'contacted', 'lost'),
  ('lead_status', 'qualified', 'converted'),
  ('lead_status', 'qualified', 'lost'),

  -- reservation_status: pending -> confirmed -> seated -> completed, with
  -- cancellation/no-show off-ramps. completed/cancelled/no_show are terminal.
  ('reservation_status', 'pending', 'confirmed'),
  ('reservation_status', 'pending', 'cancelled'),
  ('reservation_status', 'confirmed', 'seated'),
  ('reservation_status', 'confirmed', 'cancelled'),
  ('reservation_status', 'confirmed', 'no_show'),
  ('reservation_status', 'seated', 'completed'),

  -- order_status: pending -> confirmed -> preparing -> ready -> (completed or
  -- out_for_delivery -> completed). cancellation allowed until preparing
  -- starts. completed/cancelled are terminal.
  ('order_status', 'pending', 'confirmed'),
  ('order_status', 'pending', 'cancelled'),
  ('order_status', 'confirmed', 'preparing'),
  ('order_status', 'confirmed', 'cancelled'),
  ('order_status', 'preparing', 'ready'),
  ('order_status', 'preparing', 'cancelled'),
  ('order_status', 'ready', 'out_for_delivery'),
  ('order_status', 'ready', 'completed'),
  ('order_status', 'out_for_delivery', 'completed'),

  -- order_payment_status: unpaid -> partially_paid|paid, either -> refunded.
  -- refunded is terminal.
  ('order_payment_status', 'unpaid', 'partially_paid'),
  ('order_payment_status', 'unpaid', 'paid'),
  ('order_payment_status', 'partially_paid', 'paid'),
  ('order_payment_status', 'partially_paid', 'refunded'),
  ('order_payment_status', 'paid', 'refunded')
on conflict do nothing;

alter table public.status_transitions enable row level security;
alter table public.status_transitions force row level security;

create policy "status_transitions_select_all_authenticated" on public.status_transitions
for select to authenticated using (true);

-- No authenticated write policy: the rulebook is migration-managed, exactly
-- like roles/permissions/role_permissions in Phase 2.

-- Generic BEFORE UPDATE trigger: rejects a status change that isn't a
-- registered (from_status -> to_status) pair for the given machine. A no-op
-- update (old = new) is always allowed regardless of the rulebook. Message is
-- prefixed "INVALID_STATUS_TRANSITION:" so the application's typed error
-- layer (lib/errors) can map it deterministically instead of pattern-matching
-- arbitrary text.
create or replace function public.enforce_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_machine text := tg_argv[0];
  v_column text := tg_argv[1];
  v_old_status text;
  v_new_status text;
begin
  v_old_status := to_jsonb(old) ->> v_column;
  v_new_status := to_jsonb(new) ->> v_column;

  if v_old_status is distinct from v_new_status then
    if not exists (
      select 1 from public.status_transitions
      where machine = v_machine and from_status = v_old_status and to_status = v_new_status
    ) then
      raise exception 'INVALID_STATUS_TRANSITION: % cannot go from "%" to "%"', v_machine, v_old_status, v_new_status;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_status_transition() from public;

comment on function public.enforce_status_transition() is
  'Generic BEFORE UPDATE trigger. Args: (machine, status_column). Rejects any status change not listed in public.status_transitions.';

-- Generic AFTER UPDATE trigger: records exactly one audit event per actual
-- status change, via the same record_audit_event() every other audited
-- mutation in this project uses (Phase 2's audit_logs is append-only and
-- function-mediated). Runs only after enforce_status_transition has already
-- validated the change, so every audited transition is by construction a
-- legal one.
create or replace function public.audit_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_column text := tg_argv[0];
  v_entity_type text := tg_argv[1];
  v_action text := tg_argv[2];
  v_old_status text;
  v_new_status text;
begin
  v_old_status := to_jsonb(old) ->> v_column;
  v_new_status := to_jsonb(new) ->> v_column;

  if v_old_status is distinct from v_new_status then
    perform public.record_audit_event(
      new.organization_id,
      v_action,
      v_entity_type,
      new.id,
      jsonb_build_object('from_status', v_old_status, 'to_status', v_new_status)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.audit_status_transition() from public;

comment on function public.audit_status_transition() is
  'Generic AFTER UPDATE trigger. Args: (status_column, entity_type, audit_action). Writes one audit_logs row per actual status change via record_audit_event().';

-- leads.status ---------------------------------------------------------------

drop trigger if exists enforce_leads_status_transition on public.leads;
create trigger enforce_leads_status_transition
before update of status on public.leads
for each row execute function public.enforce_status_transition('lead_status', 'status');

drop trigger if exists audit_leads_status_transition on public.leads;
create trigger audit_leads_status_transition
after update of status on public.leads
for each row execute function public.audit_status_transition('status', 'lead', 'lead.status_changed');

-- reservations.status ---------------------------------------------------------

drop trigger if exists enforce_reservations_status_transition on public.reservations;
create trigger enforce_reservations_status_transition
before update of status on public.reservations
for each row execute function public.enforce_status_transition('reservation_status', 'status');

drop trigger if exists audit_reservations_status_transition on public.reservations;
create trigger audit_reservations_status_transition
after update of status on public.reservations
for each row execute function public.audit_status_transition('status', 'reservation', 'reservation.status_changed');

-- orders.status and orders.payment_status ------------------------------------

drop trigger if exists enforce_orders_status_transition on public.orders;
create trigger enforce_orders_status_transition
before update of status on public.orders
for each row execute function public.enforce_status_transition('order_status', 'status');

drop trigger if exists audit_orders_status_transition on public.orders;
create trigger audit_orders_status_transition
after update of status on public.orders
for each row execute function public.audit_status_transition('status', 'order', 'order.status_changed');

drop trigger if exists enforce_orders_payment_status_transition on public.orders;
create trigger enforce_orders_payment_status_transition
before update of payment_status on public.orders
for each row execute function public.enforce_status_transition('order_payment_status', 'payment_status');

drop trigger if exists audit_orders_payment_status_transition on public.orders;
create trigger audit_orders_payment_status_transition
after update of payment_status on public.orders
for each row execute function public.audit_status_transition('payment_status', 'order', 'order.payment_status_changed');

"use client";

import { useActionState } from "react";

export interface InlineStatusActionState {
  error?: string;
}

export interface InlineStatusFormProps {
  action: (prevState: InlineStatusActionState, formData: FormData) => Promise<InlineStatusActionState>;
  hiddenFields: Record<string, string>;
  statusFieldName?: string;
  currentStatus: string;
  options: readonly string[];
}

const initialState: InlineStatusActionState = {};

/**
 * A status <select> that submits itself on change. Shared across
 * leads/reservations/orders(status)/orders(payment_status) — the only thing
 * that differs between domains is which hidden fields identify the row and
 * which server action + option list back it. An illegal transition comes
 * back as this action's OperationalError message (INVALID_STATUS_TRANSITION
 * from the database trigger), rendered inline rather than silently reverting.
 */
export function InlineStatusForm({
  action,
  hiddenFields,
  statusFieldName = "status",
  currentStatus,
  options,
}: InlineStatusFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {Object.entries(hiddenFields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <select
          name={statusFieldName}
          defaultValue={currentStatus}
          disabled={isPending}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

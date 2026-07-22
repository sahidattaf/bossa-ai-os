"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

export interface DismissActionState {
  error?: string;
}

const initialState: DismissActionState = {};

export interface DismissButtonProps {
  dismissAction: (prevState: DismissActionState, formData: FormData) => Promise<DismissActionState>;
  organizationSlug: string;
  recommendationId: string;
}

export function DismissButton({ dismissAction, organizationSlug, recommendationId }: DismissButtonProps) {
  const [state, formAction, isPending] = useActionState(dismissAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="recommendationId" value={recommendationId} />
      <Button type="submit" variant="outline" size="sm" className="w-fit" disabled={isPending}>
        {isPending ? "Dismissing…" : "Dismiss"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

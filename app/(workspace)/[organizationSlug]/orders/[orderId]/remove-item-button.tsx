"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { removeOrderItemAction, type OrderActionState } from "../actions";

const initialState: OrderActionState = {};

export function RemoveItemButton({
  organizationSlug,
  orderId,
  orderItemId,
}: {
  organizationSlug: string;
  orderId: string;
  orderItemId: string;
}) {
  const [state, formAction, isPending] = useActionState(removeOrderItemAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="orderItemId" value={orderItemId} />
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Removing…" : "Remove"}
      </Button>
      {state.error ? <p className="mt-1 text-xs text-danger">{state.error}</p> : null}
    </form>
  );
}

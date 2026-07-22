"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { addOrderItemAction, type OrderActionState } from "../actions";

const initialState: OrderActionState = {};

export function AddItemForm({ organizationSlug, orderId }: { organizationSlug: string; orderId: string }) {
  const [state, formAction, isPending] = useActionState(addOrderItemAction, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,auto,auto,auto]">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="orderId" value={orderId} />
      <Input name="itemName" placeholder="Item name" required maxLength={200} />
      <Input name="quantity" type="number" min={1} defaultValue={1} className="sm:w-24" required />
      <Input name="unitPrice" type="number" min={0} step="0.01" placeholder="Unit price" className="sm:w-28" required />
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Adding…" : "Add item"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-xs text-danger sm:col-span-4">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

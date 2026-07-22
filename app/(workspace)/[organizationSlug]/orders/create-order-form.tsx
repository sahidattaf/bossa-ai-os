"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ORDER_CHANNELS, ORDER_FULFILLMENT_TYPES } from "@/lib/operations/status";

import { createOrderAction, type OrderActionState } from "./actions";

const initialState: OrderActionState = {};

interface DraftItem {
  itemName: string;
  quantity: number;
  unitPrice: number;
}

const EMPTY_ITEM: DraftItem = { itemName: "", quantity: 1, unitPrice: 0 };

export function CreateOrderForm({
  organizationSlug,
  locations,
}: {
  organizationSlug: string;
  locations: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(createOrderAction, initialState);
  const [items, setItems] = useState<DraftItem[]>([{ ...EMPTY_ITEM }]);

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="customerName" className="text-xs font-medium text-muted-foreground">
            Customer name
          </label>
          <Input id="customerName" name="customerName" required maxLength={200} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="text-xs font-medium text-muted-foreground">
            Phone (optional)
          </label>
          <Input id="phone" name="phone" maxLength={50} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="orderNumber" className="text-xs font-medium text-muted-foreground">
            Order number
          </label>
          <Input id="orderNumber" name="orderNumber" required maxLength={50} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="locationId" className="text-xs font-medium text-muted-foreground">
            Location
          </label>
          <select
            id="locationId"
            name="locationId"
            required
            defaultValue={locations[0]?.id ?? ""}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="channel" className="text-xs font-medium text-muted-foreground">
            Channel
          </label>
          <select
            id="channel"
            name="channel"
            required
            defaultValue={ORDER_CHANNELS[0]}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {ORDER_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {channel.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="fulfillmentType" className="text-xs font-medium text-muted-foreground">
            Fulfillment
          </label>
          <select
            id="fulfillmentType"
            name="fulfillmentType"
            required
            defaultValue={ORDER_FULFILLMENT_TYPES[0]}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {ORDER_FULFILLMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">Items</span>
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,auto,auto,auto]">
            <Input
              placeholder="Item name"
              value={item.itemName}
              onChange={(event) => updateItem(index, { itemName: event.target.value })}
              required
            />
            <Input
              type="number"
              min={1}
              className="sm:w-24"
              placeholder="Qty"
              value={item.quantity}
              onChange={(event) => updateItem(index, { quantity: Number(event.target.value) })}
              required
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              className="sm:w-28"
              placeholder="Unit price"
              value={item.unitPrice}
              onChange={(event) => updateItem(index, { unitPrice: Number(event.target.value) })}
              required
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={items.length === 1}
              onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-fit"
          onClick={() => setItems((current) => [...current, { ...EMPTY_ITEM }])}
        >
          Add item
        </Button>
        <p className="text-xs text-muted-foreground">
          Estimated subtotal: {subtotal.toFixed(2)} — the database computes the authoritative total.
        </p>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={isPending || locations.length === 0}>
          {isPending ? "Creating order…" : "Create order"}
        </Button>
      </div>
    </form>
  );
}

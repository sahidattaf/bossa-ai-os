"use client";

import { useActionState } from "react";

import {
  convertLeadToOrderAction,
  convertLeadToReservationAction,
  type LeadActionState,
} from "@/app/(workspace)/[organizationSlug]/crm/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LEAD_SOURCES, ORDER_CHANNELS, ORDER_FULFILLMENT_TYPES } from "@/lib/operations/status";

const initialState: LeadActionState = {};

export interface LeadConversionActionsProps {
  organizationSlug: string;
  leadId: string;
  leadStatus: string;
  contactName: string;
  phone: string;
  /** Already accounts for both crm.write and the lead's current status. */
  canConvertToReservation: boolean;
  canConvertToOrder: boolean;
  locations: { id: string; name: string }[];
}

/**
 * Renders "Convert to Reservation" / "Convert to Order" only when the lead's
 * current status and the caller's permissions both allow it (issue #16
 * CRM acceptance criterion) — the actual duplicate-conversion guarantee is
 * server-side (lib/operations/conversions.ts's optimistic-lock claim), this
 * is just the UI reflecting what would legally succeed.
 */
export function LeadConversionActions({
  organizationSlug,
  leadId,
  contactName,
  phone,
  canConvertToReservation,
  canConvertToOrder,
  locations,
}: LeadConversionActionsProps) {
  if (!canConvertToReservation && !canConvertToOrder) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canConvertToReservation ? (
        <ConvertToReservationDialog
          organizationSlug={organizationSlug}
          leadId={leadId}
          contactName={contactName}
          phone={phone}
          locations={locations}
        />
      ) : null}
      {canConvertToOrder ? (
        <ConvertToOrderDialog
          organizationSlug={organizationSlug}
          leadId={leadId}
          contactName={contactName}
          phone={phone}
          locations={locations}
        />
      ) : null}
    </div>
  );
}

function ConvertToReservationDialog({
  organizationSlug,
  leadId,
  contactName,
  phone,
  locations,
}: Omit<LeadConversionActionsProps, "canConvertToReservation" | "canConvertToOrder" | "leadStatus">) {
  const [state, formAction, isPending] = useActionState(convertLeadToReservationAction, initialState);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Convert to reservation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert lead to reservation</DialogTitle>
          <DialogDescription>Books {contactName} in and marks this lead as converted.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="organizationSlug" value={organizationSlug} />
          <input type="hidden" name="leadId" value={leadId} />

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`guestName-${leadId}`} className="text-xs font-medium text-muted-foreground">
              Guest name
            </label>
            <Input id={`guestName-${leadId}`} name="guestName" defaultValue={contactName} required maxLength={200} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`phone-${leadId}`} className="text-xs font-medium text-muted-foreground">
              Phone
            </label>
            <Input id={`phone-${leadId}`} name="phone" defaultValue={phone} required maxLength={50} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`partySize-${leadId}`} className="text-xs font-medium text-muted-foreground">
                Party size
              </label>
              <Input id={`partySize-${leadId}`} name="partySize" type="number" min={1} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`locationId-${leadId}`} className="text-xs font-medium text-muted-foreground">
                Location
              </label>
              <select
                id={`locationId-${leadId}`}
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`reservationDate-${leadId}`} className="text-xs font-medium text-muted-foreground">
                Date
              </label>
              <Input id={`reservationDate-${leadId}`} name="reservationDate" type="date" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`reservationTime-${leadId}`} className="text-xs font-medium text-muted-foreground">
                Time
              </label>
              <Input id={`reservationTime-${leadId}`} name="reservationTime" type="time" required />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`source-${leadId}`} className="text-xs font-medium text-muted-foreground">
              Source
            </label>
            <select
              id={`source-${leadId}`}
              name="source"
              required
              defaultValue={LEAD_SOURCES[0]}
              className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {LEAD_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {source.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}

          <Button type="submit" disabled={isPending || locations.length === 0}>
            {isPending ? "Converting…" : "Convert to reservation"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConvertToOrderDialog({
  organizationSlug,
  leadId,
  contactName,
  phone,
  locations,
}: Omit<LeadConversionActionsProps, "canConvertToReservation" | "canConvertToOrder" | "leadStatus">) {
  const [state, formAction, isPending] = useActionState(convertLeadToOrderAction, initialState);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Convert to order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert lead to order</DialogTitle>
          <DialogDescription>Creates an order for {contactName} and marks this lead as converted.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="organizationSlug" value={organizationSlug} />
          <input type="hidden" name="leadId" value={leadId} />

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`customerName-${leadId}`} className="text-xs font-medium text-muted-foreground">
              Customer name
            </label>
            <Input id={`customerName-${leadId}`} name="customerName" defaultValue={contactName} required maxLength={200} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`orderPhone-${leadId}`} className="text-xs font-medium text-muted-foreground">
              Phone (optional)
            </label>
            <Input id={`orderPhone-${leadId}`} name="phone" defaultValue={phone} maxLength={50} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`orderNumber-${leadId}`} className="text-xs font-medium text-muted-foreground">
              Order number
            </label>
            <Input id={`orderNumber-${leadId}`} name="orderNumber" required maxLength={50} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`orderLocationId-${leadId}`} className="text-xs font-medium text-muted-foreground">
                Location
              </label>
              <select
                id={`orderLocationId-${leadId}`}
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
              <label htmlFor={`channel-${leadId}`} className="text-xs font-medium text-muted-foreground">
                Channel
              </label>
              <select
                id={`channel-${leadId}`}
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
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`fulfillmentType-${leadId}`} className="text-xs font-medium text-muted-foreground">
              Fulfillment
            </label>
            <select
              id={`fulfillmentType-${leadId}`}
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

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,auto,auto]">
            <Input name="itemName" placeholder="Item name" required maxLength={200} />
            <Input name="quantity" type="number" min={1} defaultValue={1} className="sm:w-24" required />
            <Input name="unitPrice" type="number" min={0} step="0.01" placeholder="Unit price" className="sm:w-28" required />
          </div>

          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}

          <Button type="submit" disabled={isPending || locations.length === 0}>
            {isPending ? "Converting…" : "Convert to order"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

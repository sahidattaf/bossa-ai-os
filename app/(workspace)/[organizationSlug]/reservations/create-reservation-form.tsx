"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LEAD_SOURCES } from "@/lib/operations/status";

import { createReservationAction, type ReservationActionState } from "./actions";

const initialState: ReservationActionState = {};

export function CreateReservationForm({
  organizationSlug,
  locations,
}: {
  organizationSlug: string;
  locations: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(createReservationAction, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="guestName" className="text-xs font-medium text-muted-foreground">
          Guest name
        </label>
        <Input id="guestName" name="guestName" required maxLength={200} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="phone" className="text-xs font-medium text-muted-foreground">
          Phone
        </label>
        <Input id="phone" name="phone" required maxLength={50} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="partySize" className="text-xs font-medium text-muted-foreground">
          Party size
        </label>
        <Input id="partySize" name="partySize" type="number" min={1} required />
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
        <label htmlFor="reservationDate" className="text-xs font-medium text-muted-foreground">
          Date
        </label>
        <Input id="reservationDate" name="reservationDate" type="date" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reservationTime" className="text-xs font-medium text-muted-foreground">
          Time
        </label>
        <Input id="reservationTime" name="reservationTime" type="time" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="source" className="text-xs font-medium text-muted-foreground">
          Source
        </label>
        <select
          id="source"
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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-xs font-medium text-muted-foreground">
          Notes (optional)
        </label>
        <Input id="notes" name="notes" maxLength={2000} />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger sm:col-span-2 lg:col-span-4">
          {state.error}
        </p>
      ) : null}

      <div className="sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={isPending || locations.length === 0}>
          {isPending ? "Booking…" : "Book reservation"}
        </Button>
      </div>
    </form>
  );
}

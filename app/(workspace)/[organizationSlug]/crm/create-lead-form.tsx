"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LEAD_SOURCES, LEAD_TYPES } from "@/lib/operations/status";

import { createLeadAction, type LeadActionState } from "./actions";

const initialState: LeadActionState = {};

export function CreateLeadForm({ organizationSlug }: { organizationSlug: string }) {
  const [state, formAction, isPending] = useActionState(createLeadAction, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <input type="hidden" name="organizationSlug" value={organizationSlug} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contactName" className="text-xs font-medium text-muted-foreground">
          Contact name
        </label>
        <Input id="contactName" name="contactName" required maxLength={200} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="phone" className="text-xs font-medium text-muted-foreground">
          Phone
        </label>
        <Input id="phone" name="phone" required maxLength={50} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-xs font-medium text-muted-foreground">
          Email (optional)
        </label>
        <Input id="email" name="email" type="email" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="leadType" className="text-xs font-medium text-muted-foreground">
          Lead type
        </label>
        <select
          id="leadType"
          name="leadType"
          required
          defaultValue={LEAD_TYPES[0]}
          className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {LEAD_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
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
        <label htmlFor="guestCount" className="text-xs font-medium text-muted-foreground">
          Guest count (optional)
        </label>
        <Input id="guestCount" name="guestCount" type="number" min={1} />
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
        <label htmlFor="message" className="text-xs font-medium text-muted-foreground">
          Message (optional)
        </label>
        <Input id="message" name="message" maxLength={2000} />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger sm:col-span-2 lg:col-span-3">
          {state.error}
        </p>
      ) : null}

      <div className="sm:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Adding lead…" : "Add lead"}
        </Button>
      </div>
    </form>
  );
}

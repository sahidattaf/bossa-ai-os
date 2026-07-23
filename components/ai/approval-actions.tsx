"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";

export interface ApprovalActionsState {
  error?: string;
}

const initialState: ApprovalActionsState = {};

export interface ApprovalActionsProps {
  approveAction: (prevState: ApprovalActionsState, formData: FormData) => Promise<ApprovalActionsState>;
  rejectAction: (prevState: ApprovalActionsState, formData: FormData) => Promise<ApprovalActionsState>;
  organizationSlug: string;
  approvalId: string;
  version: number;
}

/**
 * One "Approve & Execute" button in the UI (issue #18 decision #3), but the
 * two form actions it and "Reject" submit to are two entirely separate,
 * durable backend operations (lib/ai/approvals.ts) — this component doesn't
 * collapse them, it just presents them together for a fast reviewer flow.
 * Stacks to full width on narrow screens for the mobile approval flow.
 */
export function ApprovalActions({ approveAction, rejectAction, organizationSlug, approvalId, version }: ApprovalActionsProps) {
  const [approveState, approveFormAction, isApproving] = useActionState(approveAction, initialState);
  const [rejectState, rejectFormAction, isRejecting] = useActionState(rejectAction, initialState);
  const [showReject, setShowReject] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <form action={approveFormAction}>
          <input type="hidden" name="organizationSlug" value={organizationSlug} />
          <input type="hidden" name="approvalId" value={approvalId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <Button type="submit" size="sm" className="w-full sm:w-auto" disabled={isApproving || isRejecting}>
            {isApproving ? "Approving…" : "Approve & Execute"}
          </Button>
        </form>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => setShowReject((value) => !value)}
          disabled={isApproving || isRejecting}
        >
          Reject
        </Button>
      </div>
      {approveState.error ? (
        <p role="alert" className="text-xs text-danger">
          {approveState.error}
        </p>
      ) : null}
      {showReject ? (
        <form action={rejectFormAction} className="flex flex-col gap-2">
          <input type="hidden" name="organizationSlug" value={organizationSlug} />
          <input type="hidden" name="approvalId" value={approvalId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <textarea
            name="reason"
            required
            placeholder="Reason for rejection"
            className="min-h-[60px] rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <Button type="submit" variant="destructive" size="sm" className="w-full sm:w-auto" disabled={isRejecting}>
            {isRejecting ? "Rejecting…" : "Confirm rejection"}
          </Button>
          {rejectState.error ? (
            <p role="alert" className="text-xs text-danger">
              {rejectState.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

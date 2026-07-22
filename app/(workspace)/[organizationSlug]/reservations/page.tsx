import { CalendarCheck } from "lucide-react";

import { InlineStatusForm } from "@/components/operations/inline-status-form";
import { StatusBadge } from "@/components/operations/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PermissionState } from "@/components/ui/permission-state";
import { toOperationalError } from "@/lib/errors";
import { listReservations } from "@/lib/operations/reservations";
import { getMockReservations } from "@/lib/operations/mock-fixtures";
import { RESERVATION_STATUSES } from "@/lib/operations/status";
import { resolveWorkspacePageContext } from "@/lib/tenancy/page-context";
import { hasPermission } from "@/lib/widgets/permissions";

import { updateReservationStatusAction } from "./actions";
import { CreateReservationForm } from "./create-reservation-form";

function formatReservationAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ReservationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { organizationSlug } = await params;
  const { status: statusFilter } = await searchParams;
  const context = await resolveWorkspacePageContext(organizationSlug);

  if (!hasPermission(context.permissions, "reservations.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Reservations" description="Bookings and table management" />
        <PermissionState requiredPermission="reservations.read" />
      </div>
    );
  }

  const canWrite = hasPermission(context.permissions, "reservations.write");

  interface ReservationDisplayRow {
    id: string;
    confirmationCode: string;
    guestName: string;
    partySize: number;
    reservationAt: string;
    status: string;
  }

  let reservations: ReservationDisplayRow[] = [];
  let loadError: string | null = null;
  let locations: { id: string; name: string }[] = [];

  if (context.mode === "mock") {
    reservations = getMockReservations(context.tenant.id).map((row) => ({
      id: row.id,
      confirmationCode: row.confirmationCode,
      guestName: row.guestName,
      partySize: row.partySize,
      reservationAt: row.reservationAt,
      status: row.status,
    }));
  } else {
    try {
      const [rows, { data: locationRows }] = await Promise.all([
        listReservations(context.supabase, context.tenant.id, { status: statusFilter }),
        context.supabase.from("locations").select("id, name").eq("organization_id", context.tenant.id),
      ]);
      reservations = rows.map((row) => ({
        id: row.id,
        confirmationCode: row.confirmation_code,
        guestName: row.guest_name,
        partySize: row.party_size,
        reservationAt: row.reservation_at,
        status: row.status,
      }));
      locations = locationRows ?? [];
    } catch (error) {
      loadError = toOperationalError(error as never).message;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reservations" description={`${context.tenant.name} — bookings and table management`} />

      {context.mode === "mock" ? (
        <p className="rounded-md border border-dashed border-border bg-surface-elevated/50 px-4 py-2 text-xs text-muted-foreground">
          Demo mode — read-only. Fictional reservations shown below; booking requires a live organization.
        </p>
      ) : canWrite ? (
        <Card>
          <CardContent className="pt-5">
            <CreateReservationForm organizationSlug={organizationSlug} locations={locations} />
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <a
          href={`/${organizationSlug}/reservations`}
          className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-surface-elevated"
        >
          All
        </a>
        {RESERVATION_STATUSES.map((status) => (
          <a
            key={status}
            href={`/${organizationSlug}/reservations?status=${status}`}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-surface-elevated"
          >
            {status.replace(/_/g, " ")}
          </a>
        ))}
      </div>

      {loadError ? (
        <ErrorState description={loadError} />
      ) : reservations.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No reservations yet"
          description="Bookings from WhatsApp, phone, or the website will show up here."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-elevated/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Guest</th>
                <th className="px-4 py-3 font-medium">Party</th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Confirmation</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((reservation) => (
                <tr key={reservation.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{reservation.guestName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{reservation.partySize}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatReservationAt(reservation.reservationAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{reservation.confirmationCode}</td>
                  <td className="px-4 py-3">
                    {context.mode === "supabase" && canWrite ? (
                      <InlineStatusForm
                        action={updateReservationStatusAction}
                        hiddenFields={{ organizationSlug, reservationId: reservation.id }}
                        currentStatus={reservation.status}
                        options={RESERVATION_STATUSES}
                      />
                    ) : (
                      <StatusBadge status={reservation.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { ShoppingCart } from "lucide-react";

import { StatusBadge } from "@/components/operations/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PermissionState } from "@/components/ui/permission-state";
import { toOperationalError } from "@/lib/errors";
import { listOrders } from "@/lib/operations/orders";
import { getMockOrders } from "@/lib/operations/mock-fixtures";
import { ORDER_STATUSES } from "@/lib/operations/status";
import { resolveWorkspacePageContext } from "@/lib/tenancy/page-context";
import { hasPermission } from "@/lib/widgets/permissions";

import { CreateOrderForm } from "./create-order-form";

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { organizationSlug } = await params;
  const { status: statusFilter } = await searchParams;
  const context = await resolveWorkspacePageContext(organizationSlug);

  if (!hasPermission(context.permissions, "orders.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Orders" description="Order capture and fulfillment" />
        <PermissionState requiredPermission="orders.read" />
      </div>
    );
  }

  const canWrite = hasPermission(context.permissions, "orders.write");

  interface OrderDisplayRow {
    id: string;
    orderNumber: string;
    customerName: string;
    status: string;
    paymentStatus: string;
    total: number;
    currency: string;
  }

  let orders: OrderDisplayRow[] = [];
  let loadError: string | null = null;
  let locations: { id: string; name: string }[] = [];

  if (context.mode === "mock") {
    orders = getMockOrders(context.tenant.id).map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      customerName: row.customerName,
      status: row.status,
      paymentStatus: row.paymentStatus,
      total: row.total,
      currency: row.currency,
    }));
  } else {
    try {
      const [rows, { data: locationRows }] = await Promise.all([
        listOrders(context.supabase, context.tenant.id, { status: statusFilter }),
        context.supabase.from("locations").select("id, name").eq("organization_id", context.tenant.id),
      ]);
      orders = rows.map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        customerName: row.customer_name,
        status: row.status,
        paymentStatus: row.payment_status,
        total: row.total,
        currency: row.currency,
      }));
      locations = locationRows ?? [];
    } catch (error) {
      loadError = toOperationalError(error as never).message;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Orders" description={`${context.tenant.name} — order capture and fulfillment`} />

      {context.mode === "mock" ? (
        <p className="rounded-md border border-dashed border-border bg-surface-elevated/50 px-4 py-2 text-xs text-muted-foreground">
          Demo mode — read-only. Fictional orders shown below; creating orders requires a live organization.
        </p>
      ) : canWrite ? (
        <Card>
          <CardContent className="pt-5">
            <CreateOrderForm organizationSlug={organizationSlug} locations={locations} />
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <a
          href={`/${organizationSlug}/orders`}
          className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-surface-elevated"
        >
          All
        </a>
        {ORDER_STATUSES.map((status) => (
          <a
            key={status}
            href={`/${organizationSlug}/orders?status=${status}`}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-surface-elevated"
          >
            {status.replace(/_/g, " ")}
          </a>
        ))}
      </div>

      {loadError ? (
        <ErrorState description={loadError} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="No orders yet"
          description="Dine-in, takeout, and delivery orders will show up here."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-elevated/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Payment</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {context.mode === "supabase" ? (
                      <Link href={`/${organizationSlug}/orders/${order.id}`} className="hover:underline">
                        {order.orderNumber}
                      </Link>
                    ) : (
                      order.orderNumber
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{order.customerName}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {order.total.toFixed(2)} {order.currency}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.paymentStatus} />
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

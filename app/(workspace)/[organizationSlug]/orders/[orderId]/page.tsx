import Link from "next/link";
import { notFound } from "next/navigation";

import { InlineStatusForm } from "@/components/operations/inline-status-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PermissionState } from "@/components/ui/permission-state";
import { toOperationalError } from "@/lib/errors";
import { getOrderWithItems } from "@/lib/operations/orders";
import { ORDER_PAYMENT_STATUSES, ORDER_STATUSES } from "@/lib/operations/status";
import { resolveWorkspacePageContext } from "@/lib/tenancy/page-context";
import { hasPermission } from "@/lib/widgets/permissions";

import { updateOrderPaymentStatusAction, updateOrderStatusAction } from "../actions";
import { AddItemForm } from "./add-item-form";
import { RemoveItemButton } from "./remove-item-button";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; orderId: string }>;
}) {
  const { organizationSlug, orderId } = await params;
  const context = await resolveWorkspacePageContext(organizationSlug);

  // Mock mode has no real order records to look up — the list page never
  // links here in that mode either (issue #16 rule 6: mock mode is a
  // read-only demo, not a second persistence layer).
  if (context.mode === "mock") {
    notFound();
  }

  if (!hasPermission(context.permissions, "orders.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Order" description="Order detail" />
        <PermissionState requiredPermission="orders.read" />
      </div>
    );
  }

  const canWrite = hasPermission(context.permissions, "orders.write");

  let result: Awaited<ReturnType<typeof getOrderWithItems>> = null;
  let loadError: string | null = null;

  try {
    result = await getOrderWithItems(context.supabase, context.tenant.id, orderId);
  } catch (error) {
    loadError = toOperationalError(error as never).message;
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Order" description="Order detail" />
        <p role="alert" className="text-sm text-danger">
          {loadError}
        </p>
      </div>
    );
  }

  if (!result) {
    notFound();
  }

  const { order, items } = result;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={order.order_number}
        description={`${context.tenant.name} — ${order.customer_name}`}
        actions={
          <Link href={`/${organizationSlug}/orders`} className="text-sm text-muted-foreground hover:underline">
            ← Back to orders
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <span className="text-xs text-muted-foreground">Status</span>
            {canWrite ? (
              <InlineStatusForm
                action={updateOrderStatusAction}
                hiddenFields={{ organizationSlug, orderId: order.id }}
                currentStatus={order.status}
                options={ORDER_STATUSES}
              />
            ) : (
              <span className="text-sm font-medium text-foreground">{order.status.replace(/_/g, " ")}</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <span className="text-xs text-muted-foreground">Payment</span>
            {canWrite ? (
              <InlineStatusForm
                action={updateOrderPaymentStatusAction}
                hiddenFields={{ organizationSlug, orderId: order.id }}
                statusFieldName="paymentStatus"
                currentStatus={order.payment_status}
                options={ORDER_PAYMENT_STATUSES}
              />
            ) : (
              <span className="text-sm font-medium text-foreground">{order.payment_status.replace(/_/g, " ")}</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <span className="text-xs text-muted-foreground">Subtotal</span>
            <span className="text-lg font-semibold text-foreground">
              {order.subtotal.toFixed(2)} {order.currency}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-lg font-semibold text-foreground">
              {order.total.toFixed(2)} {order.currency}
            </span>
            <span className="text-xs text-muted-foreground">
              tax {order.tax_total.toFixed(2)} · delivery {order.delivery_fee.toFixed(2)} · discount{" "}
              {order.discount_total.toFixed(2)}
            </span>
          </CardContent>
        </Card>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface-elevated/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Unit price</th>
              <th className="px-4 py-3 font-medium">Line total</th>
              {canWrite ? <th className="px-4 py-3 font-medium">&nbsp;</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-foreground">{item.item_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{item.quantity}</td>
                <td className="px-4 py-3 text-muted-foreground">{item.unit_price.toFixed(2)}</td>
                <td className="px-4 py-3 text-muted-foreground">{(item.line_total ?? 0).toFixed(2)}</td>
                {canWrite ? (
                  <td className="px-4 py-3">
                    <RemoveItemButton organizationSlug={organizationSlug} orderId={order.id} orderItemId={item.id} />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite ? (
        <Card>
          <CardContent className="pt-5">
            <AddItemForm organizationSlug={organizationSlug} orderId={order.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

import { Badge } from "@/components/ui/Badge";
import type { OrderStatus, PaymentStatus } from "@/types";
import type { StockStatus } from "@/lib/inventory/availability";

const orderTones: Record<OrderStatus, "info" | "accent" | "success" | "neutral" | "danger"> = {
  draft: "neutral",
  pending_payment: "info",
  payment_submitted: "accent",
  paid: "accent",
  confirmed: "success",
  processing: "info",
  packed: "info",
  ready_for_dispatch: "accent",
  shipped: "info",
  dispatched: "info",
  delivered: "success",
  cancelled: "danger",
};

const orderLabels: Record<OrderStatus, string> = {
  draft: "Draft",
  pending_payment: "Payment pending",
  payment_submitted: "Payment submitted",
  paid: "Paid",
  confirmed: "Confirmed",
  processing: "Processing",
  packed: "Packed",
  ready_for_dispatch: "Ready for dispatch",
  shipped: "Shipped",
  dispatched: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const paymentTones: Record<PaymentStatus, "info" | "success" | "danger" | "neutral" | "accent"> = {
  pending: "info",
  submitted: "accent",
  paid: "success",
  failed: "danger",
  cancelled: "neutral",
  refunded: "neutral",
};

const paymentLabels: Record<PaymentStatus, string> = {
  pending: "Pending",
  submitted: "Submitted",
  paid: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/** Status pill for admin order/payment tables (reuses Badge tones). */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={orderTones[status]}>{orderLabels[status]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={paymentTones[status]}>{paymentLabels[status]}</Badge>;
}

/**
 * Storefront availability pill. Status-only by design: exact counts
 * never reach the customer UI (they are re-checked server-side at
 * order time, where stale figures fail safe instead of overselling).
 */
export function StockBadge({ status }: { status: StockStatus }) {
  if (status === "out_of_stock") return <Badge tone="danger">Out of stock</Badge>;
  if (status === "low_stock") return <Badge tone="warning">Low stock</Badge>;
  return <Badge tone="success">In stock</Badge>;
}

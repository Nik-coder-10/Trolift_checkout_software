import type { OrderStatus, PaymentStatus } from "@/types";

/**
 * Order lifecycle transitions (pure, unit-tested).
 *
 * Canonical customer-visible flow:
 *   pending_payment → payment_submitted → confirmed → processing →
 *   dispatched → delivered
 * Legacy/edge states (draft/paid/shipped) sit on the same spine and
 * move forward identically. Cancellation is customer-initiated only
 * before fulfilment starts (draft/pending_payment/payment_submitted);
 * everything later is admin-controlled. Terminal states (delivered,
 * cancelled) have no exits.
 *
 * One designed backward step exists: payment_submitted → pending_payment
 * when an admin rejects a payment claim, reopening the order for a
 * retry. It is explicit here — not an arbitrary jump.
 *
 * Enforced wherever statuses change server-side (claim API now, admin
 * mutations next) so arbitrary jumps are structurally impossible.
 */

type TransitionMap = Record<OrderStatus, ReadonlyArray<OrderStatus>>;

const CUSTOMER_CANCELLABLE: ReadonlyArray<OrderStatus> = [
  "draft",
  "pending_payment",
  "payment_submitted",
];

export const ORDER_TRANSITIONS: TransitionMap = {
  draft: ["pending_payment", "payment_submitted", "cancelled"],
  pending_payment: ["payment_submitted", "cancelled"],
  payment_submitted: ["confirmed", "pending_payment", "cancelled"],
  paid: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["packed", "cancelled"],
  packed: ["ready_for_dispatch", "cancelled"],
  ready_for_dispatch: ["dispatched", "cancelled"],
  shipped: ["dispatched", "cancelled"],
  dispatched: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** True when the customer may still cancel (pre-fulfilment). */
export function isCustomerCancellable(status: OrderStatus): boolean {
  return (CUSTOMER_CANCELLABLE as ReadonlyArray<OrderStatus>).includes(status);
}

/** True for end states with no onward movement. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/**
 * Payment lifecycle transitions. Customer claims move pending/failed →
 * submitted; only admin verification moves submitted → paid, and only
 * admin rejection moves submitted → failed. Paid orders refund; nothing
 * ever moves back to pending.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, ReadonlyArray<PaymentStatus>> = {
  pending: ["submitted", "cancelled"],
  submitted: ["paid", "failed", "cancelled"],
  failed: ["submitted"],
  paid: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

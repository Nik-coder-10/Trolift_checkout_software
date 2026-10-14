import type { OrderStatus, PaymentStatus } from "@/types";

/**
 * Payment-claim rules (pure, unit-tested).
 *
 * A claim is the customer saying "I have paid, reference X" — it NEVER
 * marks anything paid. Accepted only from PENDING (or FAILED for a
 * retry) with a well-formed reference; the transition moves payment to
 * SUBMITTED and the order to PAYMENT_SUBMITTED for admin verification.
 */

/** UPI UTR / bank reference: 6–30 alphanumerics (UTRs are 12 digits). */
export function isValidPaymentReference(value: string): boolean {
  return /^[A-Za-z0-9]{6,30}$/.test(value.trim());
}

export function normalizePaymentReference(value: string): string {
  return value.trim().toUpperCase();
}

export function canSubmitClaim(
  paymentStatus: PaymentStatus,
  orderStatus: OrderStatus,
): boolean {
  if (paymentStatus !== "pending" && paymentStatus !== "failed") return false;
  return orderStatus === "pending_payment" || orderStatus === "draft";
}

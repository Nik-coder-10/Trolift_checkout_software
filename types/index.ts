/**
 * Shared domain + API types.
 *
 * SECURITY NOTE: prices, delivery charges and totals are ALWAYS computed
 * server-side from trusted data. Values submitted by the browser are
 * treated as untrusted hints and re-validated. Never trust client totals.
 */

export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "payment_submitted"
  | "paid"
  | "confirmed"
  | "processing"
  | "packed"
  | "ready_for_dispatch"
  | "shipped"
  | "dispatched"
  | "delivered"
  | "cancelled";

export type PaymentStatus =
  | "pending"
  | "submitted"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded";

export type PaymentMethod =
  | "upi"
  | "bank_transfer"
  | "cash"
  | "card"
  | "other";

export interface Money {
  /** Amount in the smallest currency unit (paise for INR). */
  amountPaise: number;
  currency: "INR";
}

export interface CustomerDetails {
  name: string;
  phone: string;
  email?: string;
  /** Optional GSTIN (GST number). Validated server-side when present. */
  gstin?: string;
  /** Mandatory 6-digit Indian delivery PIN code. */
  deliveryPincode: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
}

export interface OrderTotals {
  subtotal: Money;
  deliveryCharge: Money;
  tax: Money;
  grandTotal: Money;
}

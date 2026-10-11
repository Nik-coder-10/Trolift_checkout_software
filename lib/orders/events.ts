/**
 * Canonical order-event catalog (pure, unit-tested).
 *
 * Every state-changing operation writes exactly one of these types via
 * logOrderEvent(). The union is closed: clients cannot manufacture
 * events (there is no API accepting an event type), and the database
 * CHECK mirrors this list. STATUS_CHANGED exists ONLY as a bucket for
 * pre-catalog legacy rows (see 0021 backfill) — new code never writes
 * it, and it is hidden from customers.
 *
 * Metadata allowlist: operational facts only (payment method, counts,
 * totals, invoice number). Anything identifying or secret — UTRs,
 * phones, emails, addresses, GSTINs, tokens — is rejected by
 * assertEventMetadata() so it can never reach a timeline.
 */

export const ORDER_EVENT_TYPES = [
  "ORDER_CREATED",
  "PAYMENT_SUBMITTED",
  "PAYMENT_VERIFIED",
  "PAYMENT_REJECTED",
  "ORDER_CONFIRMED",
  "PROCESSING_STARTED",
  "PACKED",
  "READY_FOR_DISPATCH",
  "DISPATCHED",
  "DELIVERED",
  "CANCELLED",
  "INVOICE_ISSUED",
  "STATUS_CHANGED",
] as const;

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export type ActorType = "customer" | "admin" | "system";

/** Legacy snake_case `action` mirror, kept for old readers. */
export const LEGACY_ACTION: Record<OrderEventType, string> = {
  ORDER_CREATED: "order_created",
  PAYMENT_SUBMITTED: "payment_submitted",
  PAYMENT_VERIFIED: "payment_verified",
  PAYMENT_REJECTED: "payment_rejected",
  ORDER_CONFIRMED: "order_confirmed",
  PROCESSING_STARTED: "processing_started",
  PACKED: "packed",
  READY_FOR_DISPATCH: "ready_for_dispatch",
  DISPATCHED: "dispatched",
  DELIVERED: "delivered",
  CANCELLED: "order_cancelled",
  INVOICE_ISSUED: "invoice_issued",
  STATUS_CHANGED: "status_changed",
};

export type EventMetadata = Record<string, string | number | boolean>;

const METADATA_ALLOWLIST: ReadonlySet<string> = new Set([
  "payment_method",
  "item_count",
  "total_paise",
  "invoice_number",
]);

const SENSITIVE_KEY_PATTERN =
  /(utr|reference|phone|email|address|gstin|token|secret|password|key|otp|pan|aadhaar)/i;

/**
 * Validate event metadata: plain object, allowlisted keys only, scalar
 * values, bounded strings. Throws — callers fail the operation rather
 * than persisting something a timeline must later redact.
 */
export function assertEventMetadata(meta: unknown): EventMetadata {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    throw new Error("[events] metadata must be a plain object.");
  }
  const out: EventMetadata = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!METADATA_ALLOWLIST.has(key) || SENSITIVE_KEY_PATTERN.test(key)) {
      throw new Error(`[events] metadata key not allowed: ${key}`);
    }
    if (
      (typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean") ||
      (typeof value === "string" && value.length > 200) ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      throw new Error(`[events] metadata value not allowed for key: ${key}`);
    }
    out[key] = value;
  }
  return out;
}

/** Admin-facing human descriptions (actor + timestamp rendered separately). */
export const ADMIN_EVENT_DESCRIPTIONS: Record<OrderEventType, string> = {
  ORDER_CREATED: "Order placed",
  PAYMENT_SUBMITTED: "Payment claim submitted",
  PAYMENT_VERIFIED: "Payment verified",
  PAYMENT_REJECTED: "Payment claim rejected",
  ORDER_CONFIRMED: "Order confirmed",
  PROCESSING_STARTED: "Processing started",
  PACKED: "Order packed",
  READY_FOR_DISPATCH: "Ready for dispatch",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  CANCELLED: "Order cancelled",
  INVOICE_ISSUED: "Tax invoice issued",
  STATUS_CHANGED: "Status changed",
};

/**
 * Customer-safe labels. Deliberately a partial map: anything absent
 * (today only STATUS_CHANGED) is hidden from customers rather than
 * rendered raw. No actor names, notes, ids or metadata leave the
 * server through this map.
 */
export const CUSTOMER_EVENT_LABELS: Partial<Record<OrderEventType, string>> = {
  ORDER_CREATED: "Order placed",
  PAYMENT_SUBMITTED: "Payment submitted for verification",
  PAYMENT_VERIFIED: "Payment received",
  PAYMENT_REJECTED: "Payment needs attention",
  ORDER_CONFIRMED: "Order confirmed",
  PROCESSING_STARTED: "Being prepared",
  PACKED: "Packed",
  READY_FOR_DISPATCH: "Ready for dispatch",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  INVOICE_ISSUED: "Tax invoice ready",
};

export interface CustomerTimelineEntry {
  label: string;
  at: string;
}

/**
 * Build the customer-visible timeline from stored events: allowlisted
 * types only, chronological, labels + timestamps and nothing else.
 */
export function customerSafeTimeline(
  events: Array<{ eventType: string; createdAt: string }>,
): CustomerTimelineEntry[] {
  const out: CustomerTimelineEntry[] = [];
  for (const e of events) {
    if (!(ORDER_EVENT_TYPES as readonly string[]).includes(e.eventType)) {
      continue;
    }
    const label =
      CUSTOMER_EVENT_LABELS[e.eventType as OrderEventType];
    if (label === undefined) continue;
    out.push({ label, at: e.createdAt });
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

/** Map an order-status transition to its canonical event type. */
export function eventTypeForTransition(
  fromStatus: string,
  toStatus: string,
): OrderEventType {
  switch (toStatus) {
    case "payment_submitted":
      return "PAYMENT_SUBMITTED";
    case "confirmed":
      return "ORDER_CONFIRMED";
    case "processing":
      return "PROCESSING_STARTED";
    case "packed":
      return "PACKED";
    case "ready_for_dispatch":
      return "READY_FOR_DISPATCH";
    case "dispatched":
      return "DISPATCHED";
    case "delivered":
      return "DELIVERED";
    case "cancelled":
      return "CANCELLED";
    case "pending_payment":
      // The only designed backward step: a rejected claim reopens the
      // order. Callers log PAYMENT_REJECTED for the decision; this
      // fallback keeps unmapped callers honest.
      return fromStatus === "payment_submitted"
        ? "PAYMENT_REJECTED"
        : "STATUS_CHANGED";
    default:
      return "STATUS_CHANGED";
  }
}

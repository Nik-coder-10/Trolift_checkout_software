import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/api/errors";
import {
  canSubmitClaim,
  isValidPaymentReference,
  normalizePaymentReference,
} from "@/lib/payments/claims";
import { normalizePhone } from "@/lib/validations/common";
import { canTransition } from "@/lib/orders/transitions";
import { logOrderEvent } from "@/lib/admin/orders";
import type { OrderStatus, PaymentStatus } from "@/types";

export function assertClaimAllowed(
  paymentStatus: PaymentStatus,
  orderStatus: OrderStatus,
): void {
  if (!canSubmitClaim(paymentStatus, orderStatus)) {
    throw new AppError(
      "BAD_REQUEST",
      "This order cannot accept a payment claim in its current state.",
      409,
    );
  }
}

/**
 * Payment-claim persistence (server-only).
 *
 * Flow: load order + latest payment via service role → enforce
 * transition rules → store the UTR (UNIQUE-guarded) → flip payment to
 * SUBMITTED and order to PAYMENT_SUBMITTED atomically-ish in order
 * (payment first would orphan on crash; order first is also imperfect —
 * a small reconciliation window the admin dashboard resolves by
 * matching on transaction_reference).
 *
 * Amounts are never accepted: the claim carries only the reference.
 */

export interface ClaimResult {
  orderId: string;
  orderNumber: string;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  /** Object path of the uploaded screenshot (payments.proof_path). */
  proofPath: string;
  totalPaise: number;
  customer: { name: string; phone: string; email: string | null };
}

export async function submitPaymentClaim(input: {
  orderId: string;
  reference: string;
  /** Customer's mobile — must match the order's customer (IDOR guard). */
  phone: string;
  /** Stored screenshot of the payment (uploaded before this call). */
  proofPath: string;
}): Promise<ClaimResult> {
  const reference = normalizePaymentReference(input.reference);
  if (!isValidPaymentReference(input.reference)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Enter the 6–30 character payment reference from your UPI app.",
      422,
    );
  }
  const admin = createAdminClient();

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,order_number,customer_id,payment_status,order_status,total_amount")
    .eq("id", input.orderId)
    .maybeSingle();
  const orderRow = order as unknown as {
    id: string;
    order_number: string;
    customer_id: string;
    payment_status: PaymentStatus;
    order_status: OrderStatus;
    total_amount: string;
  } | null;
  if (orderError || !orderRow) {
    throw new AppError("NOT_FOUND", "Order not found.", 404);
  }
  // IDOR guard: the claimant must know the order's customer mobile,
  // which is never exposed publicly (listing shows a masked value).
  const [{ data: customer }, { data: payment, error: paymentError }] = await Promise.all([
    admin
      .from("customers")
      .select("name,phone,email")
      .eq("id", orderRow.customer_id)
      .maybeSingle(),
    admin
      .from("payments")
      .select("id,status")
      .eq("order_id", orderRow.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const customerRow = customer as unknown as {
    name: string;
    phone: string;
    email: string | null;
  } | null;
  if (
    !customerRow ||
    normalizePhone(input.phone) !== normalizePhone(customerRow.phone)
  ) {
    // Generic 404 (not 403): with token-gated routes the claimant is
    // already order-authorized, but the message must not confirm or
    // deny anything about the order to mismatched callers.
    throw new AppError(
      "NOT_FOUND",
      "Order not found.",
      404,
    );
  }
  assertClaimAllowed(orderRow.payment_status, orderRow.order_status);
  const paymentRow = payment as unknown as {
    id: string;
    status: PaymentStatus;
  } | null;
  if (paymentError || !paymentRow) {
    throw new AppError("NOT_FOUND", "No pending payment for this order.", 404);
  }
  assertClaimAllowed(paymentRow.status, orderRow.order_status);
  // Lifecycle gate: the target state must be a legal transition.
  if (!canTransition(orderRow.order_status, "payment_submitted")) {
    throw new AppError(
      "BAD_REQUEST",
      "This order cannot accept a payment claim in its current state.",
      409,
    );
  }

  const { error: refError } = await admin
    .from("payments")
    .update({ transaction_reference: reference, proof_path: input.proofPath })
    .eq("id", paymentRow.id);
  if (refError) {
    // Duplicate UTR (partial unique index) lands here too.
    throw new AppError(
      "BAD_REQUEST",
      "This payment reference was already used. Check the UTR and try again.",
      409,
    );
  }
  // Optimistic concurrency: zero updated rows means someone else moved
  // the state first (Supabase reports that as success with empty data).
  const payUpdate = await admin
    .from("payments")
    .update({ status: "submitted" })
    .eq("id", paymentRow.id)
    .eq("status", paymentRow.status)
    .select("id");
  const payRows = (payUpdate.data ?? []) as unknown as Array<{ id: string }>;
  if (payUpdate.error || payRows.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      "This payment changed state. Refresh and try again.",
      409,
    );
  }
  const orderUpdate = await admin
    .from("orders")
    .update({ order_status: "payment_submitted", payment_status: "submitted" })
    .eq("id", orderRow.id)
    .eq("order_status", orderRow.order_status)
    .select("id");
  const orderRows = (orderUpdate.data ?? []) as unknown as Array<{ id: string }>;
  if (orderUpdate.error || orderRows.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      "This order changed state. Refresh and try again.",
      409,
    );
  }
  // Audit the claim (actor = the customer row that owns the order; the
  // phone match above is the authorization). Uses the service-role
  // client — guests have no session. A logging failure throws: the
  // claim is recorded either way via payment_status, so the operator
  // sees a loud 500 instead of a silent audit gap on retry-safe replay.
  await logOrderEvent({
    orderId: orderRow.id,
    eventType: "PAYMENT_SUBMITTED",
    actorType: "customer",
    actorUserId: orderRow.customer_id,
    fromStatus: orderRow.order_status,
    toStatus: "payment_submitted",
    metadata: { payment_method: "upi" },
    client: admin,
  });
  return {
    orderId: orderRow.id,
    orderNumber: orderRow.order_number,
    paymentStatus: "submitted",
    orderStatus: "payment_submitted",
    proofPath: input.proofPath,
    totalPaise: Math.round(Number(orderRow.total_amount) * 100),
    customer: {
      name: customerRow.name,
      phone: customerRow.phone,
      email: customerRow.email,
    },
  };
}

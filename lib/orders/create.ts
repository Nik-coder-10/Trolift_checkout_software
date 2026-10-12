import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/api/errors";
import { getPaymentWindowHours } from "@/lib/payments/upi";
import type { OrderQuote } from "@/lib/orders/quote";

/**
 * Order persistence via the atomic create_order() RPC (server-only).
 *
 * Snapshots come exclusively from a server-computed OrderQuote — this
 * module accepts no money from callers. Concurrent double-submits with
 * the same idempotency key resolve to the existing order via the
 * UNIQUE constraint (23505 → fetch-and-return). Stock is RESERVED (not
 * sold) inside the same atomic call with the payment-window TTL;
 * verification consumes it, cancellation restores it.
 */

export interface PersistedOrder {
  orderId: string;
  duplicate: boolean;
}

const toRupees = (paise: number): string => (paise / 100).toFixed(2);

export async function persistOrder(input: {
  idempotencyKey: string;
  customer: {
    name: string;
    phone: string;
    email: string | null;
    gstin: string | null;
  };
  quote: OrderQuote;
}): Promise<PersistedOrder> {
  const admin = createAdminClient();
  const { quote } = input;

  const payload = {
    p_idempotency_key: input.idempotencyKey,
    p_customer: {
      name: input.customer.name,
      phone: input.customer.phone,
      email: input.customer.email,
      gstin: input.customer.gstin,
    },
    p_order: {
      order_number: "",
      subtotal: toRupees(quote.subtotalPaise),
      delivery_charge: toRupees(quote.deliveryChargePaise),
      total_amount: toRupees(quote.totalPaise),
      delivery_pincode: quote.pincode,
      delivery_partner_id: quote.deliveryPartnerId,
      delivery_partner_name: quote.deliveryPartnerName,
      gstin_snapshot: input.customer.gstin,
      // Unknown/non-positive weights persist as NULL: the database
      // CHECK requires weight > 0 when present, so a 0/NaN slip must
      // never reach the insert (live staging proved a 500 otherwise).
      delivery_weight_kg:
        quote.deliveryWeightKg === null || !(quote.deliveryWeightKg > 0)
          ? null
          : quote.deliveryWeightKg.toFixed(3),
      delivery_rule_summary: quote.deliveryRuleSummary,
      payment_status: "pending",
      order_status: "pending_payment",
      tax_treatment: quote.tax.treatment,
      billing_name: quote.billing.name,
      billing_address_line: quote.billing.addressLine,
      billing_city: quote.billing.city,
      billing_state: quote.billing.state,
      billing_state_code: quote.billing.stateCode,
      billing_pincode: quote.billing.pincode,
      taxable_amount: toRupees(quote.tax.taxablePaise),
      cgst_amount: toRupees(quote.tax.cgstPaise),
      sgst_amount: toRupees(quote.tax.sgstPaise),
      igst_amount: toRupees(quote.tax.igstPaise),
    },
    p_items: quote.lines.map((l) => ({
      product_id: l.productId,
      product_name: l.productName,
      quantity: l.quantity,
      unit_price: toRupees(l.unitPricePaise),
      line_total: toRupees(l.lineTotalPaise),
      gst_rate_percent: l.gstRate,
      line_tax_amount: toRupees(l.lineTaxPaise),
      hsn_snapshot: l.hsn,
    })),
    p_payment: {
      amount: toRupees(quote.totalPaise),
      method: "upi",
    },
    // Reservation TTL tracks the payment window: holds outlive the
    // customer's chance to pay, and not a day longer.
    p_reservation_hours: getPaymentWindowHours(),
  };

  const { data, error } = await admin.rpc("create_order", payload);
  if (!error) {
    return { orderId: data as unknown as string, duplicate: false };
  }
  // Atomic shortfall: another buyer won the race between quote and
  // reserve. Surface 422 naming the item — never a generic 500.
  if (
    typeof error === "object" && error !== null &&
    (error as { code?: string }).code === "P0001" &&
    typeof (error as { message?: string }).message === "string" &&
    ((error as { message: string }).message.includes("INSUFFICIENT_STOCK:")
    )
  ) {
    const detail = (error as { message: string }).message
      .replace("INSUFFICIENT_STOCK:", "")
      .trim();
    throw new AppError(
      "INSUFFICIENT_STOCK",
      detail !== "" ? detail : "Not enough stock for one of the items.",
      422,
    );
  }
  // Concurrent race: another request won with the same key.
  if ((error as { code?: string }).code === "23505") {
    const existing = await admin
      .from("orders")
      .select("id")
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    const row = existing.data as unknown as { id: string } | null;
    if (!existing.error && row) {
      return { orderId: row.id, duplicate: true };
    }
  }
  throw new AppError(
    "INTERNAL_ERROR",
    "Could not place this order. Please try again.",
    500,
  );
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  subtotalPaise: number;
  deliveryChargePaise: number;
  /** Frozen shipment weight in kg (null when unknown at order time). */
  deliveryWeightKg: number | null;
  /** Frozen freight rules (null when plain pincode pricing applied). */
  deliveryRuleSummary: string | null;
  totalPaise: number;
  taxTreatment: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  paymentStatus: string;
  orderStatus: string;
}

/** Customer-safe order summary (no internal rows leak). */
export async function fetchOrderSummary(orderId: string): Promise<OrderSummary> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select(
      "id,order_number,subtotal,delivery_charge,total_amount," +
        "tax_treatment,taxable_amount,cgst_amount,sgst_amount,igst_amount," +
        "delivery_weight_kg,delivery_rule_summary," +
        "payment_status,order_status",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not load this order. Please try again.",
      500,
    );
  }
  const row = data as unknown as {
    id: string;
    order_number: string;
    subtotal: string;
    delivery_charge: string;
    delivery_weight_kg: string | null;
    delivery_rule_summary: string | null;
    total_amount: string;
    tax_treatment: string;
    taxable_amount: string;
    cgst_amount: string;
    sgst_amount: string;
    igst_amount: string;
    payment_status: string;
    order_status: string;
  };
  const paise = (decimal: string): number => Math.round(Number(decimal) * 100);
  return {
    id: row.id,
    orderNumber: row.order_number,
    subtotalPaise: paise(row.subtotal),
    deliveryChargePaise: paise(row.delivery_charge),
    deliveryWeightKg:
      row.delivery_weight_kg === null ? null : Number(row.delivery_weight_kg),
    deliveryRuleSummary: row.delivery_rule_summary,
    totalPaise: paise(row.total_amount),
    taxTreatment: row.tax_treatment,
    taxablePaise: paise(row.taxable_amount),
    cgstPaise: paise(row.cgst_amount),
    sgstPaise: paise(row.sgst_amount),
    igstPaise: paise(row.igst_amount),
    paymentStatus: row.payment_status,
    orderStatus: row.order_status,
  };
}

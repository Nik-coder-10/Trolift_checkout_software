import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyGuestToken } from "@/lib/guest-access/guard";
import {
  maskGstin,
  maskPhoneFull,
  maskReference,
} from "@/lib/guest-access/tokens";
import {
  customerSafeTimeline,
  type CustomerTimelineEntry,
} from "@/lib/orders/events";
import type { OrderStatus, PaymentStatus } from "@/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Customer-safe order projection (server-only).
 *
 * Two entry points:
 * - `getPayableOrderForAdmin(orderId)` — admin workflows only (existing
 *   admin authorization applies upstream). Returns the same redacted
 *   customer-safe shape; admins needing full PII use admin services.
 * - `getPayableOrderForGuest(orderId, token)` — guest pages/API routes.
 *   The order UUID alone authorizes NOTHING: a valid, unexpired,
 *   unrevoked token bound to THIS order is required. Missing/invalid
 *   input returns null without touching the database (no oracle, no
 *   wasted service-role reads).
 *
 * PII discipline: phone is masked, GSTIN is masked (full value lives
 * only in the authorized invoice PDF), payment references show last-4
 * only, and email / billing street / internal notes are never selected.
 * The order's own shipping address is shown back — only to the guest
 * (or admin) already authorized for THIS order.
 */

export interface PayableOrderItem {
  name: string;
  quantity: number;
  lineTotalPaise: number;
}

export interface ShipmentTracking {
  trackingNumber: string;
  trackingUrl: string | null;
  estimatedDeliveryDate: string | null;
}

export interface OrderTaxBreakdown {
  treatment: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface PayableOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  /** Masked — full phone never leaves the server except via recovery. */
  customerPhoneMasked: string;
  billingName: string | null;
  /** Masked — full GSTIN lives only in the authorized invoice PDF. */
  gstinMasked: string | null;
  tax: OrderTaxBreakdown;
  /** Shipment tracking (courier integration phase; null until then). */
  tracking: ShipmentTracking | null;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotalPaise: number;
  deliveryChargePaise: number;
  /**
   * GST folded into the tax split on a charged delivery: the base
   * charge lives in deliveryChargePaise and its GST rides in cgst/sgst/
   * igst. Derived exactly (order tax − Σ line tax) — 0 when delivery is
   * included, or when the charge was quoted GST-inclusive with no tax
   * broken out.
   */
  deliveryTaxPaise: number;
  totalPaise: number;
  /** Rupees knocked off by a redeem code (0 when the order used none). */
  discountPaise: number;
  /** Redeem code granted at checkout, or null when none was used. */
  couponCode: string | null;
  deliveryPincode: string;
  deliveryPartnerName: string;
  /** Delivery address the order was placed with (own-viewer only). */
  shippingAddress: string | null;
  items: PayableOrderItem[];
  /** Last-4 only — the full UTR never appears in order views. */
  paymentReferenceMasked: string | null;
  /** True once the claim's payment screenshot is stored (proof_path). */
  hasPaymentProof: boolean;
  createdAt: string;
  /**
   * Customer-safe event feed (labels + timestamps only — built through
   * the allowlist map, so actor names, notes, ids and metadata can
   * never reach this projection).
   */
  timeline: CustomerTimelineEntry[];
}

const toPaise = (decimal: string): number =>
  Math.round(Number(decimal) * 100);

export async function getPayableOrder(
  orderId: string,
): Promise<PayableOrder | null> {
  return getPayableOrderForAdmin(orderId);
}

/** Admin-only loader: upstream admin auth still required. */
export async function getPayableOrderForAdmin(
  orderId: string,
): Promise<PayableOrder | null> {
  if (!UUID_RE.test(orderId)) return null;
  const admin = createAdminClient();

  const [{ data: order, error: orderError }, { data: shipment }] = await Promise.all([
    admin
      .from("orders")
      .select(
        "id,order_number,customer_id,subtotal,delivery_charge,total_amount," +
          "coupon_code,discount_amount," +
          "delivery_pincode,delivery_partner_name,gstin_snapshot,shipping_address," +
          "tax_treatment,taxable_amount,cgst_amount,sgst_amount,igst_amount," +
          "billing_name,payment_status,order_status,created_at",
      )
      .eq("id", orderId)
      .maybeSingle(),
    admin
      .from("shipments")
      .select("tracking_reference,expected_delivery_date,dispatched_at,delivered_at")
      .eq("order_id", orderId)
      .maybeSingle(),
  ]);
  const o = order as unknown as {
    id: string;
    order_number: string;
    customer_id: string;
    subtotal: string;
    delivery_charge: string;
    total_amount: string;
    coupon_code?: string | null;
    discount_amount?: string;
    delivery_pincode: string;
    delivery_partner_name: string;
    gstin_snapshot: string | null;
    shipping_address: string | null;
    tax_treatment: string;
    taxable_amount: string;
    cgst_amount: string;
    sgst_amount: string;
    igst_amount: string;
    billing_name: string | null;
    payment_status: PaymentStatus;
    order_status: OrderStatus;
    created_at: string;
  } | null;
  if (orderError || !o) return null;

  const [{ data: customer }, { data: items }, { data: payment }, { data: events }] =
    await Promise.all([
      admin
        .from("customers")
        .select("name,phone")
        .eq("id", o.customer_id)
        .maybeSingle(),
      admin
        .from("order_items")
        .select("product_name,quantity,line_total,line_tax_amount")
        .eq("order_id", o.id)
        .order("product_name"),
      admin
        .from("payments")
        .select("transaction_reference,status,proof_path")
        .eq("order_id", o.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("order_events")
        .select("event_type,created_at")
        .eq("order_id", o.id)
        .order("created_at", { ascending: true })
        .limit(50),
    ]);
  const c = customer as unknown as { name: string; phone: string | null } | null;
  const rows = (items ?? []) as unknown as Array<{
    product_name: string;
    quantity: number;
    line_total: string;
    line_tax_amount: string;
  }>;
  const p = payment as unknown as {
    transaction_reference: string | null;
    status: PaymentStatus;
    proof_path?: string | null;
  } | null;
  const eventRows = (events ?? []) as unknown as Array<{
    event_type: string;
    created_at: string;
  }>;

  return {
    id: o.id,
    orderNumber: o.order_number,
    customerName: c?.name ?? "Customer",
    customerPhoneMasked: maskPhoneFull(c?.phone ?? null),
    orderStatus: o.order_status,
    paymentStatus: p?.status ?? o.payment_status,
    deliveryPincode: o.delivery_pincode,
    deliveryPartnerName: o.delivery_partner_name,
    shippingAddress: o.shipping_address,
    gstinMasked: maskGstin(o.gstin_snapshot),
    billingName: o.billing_name,
    tax: {
      treatment: o.tax_treatment,
      taxablePaise: toPaise(o.taxable_amount),
      cgstPaise: toPaise(o.cgst_amount),
      sgstPaise: toPaise(o.sgst_amount),
      igstPaise: toPaise(o.igst_amount),
    },
    subtotalPaise: toPaise(o.subtotal),
    deliveryChargePaise: toPaise(o.delivery_charge),
    deliveryTaxPaise: Math.max(
      0,
      toPaise(o.cgst_amount) + toPaise(o.sgst_amount) + toPaise(o.igst_amount) -
        rows.reduce((n, r) => n + toPaise(r.line_tax_amount), 0),
    ),
    totalPaise: toPaise(o.total_amount),
    // Optional-shaped so pre-discount readers/mocks still map cleanly;
    // live rows always carry the column (default 0).
    discountPaise: toPaise(o.discount_amount ?? "0"),
    couponCode: o.coupon_code ?? null,
    items: rows.map((r) => ({
      name: r.product_name,
      quantity: r.quantity,
      // Customer-facing line amount is the INCLUSIVE total:
      // line_total (taxable) + line_tax_amount (embedded GST).
      lineTotalPaise: toPaise(r.line_total) + toPaise(r.line_tax_amount),
    })),
    paymentReferenceMasked: maskReference(p?.transaction_reference ?? null),
    hasPaymentProof: Boolean(p?.proof_path),
    createdAt: o.created_at,
    timeline: customerSafeTimeline(
      eventRows.map((e) => ({
        eventType: e.event_type,
        createdAt: e.created_at,
      })),
    ),
    tracking: shipment
      ? {
          trackingNumber: shipment.tracking_reference ?? "",
          trackingUrl: null,
          estimatedDeliveryDate: shipment.expected_delivery_date
            ? new Date(shipment.expected_delivery_date).toLocaleDateString("en-IN")
            : null,
        }
      : null,
  };
}

/**
 * Guest loader: UUID alone authorizes nothing. Verifies the bearer
 * token (bound to this order, unexpired, unrevoked) BEFORE reading the
 * order row, so unauthenticated probes cause no order-table reads and
 * learn nothing (null === missing, uniformly).
 */
export async function getPayableOrderForGuest(
  orderId: string,
  rawToken: string | null | undefined,
): Promise<PayableOrder | null> {
  if (!UUID_RE.test(orderId)) return null;
  const ok = await verifyGuestToken(orderId, rawToken);
  if (!ok) return null;
  return getPayableOrderForAdmin(orderId);
}

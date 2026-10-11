import "server-only";
import { createClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/api/errors";
import { quoteDelivery } from "@/lib/delivery/engine";
import {
  computeOrderTax,
  getBusinessStateCode,
  lineTaxPaise,
  type OrderTax,
} from "@/lib/tax/india";
import { fetchAvailability } from "@/lib/inventory/availability";

/**
 * Server-side order pricing (server-only).
 *
 * Accepts ONLY product IDs, quantities, pincode and (optional) billing
 * identity — never prices, rates, charges, totals, stock figures or
 * availability flags. Every rupee below is recomputed from trusted
 * product rows, the GST engine and the delivery engine, so
 * client-submitted money is structurally impossible to honour.
 * Quantities are validated against live reserve-aware availability
 * (stale carts and forged counts are rejected with the item named) —
 * this check is advisory; the atomic guard lives in create_order().
 *
 *   subtotal = Σ(unit_price × quantity)      (integer paise, ex-GST)
 *   tax      = GST engine over live product rates (paise-exact)
 *   delivery = delivery_engine(pincode, subtotal)
 *   total    = subtotal + tax + delivery
 */

export interface OrderLineInput {
  productId: string;
  quantity: number;
}

export interface PricedOrderLine {
  productId: string;
  productName: string;
  quantity: number;
  /** Integer paise snapshot from the live product row. */
  unitPricePaise: number;
  lineTotalPaise: number;
  /** GST percent snapshot (decimal string) for the invoice. */
  gstRate: string | null;
  /** Integer paise line GST (same rounding as the order engine). */
  lineTaxPaise: number;
}

export interface BillingInput {
  gstin: string | null;
  stateCode: string | null;
  name: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

export interface OrderQuote {
  lines: PricedOrderLine[];
  subtotalPaise: number;
  tax: OrderTax;
  billing: BillingInput;
  deliveryPartnerId: string;
  deliveryPartnerName: string;
  deliveryChargePaise: number;
  /** Shipment weight in kg (3dp) when all line weights are known. */
  deliveryWeightKg: number | null;
  /** Frozen human-readable freight rules (no internal IDs). */
  deliveryRuleSummary: string | null;
  totalPaise: number;
  pincode: string;
}

interface ProductRow {
  id: string;
  name: string;
  price: string;
  gst_rate: string | null;
  is_active: boolean;
  /**
   * Reserve-aware units available (on-hand minus live holds) at fetch
   * time. Advisory only — create_order() re-checks atomically under
   * row locks, so quote-to-order races fail safe instead of overselling.
   */
  available: number;
}

export const ORDER_MAX_QTY = 999;

/**
 * Pure line pricing over already-fetched product rows.
 * Throws 422 on unknown/inactive products, bad quantities and
 * requested quantities beyond live availability (item named).
 */
export function priceOrderLines(
  products: ProductRow[],
  items: OrderLineInput[],
): PricedOrderLine[] {
  if (items.length === 0) {
    throw new AppError("VALIDATION_ERROR", "The order has no items.", 422);
  }
  const byId = new Map(products.map((p) => [p.id, p]));
  return items.map((item) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Quantities must be whole numbers of at least 1.",
        422,
      );
    }
    if (item.quantity > ORDER_MAX_QTY) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Quantities are limited to ${ORDER_MAX_QTY} per product.`,
        422,
      );
    }
    const product = byId.get(item.productId);
    if (!product || !product.is_active) {
      throw new AppError(
        "VALIDATION_ERROR",
        "One of the products is no longer available.",
        422,
      );
    }
    const available = Math.max(0, Math.floor(product.available));
    if (item.quantity > available) {
      throw new AppError(
        "INSUFFICIENT_STOCK",
        available <= 0
          ? `"${product.name}" is out of stock right now.`
          : `Only ${available} of "${product.name}" available right now.`,
        422,
      );
    }
    const unitPricePaise = Math.round(Number(product.price) * 100);
    if (!Number.isFinite(unitPricePaise) || unitPricePaise < 0) {
      throw new AppError("INTERNAL_ERROR", "Invalid product price.", 500);
    }
    const lineTotalPaise = unitPricePaise * item.quantity;
    return {
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPricePaise,
      lineTotalPaise,
      gstRate: product.gst_rate,
      lineTaxPaise: lineTaxPaise(lineTotalPaise, product.gst_rate),
    };
  });
}

/**
 * Full server quote: trusted prices → subtotal → engine delivery → total.
 * The future order API calls this (then persists snapshots + CHECKs).
 */
export async function quoteOrder(input: {
  items: OrderLineInput[];
  pincode: string;
  billing?: BillingInput | null;
}): Promise<OrderQuote> {
  const supabase = await createClient();
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const [{ data, error }, availability] = await Promise.all([
    supabase
      .from("products")
      .select("id,name,price,gst_rate,is_active")
      .in("id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]),
    fetchAvailability(supabase, ids),
  ]);
  if (error) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not price this order. Please try again.",
      500,
    );
  }
  if (!availability) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not check stock. Please try again.",
      500,
    );
  }
  const rows = ((data ?? []) as unknown as Omit<ProductRow, "available">[]).map(
    (p) => ({
      ...p,
      available: availability.get(p.id)?.available ?? 0,
    }),
  );
  const lines = priceOrderLines(rows, input.items);
  const subtotalPaise = lines.reduce((n, l) => n + l.lineTotalPaise, 0);

  const billing: BillingInput = {
    gstin: input.billing?.gstin ?? null,
    stateCode: input.billing?.stateCode ?? null,
    name: input.billing?.name ?? null,
    addressLine: input.billing?.addressLine ?? null,
    city: input.billing?.city ?? null,
    state: input.billing?.state ?? null,
    pincode: input.billing?.pincode ?? null,
  };
  const tax = computeOrderTax({
    lines: lines.map((l) => ({
      lineTotalPaise: l.lineTotalPaise,
      gstRate: l.gstRate,
    })),
    gstin: billing.gstin,
    customerStateCode: billing.stateCode,
    businessStateCode: getBusinessStateCode(),
  });

  // Lines travel too (IDs + quantities only): the engine re-fetches
  // weights, categories and prices live — client figures never qualify.
  const delivery = await quoteDelivery(input.pincode, subtotalPaise, input.items);
  if (!delivery.serviceable || !delivery.selected) {
    throw new AppError(
      "VALIDATION_ERROR",
      delivery.reason ?? "This pincode is not serviceable.",
      422,
    );
  }
  return {
    lines,
    subtotalPaise,
    tax,
    billing,
    deliveryPartnerId: delivery.selected.partner.id,
    deliveryPartnerName: delivery.selected.partner.name,
    deliveryChargePaise: delivery.selected.deliveryChargePaise,
    deliveryWeightKg: delivery.totalWeightKg,
    deliveryRuleSummary:
      delivery.appliedRules.length > 0 ? delivery.appliedRules.join(" + ") : null,
    totalPaise:
      subtotalPaise + tax.totalGstPaise + delivery.selected.deliveryChargePaise,
    pincode: delivery.pincode,
  };
}

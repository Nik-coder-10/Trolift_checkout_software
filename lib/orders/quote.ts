import "server-only";
import { createClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/api/errors";
import {
  quoteDelivery,
  NOT_SERVICEABLE_MESSAGE,
} from "@/lib/delivery/engine";
import { getOdaChargePaise, splitOdaCharge } from "@/lib/delivery/oda";
import { getDeliveryGstRate } from "@/lib/quotations/config";
import {
  computeOrderTax,
  getBusinessStateCode,
  splitInclusiveLine,
  stateCodeFromName,
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
 * All-inclusive pricing (0035): product prices already contain GST
 * and delivery, so
 *   unit/line splits  = reverse-computed taxable + embedded GST
 *   subtotal          = Σ line taxable values   (invoice identity)
 *   delivery          = 0 on every serviceable pincode
 *                       (the engine still decides partner/ETA/state)
 *                       or the flat ODA base charge when the customer
 *                       opts into door delivery on an out-of-area
 *                       pincode
 *   total             = subtotal + extracted GST (+ ODA base charge
 *                       + its 18% GST, which is folded into the
 *                       CGST/SGST or IGST split)
 *                       = Σ inclusive lines (+ ODA base + ODA GST)
 */

export interface OrderLineInput {
  productId: string;
  quantity: number;
}

export interface PricedOrderLine {
  productId: string;
  productName: string;
  quantity: number;
  /** Inclusive unit price (paise) — the catalogue price the customer sees. */
  unitPricePaise: number;
  /** Inclusive line total = unit × quantity (paise) — what the customer pays. */
  lineTotalPaise: number;
  /** Reverse-computed taxable unit price (paise) — persisted as unit_price. */
  unitTaxablePaise: number;
  /** Reverse-computed taxable line total (paise) — persisted as line_total. */
  taxablePaise: number;
  /** GST percent snapshot (decimal string) for the invoice. */
  gstRate: string | null;
  /** Embedded line GST = lineTotal − taxable (paise) — line_tax_amount. */
  lineTaxPaise: number;
  /** HSN snapshot for quotations (null = blank cell). */
  hsn: string | null;
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
  /** Sum of reverse-computed line taxable values (invoice identity). */
  subtotalPaise: number;
  tax: OrderTax;
  billing: BillingInput;
  /** Null for a covered pincode with no configured rate row. */
  deliveryPartnerId: string | null;
  deliveryPartnerName: string;
  /** 0 on all-inclusive orders; the flat ODA base charge when opted in. */
  deliveryChargePaise: number;
  /**
   * GST folded into `tax` on the delivery charge (0 when delivery is
   * included or the charge carries no GST) — the 18% on top of the
   * ODA base charge, so base + deliveryTax is what the customer pays.
   */
  deliveryTaxPaise: number;
  /** Shipment weight in kg (3dp) when all line weights are known. */
  deliveryWeightKg: number | null;
  /** Frozen human-readable delivery note (charges never apply). */
  deliveryRuleSummary: string | null;
  /** Partner ETA window when the rate row carries one (for emails). */
  etaDays: { min: number; max: number } | null;
  /** Inclusive grand total = subtotal + extracted GST = Σ inclusive lines. */
  totalPaise: number;
  pincode: string;
}

interface ProductRow {
  id: string;
  name: string;
  price: string;
  gst_rate: string | null;
  hsn_code: string | null;
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
    const split = splitInclusiveLine(unitPricePaise, item.quantity, product.gst_rate);
    return {
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPricePaise: split.unitPricePaise,
      lineTotalPaise: split.lineTotalPaise,
      unitTaxablePaise: split.unitTaxablePaise,
      taxablePaise: split.taxablePaise,
      gstRate: product.gst_rate,
      lineTaxPaise: split.gstPaise,
      hsn: product.hsn_code,
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
  /**
   * Customer opted into door delivery on an ODA pincode. Only honoured
   * when the pincode is listed with oda=true on the Delhivery list —
   * the server re-verifies, so a forged flag on a serviceable or
   * unlisted pincode is a 422, never a discount or a way in.
   */
  odaDoorDelivery?: boolean;
}): Promise<OrderQuote> {
  const supabase = await createClient();
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const [{ data, error }, availability] = await Promise.all([
    supabase
      .from("products")
      .select("id,name,price,gst_rate,hsn_code,is_active")
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
  // Money identity: subtotal = Σ taxable values; order value (used for
  // partner order windows) = Σ inclusive line totals.
  const subtotalPaise = lines.reduce((n, l) => n + l.taxablePaise, 0);
  const orderValuePaise = lines.reduce((n, l) => n + l.lineTotalPaise, 0);

  const billing: BillingInput = {
    gstin: input.billing?.gstin ?? null,
    stateCode: input.billing?.stateCode ?? null,
    name: input.billing?.name ?? null,
    addressLine: input.billing?.addressLine ?? null,
    city: input.billing?.city ?? null,
    state: input.billing?.state ?? null,
    pincode: input.billing?.pincode ?? null,
  };

  // Lines travel too (IDs + quantities only): the engine re-fetches
  // weights, categories and prices live — client figures never qualify.
  // The engine decides coverage, partner, ETA and state only; its
  // charge is ignored — delivery is included in the catalogue price.
  const delivery = await quoteDelivery(input.pincode, orderValuePaise, input.items);
  // ODA door delivery: a listed pincode flagged out-of-area may still
  // be served at a flat GST-exclusive base charge plus 18% GST when
  // the customer opts in. The server re-verifies the ODA verdict —
  // the flag alone never qualifies a pincode.
  const odaEligible =
    input.odaDoorDelivery === true &&
    delivery.coverage.listed &&
    delivery.coverage.oda === true;
  if ((!delivery.serviceable || !delivery.selected) && !odaEligible) {
    throw new AppError("VALIDATION_ERROR", NOT_SERVICEABLE_MESSAGE, 422);
  }

  // B2C orders have no billing state — use the delivery pincode's
  // state so intra-state customers get the CGST+SGST split.
  const customerStateCode =
    billing.stateCode ?? stateCodeFromName(delivery.coverage.state);

  // ODA base charge carries its own 18% GST (₹800 + ₹144), folded
  // into the order's tax split so the charge stays base-only in
  // delivery_charge and the DB total identity keeps holding.
  const odaGstPaise = odaEligible
    ? splitOdaCharge({
        chargePaise: getOdaChargePaise(),
        gstRate: getDeliveryGstRate(),
      }).taxPaise
    : 0;

  const tax = computeOrderTax({
    lines: lines.map((l) => ({
      taxablePaise: l.taxablePaise,
      gstPaise: l.lineTaxPaise,
    })),
    customerStateCode,
    businessStateCode: getBusinessStateCode(),
    deliveryGstPaise: odaGstPaise,
  });

  // ODA door delivery: no engine partner serves the pincode, so the
  // order carries a fixed descriptive partner and the base charge
  // (its 18% GST already lives in tax above).
  if (odaEligible) {
    const odaChargePaise = getOdaChargePaise();
    return {
      lines,
      subtotalPaise,
      tax,
      billing,
      deliveryPartnerId: null,
      deliveryPartnerName: "ODA Door Delivery",
      deliveryChargePaise: odaChargePaise,
      deliveryTaxPaise: odaGstPaise,
      deliveryWeightKg: delivery.totalWeightKg,
      deliveryRuleSummary: "ODA door delivery charge (base plus 18% GST)",
      etaDays: null,
      totalPaise: subtotalPaise + tax.totalGstPaise + odaChargePaise,
      pincode: delivery.pincode,
    };
  }

  return {
    lines,
    subtotalPaise,
    tax,
    billing,
    deliveryPartnerId: delivery.selected?.partner.id ?? null,
    deliveryPartnerName: delivery.selected?.partner.name ?? "Our delivery team",
    deliveryChargePaise: 0,
    deliveryTaxPaise: 0,
    deliveryWeightKg: delivery.totalWeightKg,
    deliveryRuleSummary: "Delivery included in product price",
    etaDays: delivery.selected?.etaDays ?? null,
    totalPaise: subtotalPaise + tax.totalGstPaise,
    pincode: delivery.pincode,
  };
}

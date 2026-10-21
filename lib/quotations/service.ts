import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/api/errors";
import { getOdaLineCopy, splitOdaCharge } from "@/lib/delivery/oda";
import { lookupDelhiveryPincode } from "@/lib/delivery/delhivery-pincodes";
import { getBusinessDetails } from "@/lib/invoices/business";
import { logOrderEvent } from "@/lib/admin/orders";
import {
  getBankDetails,
  getDeliveryGstRate,
  getDeliverySac,
  getQuotationAbout,
  getQuotationTerms,
  getQuotationValidityDays,
  getSignatory,
} from "@/lib/quotations/config";
import {
  buildQuotationData,
  canIssueQuotation,
  type QuotationData,
} from "@/lib/quotations/data";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Quotation issuance (server-only).
 *
 * Provisional documents for UNPAID orders — the mirror of invoice
 * issuance with the paid gate inverted:
 *   1. A frozen quotation row (same order) is returned as-is —
 *      re-downloads can never change, no matter what products,
 *      customers or configuration do later.
 *   2. Otherwise the order's snapshots are loaded, provisional-status
 *      eligibility is enforced (paid/fulfilled/cancelled orders are
 *      served by the tax invoice or nothing — never a fresh
 *      quotation), a server-side number is claimed (UNIQUE on order_id
 *      makes concurrent claims converge: losers read the winner), and
 *      the canonical document is frozen (first writer wins; concurrent
 *      writers build byte-identical content from the same snapshots).
 *
 * Reads/writes use the service-role client server-side only. Callers
 * (customer capability-URL route, admin route) own authorization; this
 * module never sees credentials and returns 404 for unknown orders so
 * both routes fail closed identically (no IDOR oracle).
 */

interface OrderSnapshot {
  id: string;
  order_number: string;
  created_at: string;
  payment_status: string;
  order_status: string;
  subtotal: string | number;
  delivery_charge: string | number;
  total_amount: string | number;
  delivery_pincode: string;
  delivery_partner_name: string;
  gstin_snapshot: string | null;
  tax_treatment: string;
  taxable_amount: string | number;
  cgst_amount: string | number;
  sgst_amount: string | number;
  igst_amount: string | number;
  billing_name: string | null;
  billing_address_line: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_state_code: string | null;
  billing_pincode: string | null;
  shipping_address: string | null;
  customer_name_snapshot: string;
  customer_phone_snapshot: string;
  customer_email_snapshot: string | null;
  /** Redeem code snapshot ("" when the order used no offer). */
  coupon_code: string | null;
  /** Rupees knocked off by the redeem code (0 when none). */
  discount_amount: string | number;
}

interface ItemSnapshot {
  product_name: string;
  quantity: number;
  unit_price: string | number;
  line_total: string | number;
  gst_rate_percent: string | number | null;
  line_tax_amount: string | number;
  hsn_snapshot: string | null;
}

/**
 * Exact NUMERIC(12,2) → integer paise (PostgREST serves JSON numbers
 * or decimal strings — both accepted, same fail-closed parse as the
 * invoice path).
 */
const toPaise = (decimal: string | number): number => {
  const text =
    typeof decimal === "number"
      ? Number.isFinite(decimal)
        ? decimal.toFixed(2)
        : ""
      : decimal.trim();
  const m = /^(-?\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) {
    throw new AppError("INTERNAL_ERROR", "Could not load the quotation.", 500);
  }
  const rupees = Number(m[1]);
  const frac = (m[2] ?? "").padEnd(2, "0");
  const paise = rupees * 100 + (rupees < 0 || Object.is(rupees, -0) ? -Number(frac) : Number(frac));
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new AppError("INTERNAL_ERROR", "Could not load the quotation.", 500);
  }
  return paise;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

function asFrozenQuotation(data: unknown): QuotationData | null {
  if (
    typeof data === "object" && data !== null &&
    (data as { version?: unknown }).version === 1 &&
    (data as { kind?: unknown }).kind === "quotation"
  ) {
    return data as QuotationData;
  }
  return null;
}

/** YYYY-MM-DD plus N days (calendar arithmetic, no DST surprises). */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export async function getQuotationData(orderId: string): Promise<QuotationData> {
  if (!UUID_RE.test(orderId)) {
    // Fail closed: malformed ids look exactly like missing orders.
    throw new AppError("NOT_FOUND", "Quotation not found.", 404);
  }
  const admin = createAdminClient();

  const { data: existing, error: existingError } = await admin
    .from("quotations")
    .select("data")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existingError) {
    throw new AppError("INTERNAL_ERROR", "Could not load the quotation.", 500);
  }
  const frozen = asFrozenQuotation(
    (existing as { data: unknown } | null)?.data,
  );
  if (frozen) return frozen;

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select(
      "id,order_number,created_at,payment_status,order_status,subtotal,delivery_charge," +
        "total_amount,delivery_pincode,delivery_partner_name,gstin_snapshot," +
        "tax_treatment,taxable_amount,cgst_amount,sgst_amount,igst_amount," +
        "billing_name,billing_address_line,billing_city,billing_state," +
        "billing_state_code,billing_pincode,shipping_address,customer_name_snapshot," +
        "customer_phone_snapshot,customer_email_snapshot,coupon_code,discount_amount",
    )
    .eq("id", orderId)
    .maybeSingle();
  const o = order as unknown as OrderSnapshot | null;
  if (orderError || !o) {
    throw new AppError("NOT_FOUND", "Quotation not found.", 404);
  }

  // Quotations are provisional: paid/fulfilled/cancelled orders are
  // served by the tax invoice (or nothing) — never a fresh quotation.
  if (!canIssueQuotation(o.order_status)) {
    throw new AppError(
      "QUOTATION_NOT_AVAILABLE",
      "A quotation is issued while the order is still provisional.",
      409,
    );
  }

  const [{ data: items }, { data: payment }] = await Promise.all([
    admin
      .from("order_items")
      .select(
        "product_name,quantity,unit_price,line_total," +
          "gst_rate_percent,line_tax_amount,hsn_snapshot",
      )
      .eq("order_id", o.id)
      .order("product_name"),
    admin
      .from("payments")
      .select("method")
      .eq("order_id", o.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const rows = (items ?? []) as unknown as ItemSnapshot[];
  const pay = payment as unknown as { method: string } | null;

  const { data: numberData, error: numberError } = await admin.rpc(
    "generate_quotation_number",
  );
  if (numberError || typeof numberData !== "string") {
    throw new AppError("INTERNAL_ERROR", "Could not number the quotation.", 500);
  }

  // Claim the number. A concurrent claim for the same order wins via
  // the UNIQUE constraint; the loser falls through to the winner's row.
  // Only the winning claim emits QUOTATION_ISSUED (tracked by the flag).
  // Validity is anchored to the DB-clock quotation date below, so every
  // builder derives the same window from the same frozen row.
  const today = new Date().toISOString().slice(0, 10);
  const { error: insertError } = await admin.from("quotations").insert({
    order_id: o.id,
    quotation_number: numberData,
    quotation_date: today,
    valid_till: addDays(today, await getQuotationValidityDays()),
  });
  if (insertError && !isUniqueViolation(insertError)) {
    throw new AppError("INTERNAL_ERROR", "Could not create the quotation.", 500);
  }
  const claimedRow = !insertError;

  // Canonical number + dates come from the stored row (DB clock), so the
  // frozen document always matches its row even if a concurrent claim won.
  const { data: claimed, error: claimedError } = await admin
    .from("quotations")
    .select("quotation_number,quotation_date,valid_till")
    .eq("order_id", o.id)
    .maybeSingle();
  const claim = claimed as unknown as {
    quotation_number: string;
    quotation_date: string;
    valid_till: string;
  } | null;
  if (claimedError || !claim) {
    throw new AppError("INTERNAL_ERROR", "Could not load the quotation.", 500);
  }

  // Cartage: quoted freight carries its own GST while the order is a
  // GST quotation; non-GST quotations carry none (same trigger rule as
  // the order engine — GSTIN presence). A zero charge (all-inclusive
  // order) renders the "included" row; a positive charge is the flat
  // ODA door-delivery BASE fee (default ₹800), whose 18% GST is
  // charged on top (base + tax = what the customer pays) and is
  // ALREADY folded into the order's tax columns by the order engine.
  const treatment = o.tax_treatment === "gst" ? "gst" : "non_gst";
  const cartageRate = treatment === "gst" ? getDeliveryGstRate() : null;
  const odaChargePaise = toPaise(o.delivery_charge);
  const split = splitOdaCharge({
    chargePaise: odaChargePaise,
    gstRate: cartageRate,
  });
  const cartageChargePaise = split.freightPaise;
  const cartageTaxPaise = split.taxPaise;
  const cartageCopy =
    odaChargePaise === 0
      ? { name: "Delivery", description: "Included in the quoted item prices" }
      : getOdaLineCopy();

  const built = buildQuotationData({
    quotationNumber: claim.quotation_number,
    quotationDate: claim.quotation_date.slice(0, 10),
    validTill: claim.valid_till.slice(0, 10),
    orderNumber: o.order_number,
    orderCreatedAt: o.created_at,
    orderStatus: o.order_status,
    paymentMethod: pay?.method ?? "upi",
    business: await getBusinessDetails(),
    bank: getBankDetails(),
    signatory: getSignatory(),
    terms: getQuotationTerms(),
    about: getQuotationAbout(),
    // Place of supply: B2B orders carry the billing state; B2C orders
    // (null billing state) fall back to the delivery pincode's state so
    // the field never renders "—".
    placeOfSupply:
      o.billing_state ?? lookupDelhiveryPincode(o.delivery_pincode).state,
    customer: {
      name: o.customer_name_snapshot,
      phone: o.customer_phone_snapshot,
      email: o.customer_email_snapshot,
      gstin: o.gstin_snapshot,
    },
    billing: {
      name: o.billing_name,
      addressLine: o.billing_address_line,
      city: o.billing_city,
      state: o.billing_state,
      stateCode: o.billing_state_code,
      pincode: o.billing_pincode,
    },
    shipping: {
      name: o.customer_name_snapshot,
      phone: o.customer_phone_snapshot,
      pincode: o.delivery_pincode,
      partnerName: o.delivery_partner_name,
      addressLine: o.shipping_address,
    },
    items: rows.map((r) => {
      const lineTotalPaise = toPaise(r.line_total);
      return {
        name: r.product_name,
        description: "",
        quantity: r.quantity,
        unitPricePaise: toPaise(r.unit_price),
        lineTotalPaise,
        gstRate: r.gst_rate_percent,
        lineTaxPaise: toPaise(r.line_tax_amount),
        hsn: r.hsn_snapshot,
      };
    }),
    cartage: {
      name: cartageCopy.name,
      description: cartageCopy.description,
      chargePaise: cartageChargePaise,
      sac: getDeliverySac(),
      gstRate: cartageRate,
      taxPaise: cartageTaxPaise,
    },
    totals: {
      treatment,
      subtotalPaise: toPaise(o.subtotal) + cartageChargePaise,
      deliveryPaise: cartageChargePaise,
      deliveryTaxPaise: cartageTaxPaise,
      taxablePaise: toPaise(o.taxable_amount),
      // Redeem discount netted exactly like the orders_total_check
      // constraint (total = subtotal + delivery + tax − discount), so
      // the quoted total matches the amount the customer pays.
      discountPaise: toPaise(o.discount_amount ?? 0),
      couponCode: o.coupon_code ?? null,
      // The delivery GST is already folded into the order's own split
      // by the order engine (base charge + 18% GST), so the CGST/SGST
      // or IGST is read straight from the order — never re-added here.
      cgstPaise: toPaise(o.cgst_amount),
      sgstPaise: toPaise(o.sgst_amount),
      igstPaise: toPaise(o.igst_amount),
      grandTotalPaise:
        toPaise(o.subtotal) + cartageChargePaise +
        toPaise(o.cgst_amount) + toPaise(o.sgst_amount) +
        toPaise(o.igst_amount) -
        toPaise(o.discount_amount ?? 0),
    },
  });

  // Freeze once. Concurrent builders derive identical content from the
  // same snapshots, so first-writer-wins is deterministic.
  const { error: updateError } = await admin
    .from("quotations")
    .update({ data: built })
    .eq("order_id", o.id);
  if (updateError) {
    throw new AppError("INTERNAL_ERROR", "Could not load the quotation.", 500);
  }

  if (claimedRow) {
    // First and only issuance event for this order (actor system — no
    // user session on the guest quotation path). Re-downloads return the
    // frozen row above and emit nothing.
    await logOrderEvent({
      orderId: o.id,
      eventType: "QUOTATION_ISSUED",
      actorType: "system",
      actorUserId: null,
      toStatus: o.order_status,
      metadata: { quotation_number: claim.quotation_number },
      client: admin,
    });
  }

  const { data: stored, error: storedError } = await admin
    .from("quotations")
    .select("data")
    .eq("order_id", orderId)
    .maybeSingle();
  if (storedError) {
    throw new AppError("INTERNAL_ERROR", "Could not load the quotation.", 500);
  }
  const canonical = asFrozenQuotation(
    (stored as { data: unknown } | null)?.data,
  );
  // The DB trigger forbids altering frozen data, so a missing row here
  // means something is seriously wrong — fail closed, never render ad-hoc.
  if (!canonical) {
    throw new AppError("INTERNAL_ERROR", "Could not load the quotation.", 500);
  }
  return canonical;
}

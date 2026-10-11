import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppError } from "@/lib/api/errors";
import {
  getBusinessDetails,
  getInvoicePrefix,
} from "@/lib/invoices/business";
import {
  buildInvoiceData,
  canIssueInvoice,
  type InvoiceData,
} from "@/lib/invoices/data";
import { logOrderEvent } from "@/lib/admin/orders";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Invoice issuance (server-only).
 *
 * On-demand, exactly-once, immutable:
 *   1. A frozen invoice row (same order) is returned as-is — re-downloads
 *      can never change, no matter what products/customers do later.
 *   2. Otherwise the order's snapshots are loaded, the paid gate is
 *      enforced, a server-side number is claimed (UNIQUE on order_id
 *      makes concurrent claims converge: losers read the winner), and
 *      the canonical document is frozen (first writer wins; concurrent
 *      writers build byte-identical content from the same snapshots).
 *
 * Reads/writes use the service-role client server-side only. Callers
 * (customer capability-URL route, admin route) own authorization; this
 * module never sees credentials and returns 404 for unknown orders so
 * both routes fail closed identically (no IDOR oracle).
 */

// Money columns are NUMERIC: PostgREST serves them as JSON numbers or
// decimal strings depending on the client — typed as both so a shape
// change can never become a runtime TypeError on the invoice path.
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
  customer_name_snapshot: string;
  customer_phone_snapshot: string;
  customer_email_snapshot: string | null;
}

interface ItemSnapshot {
  product_name: string;
  quantity: number;
  unit_price: string | number;
  line_total: string | number;
  gst_rate_percent: string | number | null;
  line_tax_amount: string | number;
}

/**
 * Exact NUMERIC(12,2) → integer paise (no floats: "1133.82" → 113382).
 * PostgREST returns NUMERIC columns as JSON numbers (12598.00 → 12598)
 * or strings depending on the client — both shapes are accepted and
 * normalized through the same exact decimal parse. Anything off-shape
 * fails closed — a tax document must never be built from a mis-parsed
 * amount.
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
    throw new AppError("INTERNAL_ERROR", "Could not load the invoice.", 500);
  }
  const rupees = Number(m[1]);
  const frac = (m[2] ?? "").padEnd(2, "0");
  const paise = rupees * 100 + (rupees < 0 || Object.is(rupees, -0) ? -Number(frac) : Number(frac));
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new AppError("INTERNAL_ERROR", "Could not load the invoice.", 500);
  }
  return paise;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

function asFrozenInvoice(data: unknown): InvoiceData | null {
  if (
    typeof data === "object" && data !== null &&
    (data as { version?: unknown }).version === 1
  ) {
    return data as InvoiceData;
  }
  return null;
}

export async function getInvoiceData(orderId: string): Promise<InvoiceData> {
  if (!UUID_RE.test(orderId)) {
    // Fail closed: malformed ids look exactly like missing orders.
    throw new AppError("NOT_FOUND", "Invoice not found.", 404);
  }
  const admin = createAdminClient();

  const { data: existing, error: existingError } = await admin
    .from("invoices")
    .select("data")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existingError) {
    throw new AppError("INTERNAL_ERROR", "Could not load the invoice.", 500);
  }
  const frozen = asFrozenInvoice(
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
        "billing_state_code,billing_pincode,customer_name_snapshot," +
        "customer_phone_snapshot,customer_email_snapshot",
    )
    .eq("id", orderId)
    .maybeSingle();
  const o = order as unknown as OrderSnapshot | null;
  if (orderError || !o) {
    throw new AppError("NOT_FOUND", "Invoice not found.", 404);
  }

  // Final tax invoices are issued for paid orders only — an unpaid
  // document must never be labelled as a paid invoice.
  if (!canIssueInvoice(o.payment_status)) {
    throw new AppError(
      "INVOICE_NOT_AVAILABLE",
      "The tax invoice is issued after payment verification.",
      409,
    );
  }

  const [{ data: items }, { data: payment }] = await Promise.all([
    admin
      .from("order_items")
      .select(
        "product_name,quantity,unit_price,line_total," +
          "gst_rate_percent,line_tax_amount",
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
    "generate_invoice_number",
    { p_prefix: getInvoicePrefix() },
  );
  if (numberError || typeof numberData !== "string") {
    throw new AppError("INTERNAL_ERROR", "Could not number the invoice.", 500);
  }

  // Claim the number. A concurrent claim for the same order wins via
  // the UNIQUE constraint; the loser falls through to the winner's row.
  // Only the winning claim emits INVOICE_ISSUED (tracked by the flag).
  const { error: insertError } = await admin.from("invoices").insert({
    order_id: o.id,
    invoice_number: numberData,
  });
  if (insertError && !isUniqueViolation(insertError)) {
    throw new AppError("INTERNAL_ERROR", "Could not create the invoice.", 500);
  }
  const claimedRow = !insertError;

  // Canonical number + date come from the stored row (DB clock), so the
  // frozen document always matches its row even if a concurrent claim won.
  const { data: claimed, error: claimedError } = await admin
    .from("invoices")
    .select("invoice_number,invoice_date")
    .eq("order_id", o.id)
    .maybeSingle();
  const claim = claimed as unknown as {
    invoice_number: string;
    invoice_date: string;
  } | null;
  if (claimedError || !claim) {
    throw new AppError("INTERNAL_ERROR", "Could not load the invoice.", 500);
  }

  const built = buildInvoiceData({
    invoiceNumber: claim.invoice_number,
    invoiceDate: claim.invoice_date.slice(0, 10),
    orderNumber: o.order_number,
    orderCreatedAt: o.created_at,
    paymentStatus: o.payment_status,
    paymentMethod: pay?.method ?? "upi",
    business: getBusinessDetails(),
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
    },
    items: rows.map((r) => ({
      name: r.product_name,
      quantity: r.quantity,
      unitPricePaise: toPaise(r.unit_price),
      lineTotalPaise: toPaise(r.line_total),
      gstRate: r.gst_rate_percent,
      lineTaxPaise: toPaise(r.line_tax_amount),
    })),
    totals: {
      treatment: o.tax_treatment === "gst" ? "gst" : "non_gst",
      subtotalPaise: toPaise(o.subtotal),
      deliveryPaise: toPaise(o.delivery_charge),
      taxablePaise: toPaise(o.taxable_amount),
      cgstPaise: toPaise(o.cgst_amount),
      sgstPaise: toPaise(o.sgst_amount),
      igstPaise: toPaise(o.igst_amount),
      grandTotalPaise: toPaise(o.total_amount),
    },
  });

  // Freeze once. Concurrent builders derive identical content from the
  // same snapshots, so first-writer-wins is deterministic.
  const { error: updateError } = await admin
    .from("invoices")
    .update({ data: built })
    .eq("order_id", o.id);
  if (updateError) {
    throw new AppError("INTERNAL_ERROR", "Could not load the invoice.", 500);
  }

  if (claimedRow) {
    // First and only issuance event for this order (actor system — no
    // user session on the guest invoice path). Re-downloads return the
    // frozen row above and emit nothing.
    await logOrderEvent({
      orderId: o.id,
      eventType: "INVOICE_ISSUED",
      actorType: "system",
      actorUserId: null,
      toStatus: o.order_status,
      metadata: { invoice_number: claim.invoice_number },
      client: admin,
    });
  }

  const { data: stored, error: storedError } = await admin
    .from("invoices")
    .select("data")
    .eq("order_id", orderId)
    .maybeSingle();
  if (storedError) {
    throw new AppError("INTERNAL_ERROR", "Could not load the invoice.", 500);
  }
  const canonical = asFrozenInvoice(
    (stored as { data: unknown } | null)?.data,
  );
  // The DB trigger forbids altering frozen data, so a missing row here
  // means something is seriously wrong — fail closed, never render ad-hoc.
  if (!canonical) {
    throw new AppError("INTERNAL_ERROR", "Could not load the invoice.", 500);
  }
  return canonical;
}

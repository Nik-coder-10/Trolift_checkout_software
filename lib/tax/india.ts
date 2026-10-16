/**
 * Indian GST calculation (pure, integer paise only, unit-tested).
 *
 * Model:
 * - Catalogue prices are GST-exclusive (taxable base).
 * - Each line carries its own GST rate from the live product row
 *   (NULL = no GST configured → 0%).
 * - GST applies to every order (B2C and B2B alike). A GSTIN only
 *   selects the invoice identity — it no longer gates the tax.
 * - Same-state sale  → CGST + SGST split of the total GST.
 * - Inter-state sale → IGST (full GST as one component).
 * - Delivery (third-party freight) carries its own GST rate
 *   (default 18%) folded into the same CGST/SGST or IGST split.
 *
 * ROUNDING (deterministic, exact integers throughout):
 *   line_gst_i   = round(line_taxable_i × rate_i / 100)
 *   delivery_gst = round(delivery × delivery_rate / 100)
 *   total_gst    = Σ line_gst_i + delivery_gst
 *   same-state:  cgst = floor(total_gst / 2), sgst = total_gst − cgst
 *   inter-state: igst = total_gst
 * so cgst + sgst ≡ igst ≡ total_gst always, with no float anywhere.
 *
 * taxable_amount stays the goods subtotal (Σ line values) — the
 * invoice builder requires that identity; delivery tax lives only in
 * the cgst/sgst/igst split.
 */

export type TaxType = "none" | "cgst_sgst" | "igst";

export interface TaxedLineInput {
  lineTotalPaise: number;
  /** GST percent as a decimal string (NUMERIC), or null when unset. A JSON number from PostgREST is accepted too. */
  gstRate: string | number | null;
}

export interface OrderTax {
  treatment: "non_gst" | "gst";
  type: TaxType;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalGstPaise: number;
}

export interface IndianState {
  code: string;
  name: string;
}

export const INDIAN_STATES: ReadonlyArray<IndianState> = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "25", name: "Daman and Diu (legacy — merged into 26; old GSTINs only)" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "28", name: "Andhra Pradesh (pre-division legacy)" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];

// Note: codes 97 (Other Territory) and 99 (Centre Jurisdiction) are NOT
// billing states — they never select a CGST+SGST vs IGST split here.
// An order carrying such a code falls back to IGST by construction
// (sameState requires an exact match with the business state).

export function isStateCode(code: string): boolean {
  return INDIAN_STATES.some((s) => s.code === code);
}

/**
 * First two digits of a GSTIN — the registrant's state code per the
 * CBIC GST state-code list. Returns null when the GSTIN is not
 * 15 characters (callers format-check first).
 */
export function gstinStateCode(gstin: string): string | null {
  const v = gstin.trim().toUpperCase();
  if (v.length !== 15) return null;
  return v.slice(0, 2);
}

/**
 * GSTIN-vs-billing cross-check: a billing profile's state code should
 * equal the GSTIN's embedded state code (the GSTIN is issued per state —
 * a mismatch is almost always a typo, and ITC follows the billing
 * state). Legacy codes (25/28) are accepted as-is: the check is pure
 * equality, not a validity judgement on either side.
 */
export function gstinMatchesBillingState(
  gstin: string,
  billingStateCode: string,
): boolean {
  const embedded = gstinStateCode(gstin);
  if (embedded === null) return false;
  return embedded === billingStateCode;
}

/**
 * Trolift's home state for intra/inter-state decisions. Configured via
 * TROLIFT_STATE_CODE (2-digit GST state code) — never hard-coded.
 * Null when unconfigured: GST orders then fall back to IGST until
 * Trolift confirms its home state.
 */
export function getBusinessStateCode(): string | null {
  const code = (process.env.TROLIFT_STATE_CODE ?? "").trim();
  return isStateCode(code) ? code : null;
}

export function parseGstRate(value: string | number | null): number {
  if (value === null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return 0;
  return n;
}

/** Map a full state name (e.g. "Maharashtra") to its 2-digit GST code. */
export function stateCodeFromName(name: string | null): string | null {
  if (name === null) return null;
  const needle = name.trim().toLowerCase();
  if (needle === "") return null;
  return INDIAN_STATES.find((s) => s.name.toLowerCase() === needle)?.code ?? null;
}

/**
 * Compute order tax from priced lines plus the delivery charge.
 * GST applies to every order — a GSTIN is not required. taxablePaise
 * is ALWAYS the goods subtotal (it must equal the order subtotal —
 * downstream invoice verification requires this identity). Delivery
 * GST is folded into the cgst/sgst/igst split so the DB total check
 * (total = subtotal + delivery + tax) still holds.
 *
 * customerStateCode drives the CGST+SGST vs IGST split; when null
 * (B2C, no billing profile) the caller should pass the delivery
 * pincode's state so intra-state orders still split correctly.
 * An unconfigured business state falls back to IGST (documented).
 */
export function computeOrderTax(input: {
  lines: TaxedLineInput[];
  customerStateCode: string | null;
  businessStateCode: string | null;
  /** Delivery charge in paise (0 when free). Taxed at deliveryGstRate. */
  deliveryChargePaise?: number;
  /** GST percent on delivery; null/undefined = untaxed delivery. */
  deliveryGstRate?: string | number | null;
}): OrderTax {
  const taxablePaise = input.lines.reduce((n, l) => n + l.lineTotalPaise, 0);
  const lineTaxes = input.lines.map((l) =>
    Math.round((l.lineTotalPaise * parseGstRate(l.gstRate)) / 100),
  );
  let totalGstPaise = lineTaxes.reduce((n, t) => n + t, 0);

  const deliveryChargePaise = input.deliveryChargePaise ?? 0;
  const deliveryGstRate = input.deliveryGstRate ?? null;
  if (deliveryChargePaise > 0 && deliveryGstRate !== null) {
    totalGstPaise += Math.round(
      (deliveryChargePaise * parseGstRate(deliveryGstRate)) / 100,
    );
  }

  const sameState =
    input.customerStateCode !== null &&
    input.businessStateCode !== null &&
    input.customerStateCode === input.businessStateCode;

  if (sameState) {
    const cgstPaise = Math.floor(totalGstPaise / 2);
    return {
      treatment: "gst",
      type: "cgst_sgst",
      taxablePaise,
      cgstPaise,
      sgstPaise: totalGstPaise - cgstPaise,
      igstPaise: 0,
      totalGstPaise,
    };
  }
  return {
    treatment: "gst",
    type: "igst",
    taxablePaise,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: totalGstPaise,
    totalGstPaise,
  };
}

/** Per-line GST for snapshots/invoices (same rounding as the order). */
export function lineTaxPaise(lineTotalPaise: number, gstRate: string | number | null): number {
  return Math.round((lineTotalPaise * parseGstRate(gstRate)) / 100);
}

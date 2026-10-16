/**
 * Indian GST calculation (pure, integer paise only, unit-tested).
 *
 * Model (all-inclusive pricing, 0035):
 * - Catalogue prices are GST-INCLUSIVE MRPs — they already contain
 *   the product's GST AND the absorbed delivery cost.
 * - Each line carries its own GST rate from the live product row
 *   (NULL = no GST configured → 0%).
 * - The taxable value and GST are REVERSE-COMPUTED from the inclusive
 *   price: taxable = round(inclusive × 100/(100+rate)), GST = the
 *   complement — so taxable + GST reconstructs the charged amount
 *   exactly (no paisa is created or lost).
 * - Per-line taxable values are extracted per UNIT first and multiplied
 *   by quantity, keeping line_total = unit_price × quantity exact in
 *   the database.
 * - Same-state sale  → CGST + SGST split of the total GST.
 * - Inter-state sale → IGST (full GST as one component).
 * - Delivery is included in the catalogue price; orders carry no
 *   separate delivery charge (serviceability only).
 *
 * ROUNDING (deterministic, exact integers throughout):
 *   unit_taxable_i = round(unit_incl_i × 100 / (100 + rate_i))
 *   line_taxable_i = unit_taxable_i × qty_i
 *   line_gst_i     = line_incl_i − line_taxable_i
 *   total_gst      = Σ line_gst_i
 *   same-state:  cgst = floor(total_gst / 2), sgst = total_gst − cgst
 *   inter-state: igst = total_gst
 * so cgst + sgst ≡ igst ≡ total_gst always, with no float anywhere.
 *
 * taxable_amount stays the sum of line taxable values — the invoice
 * builder requires that identity (subtotal === taxable === Σ lines).
 */

export type TaxType = "none" | "cgst_sgst" | "igst";

export interface TaxedLineInput {
  /** Taxable (pre-GST) value of the line, integer paise. */
  taxablePaise: number;
  /** GST embedded in the line's inclusive total, integer paise. */
  gstPaise: number;
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
 * Taxable value extracted from a GST-INCLUSIVE amount. Exact inverse
 * of the embedded-GST complement: round(P × 100/(100+rate)).
 */
export function inclusiveTaxablePaise(
  inclusivePaise: number,
  gstRate: string | number | null,
): number {
  return Math.round((inclusivePaise * 100) / (100 + parseGstRate(gstRate)));
}

/** GST embedded in a GST-INCLUSIVE amount (complement — never rounds away). */
export function inclusiveGstPaise(
  inclusivePaise: number,
  gstRate: string | number | null,
): number {
  return inclusivePaise - inclusiveTaxablePaise(inclusivePaise, gstRate);
}

export interface SplitLine {
  /** Inclusive unit price (paise) — what the customer sees. */
  unitPricePaise: number;
  /** Inclusive line total = unit × qty (paise). */
  lineTotalPaise: number;
  /** Taxable unit price (paise) — persisted as unit_price. */
  unitTaxablePaise: number;
  /** Taxable line total = unitTaxable × qty (paise) — persisted as line_total. */
  taxablePaise: number;
  /** Embedded line GST = lineTotal − taxable (paise) — line_tax_amount. */
  gstPaise: number;
}

/**
 * Split one order line from its inclusive unit price. Unit-first
 * rounding keeps line_total = unit_price × quantity exact in the DB
 * and taxable + gst reconstructs the charged line total exactly.
 */
export function splitInclusiveLine(
  unitInclusivePaise: number,
  quantity: number,
  gstRate: string | number | null,
): SplitLine {
  const unitTaxablePaise = inclusiveTaxablePaise(unitInclusivePaise, gstRate);
  const lineTotalPaise = unitInclusivePaise * quantity;
  const taxablePaise = unitTaxablePaise * quantity;
  return {
    unitPricePaise: unitInclusivePaise,
    lineTotalPaise,
    unitTaxablePaise,
    taxablePaise,
    gstPaise: lineTotalPaise - taxablePaise,
  };
}

/**
 * Compute order tax from pre-split lines (taxable + embedded GST).
 * GST applies to every order — a GSTIN is not required. taxablePaise
 * is ALWAYS the sum of line taxable values (it must equal the order
 * subtotal — downstream invoice verification requires this identity).
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
}): OrderTax {
  const taxablePaise = input.lines.reduce((n, l) => n + l.taxablePaise, 0);
  const totalGstPaise = input.lines.reduce((n, l) => n + l.gstPaise, 0);

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

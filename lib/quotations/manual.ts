import {
  buildQuotationData,
  type BuildQuotationInput,
  type QuotationData,
} from "@/lib/quotations/data";
import {
  inclusiveTaxablePaise,
  parseGstRate,
  stateCodeFromName,
} from "@/lib/tax/india";
import {
  isValidEmail,
  isValidGstinChecksum,
  isValidIndianPhone,
  normalizeGstin,
  normalizePhone,
} from "@/lib/validations/common";
import type { BusinessDetails } from "@/lib/invoices/business";
import type { BankDetails, Signatory } from "@/lib/quotations/config";

/**
 * Admin quotation maker (pure, unit-tested).
 *
 * A manual quotation is the same document as an order quotation —
 * identical PDF layout, numbering, terms and validity — but its prices
 * and delivery charge are typed by staff for a dealer, distributor or
 * customer instead of being read from an order. There is no order
 * behind it, so this module assembles the canonical QuotationData
 * directly from the form:
 *
 *   * Prices are entered GST-EXCLUSIVE. Tax is added on top per line at
 *     the line's own GST rate (quotation lines carry a per-line rate,
 *     exactly like catalogue items), and the delivery charge is a
 *     GST-exclusive freight amount with GST added at the configured
 *     delivery rate. Both shapes are the "add-on" shapes that
 *     buildQuotationData re-verifies.
 *   * CGST+SGST vs IGST follows the place of supply: quoting a party in
 *     the seller's own state splits intra-state, anything else (or an
 *     unconfigured seller state) is IGST — the same rule the order
 *     engine uses, never a per-document toggle that could contradict
 *     the printed address.
 *   * "Without GST" drops every tax amount and the party GSTIN (a
 *     non-GST document carries no input-credit identity).
 *
 * All money is integer paise from the moment it is parsed; a value that
 * cannot be represented exactly is a validation error, never a rounded
 * surprise on the customer's document.
 */

export const PARTY_TYPES = ["dealer", "distributor", "customer"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

/** Upper bounds that keep a hand-typed document sane (and the PDF 1–2 pages). */
export const MAX_ITEMS = 25;
export const MAX_QUANTITY = 9999;
/** ₹10,00,00,000 per line — far beyond any material-handling quote. */
const MAX_PAISE = 1_000_000_000_00;

export interface ManualQuotationLineForm {
  name: string;
  description: string;
  hsn: string;
  quantity: string;
  unitPrice: string;
  gstRate: string;
}

export interface ManualQuotationForm {
  partyType: string;
  name: string;
  businessName: string;
  phone: string;
  email: string;
  gstin: string;
  // Billing address
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  // Shipping address
  sameAsBilling: boolean;
  shippingAddressLine: string;
  shippingCity: string;
  shippingState: string;
  shippingPincode: string;
  items: ManualQuotationLineForm[];
  deliveryCharge: string;
  withGst: boolean;
  validityDays: string;
}

export interface ManualQuotationItem {
  name: string;
  description: string;
  hsn: string | null;
  quantity: number;
  /** GST-exclusive unit price, integer paise. */
  unitPricePaise: number;
  /** GST percent as a decimal string; null = 0%. */
  gstRate: string | null;
}

export interface ManualQuotationInput {
  partyType: PartyType;
  name: string;
  businessName: string | null;
  phone: string;
  email: string | null;
  gstin: string | null;
  // Billing address
  addressLine: string | null;
  city: string | null;
  pincode: string | null;
  /** Place of supply (state name); null for non-GST quotes. */
  state: string | null;
  // Shipping address
  sameAsBilling: boolean;
  shippingAddressLine: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPincode: string | null;
  withGst: boolean;
  validityDays: number;
  items: ManualQuotationItem[];
  deliveryChargePaise: number;
}

export type ManualQuotationErrors = Record<string, string>;

export type ParseResult =
  | { ok: true; value: ManualQuotationInput }
  | { ok: false; errors: ManualQuotationErrors };

const EMPTY_FORM: ManualQuotationLineForm = {
  name: "",
  description: "",
  hsn: "",
  quantity: "1",
  unitPrice: "",
  gstRate: "18",
};

/** A blank maker form (new line, default quantities and rate). */
export function emptyManualQuotationForm(): ManualQuotationForm {
  return {
    partyType: "dealer",
    name: "",
    businessName: "",
    phone: "",
    email: "",
    gstin: "",
    addressLine: "",
    city: "",
    state: "",
    pincode: "",
    sameAsBilling: true,
    shippingAddressLine: "",
    shippingCity: "",
    shippingState: "",
    shippingPincode: "",
    items: [{ ...EMPTY_FORM }],
    deliveryCharge: "0",
    withGst: true,
    validityDays: "7",
  };
}

/** Blank line with inherited GST rate (a new row starts like the last one). */
export function emptyManualQuotationLine(gstRate = "18"): ManualQuotationLineForm {
  return { ...EMPTY_FORM, gstRate };
}

/** A catalogue item offered in the maker's picker (prices GST-inclusive). */
export interface QuotableProduct {
  id: string;
  name: string;
  description: string;
  hsn: string | null;
  /** Catalogue GST percent (decimal string); null = not configured. */
  gstRate: string | null;
  /** Storefront price, GST-INCLUSIVE, integer paise. */
  pricePaise: number;
}

/** A catalogue row, as the maker needs it (prices are GST-inclusive). */
export interface CatalogueProductLike {
  name: string;
  description?: string | null;
  hsn?: string | null;
  gstRate?: string | number | null;
  /** Storefront price, GST-inclusive, integer paise. */
  pricePaise: number;
}

/** Rupees text with exactly two decimals — what the rate input shows. */
function rupeesText(paise: number): string {
  const safe = Number.isSafeInteger(paise) && paise >= 0 ? paise : 0;
  return (safe / 100).toFixed(2);
}

/**
 * Prefill a maker line from a listed catalogue item.
 *
 * Catalogue prices are GST-INCLUSIVE (GST and delivery absorbed), while
 * the maker quotes GST-exclusive rates — so the rate is reverse-computed
 * from the item's own GST rate, keeping "catalogue price" and "quoted
 * rate" the same money once tax is added back. Name, description, HSN
 * and GST rate come along too; every field stays editable, because the
 * whole point of the maker is quoting a dealer price that differs from
 * the storefront.
 */
export function manualLineFromProduct(
  product: CatalogueProductLike,
): ManualQuotationLineForm {
  const rate = parseGstRate(product.gstRate ?? null);
  const taxablePaise = inclusiveTaxablePaise(product.pricePaise, rate);
  return {
    name: product.name.trim().slice(0, 200),
    description: (product.description ?? "").trim().slice(0, 300),
    hsn: (product.hsn ?? "").trim(),
    quantity: "1",
    unitPrice: rupeesText(taxablePaise),
    gstRate: String(rate),
  };
}

function str(value: unknown, max = 500): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/**
 * Rupees text → integer paise. Accepts "24999", "24,999.00", " 800.5 ".
 * Returns null when the amount is malformed, negative or too large —
 * callers turn that into a field error.
 */
export function parseRupeesToPaise(value: string): number | null {
  const cleaned = value.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const rupees = Number(m[1]);
  const paise = Number((m[2] ?? "").padEnd(2, "0"));
  const total = rupees * 100 + paise;
  if (!Number.isSafeInteger(total) || total > MAX_PAISE) return null;
  return total;
}

function wholeNumber(value: string, min: number, max: number): number | null {
  const cleaned = value.trim();
  if (!/^\d{1,6}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * Validate + normalise a maker payload. Errors are keyed by form field
 * ("name", "items.0.unitPrice", …) so the client can highlight exactly
 * the offending input; the service rejects the whole payload when any
 * key is present.
 */
export function parseManualQuotationInput(
  payload: unknown,
  opts?: { validityDays?: { min: number; max: number } },
): ParseResult {
  const raw =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const errors: ManualQuotationErrors = {};

  const partyType = str(raw.partyType, 20).toLowerCase();
  if (!PARTY_TYPES.includes(partyType as PartyType)) {
    errors.partyType = "Choose dealer, distributor or customer.";
  }

  const name = str(raw.name, 200);
  if (name === "") errors.name = "Enter the party's name.";

  const phoneRaw = str(raw.phone, 30);
  if (phoneRaw === "") errors.phone = "Enter a contact number.";
  else if (!isValidIndianPhone(phoneRaw)) {
    errors.phone = "Enter a valid 10-digit Indian mobile number.";
  }

  const email = str(raw.email, 254);
  if (email !== "" && !isValidEmail(email)) {
    errors.email = "Enter a valid email address.";
  }

  const withGst = raw.withGst !== false;

  const gstinRaw = normalizeGstin(str(raw.gstin, 20));
  let gstin: string | null = gstinRaw === "" ? null : gstinRaw;
  if (withGst && gstin !== null && !isValidGstinChecksum(gstin)) {
    errors.gstin = "Enter a valid 15-character GSTIN (checksum included).";
  }
  // A non-GST document carries no GSTIN: the builder refuses one, and
  // input credit cannot be claimed on a quote with no tax anyway.
  if (!withGst) gstin = null;

  const addressLine = str(raw.addressLine, 300) || null;
  if (withGst && gstin !== null && addressLine === null) {
    errors.addressLine = "A GST quote prints the billing address — add it.";
  }

  const city = str(raw.city, 100) || null;
  const stateName = str(raw.state, 100);
  const pincode = str(raw.pincode, 6);
  if (pincode !== "" && !/^[1-9][0-9]{5}$/.test(pincode)) {
    errors.pincode = "Enter a valid 6-digit pincode (or leave it blank).";
  }
  let state: string | null = null;
  if (stateName !== "") {
    if (stateCodeFromName(stateName) === null) {
      errors.state = "Choose a state from the list.";
    } else {
      state = stateName;
    }
  }
  if (withGst && state === null) {
    errors.state = "Place of supply decides the GST split — choose a state.";
  }

  const sameAsBilling = raw.sameAsBilling !== false;
  let shippingAddressLine: string | null = null;
  let shippingCity: string | null = null;
  let shippingState: string | null = null;
  let shippingPincode: string | null = null;

  if (sameAsBilling) {
    shippingAddressLine = addressLine;
    shippingCity = city;
    shippingState = state;
    shippingPincode = pincode !== "" ? pincode : null;
  } else {
    shippingAddressLine = str(raw.shippingAddressLine, 300) || null;
    shippingCity = str(raw.shippingCity, 100) || null;
    const shipPin = str(raw.shippingPincode, 6);
    if (shipPin !== "" && !/^[1-9][0-9]{5}$/.test(shipPin)) {
      errors.shippingPincode = "Enter a valid 6-digit pincode (or leave it blank).";
    }
    shippingPincode = shipPin !== "" ? shipPin : null;

    const shipStateName = str(raw.shippingState, 100);
    if (shipStateName !== "") {
      if (stateCodeFromName(shipStateName) === null) {
        errors.shippingState = "Choose a state from the list.";
      } else {
        shippingState = shipStateName;
      }
    }
  }

  const bounds = opts?.validityDays ?? { min: 1, max: 365 };
  const validityDays = wholeNumber(str(raw.validityDays, 4) || "7", bounds.min, bounds.max);
  if (validityDays === null) {
    errors.validityDays = `Validity must be a whole number of days (${bounds.min}–${bounds.max}).`;
  }

  const deliveryChargePaise = parseRupeesToPaise(str(raw.deliveryCharge, 20) || "0");
  if (deliveryChargePaise === null) {
    errors.deliveryCharge =
      "Enter the delivery charge in rupees (0 = delivery included in the item prices).";
  }

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  if (rawItems.length === 0) {
    errors.items = "Add at least one item.";
  } else if (rawItems.length > MAX_ITEMS) {
    errors.items = `A quotation holds at most ${MAX_ITEMS} items.`;
  }
  const items: ManualQuotationItem[] = [];
  rawItems.slice(0, MAX_ITEMS).forEach((entry, index) => {
    const row =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>)
        : {};
    const key = `items.${index}`;
    const itemName = str(row.name, 200);
    if (itemName === "") errors[`${key}.name`] = "Enter the item name.";

    const quantity = wholeNumber(str(row.quantity, 6) || "1", 1, MAX_QUANTITY);
    if (quantity === null) {
      errors[`${key}.quantity`] = `Quantity must be a whole number (1–${MAX_QUANTITY}).`;
    }

    const unitPricePaise = parseRupeesToPaise(str(row.unitPrice, 20));
    if (unitPricePaise === null || unitPricePaise <= 0) {
      errors[`${key}.unitPrice`] = "Enter the unit price in rupees (excluding GST).";
    }

    const hsnRaw = str(row.hsn, 8);
    const hsn = hsnRaw === "" ? null : hsnRaw;
    if (hsn !== null && !/^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/.test(hsn)) {
      errors[`${key}.hsn`] = "HSN must be 4, 6 or 8 digits (or blank).";
    }

    const rateRaw = str(row.gstRate, 6);
    const rateText = rateRaw === "" ? "0" : rateRaw;
    const rate = Number(rateText);
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(rateText) || !(rate >= 0 && rate <= 28)) {
      errors[`${key}.gstRate`] = "GST rate must be 0–28 (e.g. 18 or 18.00).";
    }

    items.push({
      name: itemName,
      description: str(row.description, 300),
      hsn,
      quantity: quantity ?? 0,
      unitPricePaise: unitPricePaise ?? 0,
      gstRate: withGst ? String(parseGstRate(rate)) : null,
    });
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      partyType: partyType as PartyType,
      name,
      businessName: str(raw.businessName, 200) || null,
      phone: normalizePhone(phoneRaw),
      email: email === "" ? null : email,
      gstin,
      addressLine,
      city,
      state,
      pincode: pincode === "" ? null : pincode,
      sameAsBilling,
      shippingAddressLine,
      shippingCity,
      shippingState,
      shippingPincode,
      withGst,
      validityDays: validityDays ?? 7,
      items,
      deliveryChargePaise: deliveryChargePaise ?? 0,
    },
  };
}

export interface ManualQuotationTotals {
  lineTaxablePaise: number;
  lineTaxPaise: number;
  deliveryPaise: number;
  deliveryTaxPaise: number;
  subtotalPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalTaxPaise: number;
  grandTotalPaise: number;
  /** Per-line tax, index-aligned with the input items. */
  lineTaxesPaise: number[];
}

/**
 * Totals for a manual quotation. Shared by the server builder and the
 * maker's live preview so the number the admin sees while typing is the
 * number frozen into the PDF.
 */
export function computeManualQuotationTotals(input: {
  items: ManualQuotationItem[];
  deliveryChargePaise: number;
  /** Delivery GST rate as a decimal string; null = no GST. */
  deliveryGstRate: string | null;
  sameState: boolean;
}): ManualQuotationTotals {
  const lineTaxesPaise: number[] = [];
  let lineTaxablePaise = 0;
  for (const item of input.items) {
    const lineTaxable = item.unitPricePaise * item.quantity;
    const tax = Math.round((lineTaxable * parseGstRate(item.gstRate)) / 100);
    lineTaxablePaise += lineTaxable;
    lineTaxesPaise.push(tax);
  }
  const lineTaxPaise = lineTaxesPaise.reduce((n, t) => n + t, 0);
  const deliveryPaise = input.deliveryChargePaise;
  const deliveryTaxPaise = Math.round(
    (deliveryPaise * parseGstRate(input.deliveryGstRate)) / 100,
  );
  const totalTaxPaise = lineTaxPaise + deliveryTaxPaise;
  const subtotalPaise = lineTaxablePaise + deliveryPaise;
  const cgstPaise = input.sameState ? Math.floor(totalTaxPaise / 2) : 0;
  const sgstPaise = input.sameState ? totalTaxPaise - cgstPaise : 0;
  const igstPaise = input.sameState ? 0 : totalTaxPaise;
  return {
    lineTaxablePaise,
    lineTaxPaise,
    deliveryPaise,
    deliveryTaxPaise,
    subtotalPaise,
    taxablePaise: lineTaxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    totalTaxPaise,
    grandTotalPaise: subtotalPaise + totalTaxPaise,
    lineTaxesPaise,
  };
}

/** Is the party in the seller's own state (CGST+SGST rather than IGST)? */
export function isSameState(
  state: string | null,
  businessStateCode: string | null,
): boolean {
  const code = stateCodeFromName(state);
  return code !== null && businessStateCode !== null && code === businessStateCode;
}

/** Everything the document needs that is not in the form. */
export interface ManualQuotationContext {
  quotationNumber: string;
  /** YYYY-MM-DD (DB/clock date at creation). */
  quotationDate: string;
  /** YYYY-MM-DD; must be >= quotationDate. */
  validTill: string;
  business: BusinessDetails;
  bank: BankDetails | null;
  signatory: Signatory | null;
  terms: string[];
  about: string;
  /** Delivery GST rate ("18.00"); null for non-GST quotes. */
  deliveryGstRate: string | null;
  deliverySac: string | null;
  deliveryLine: { name: string; description: string };
  businessStateCode: string | null;
}

/**
 * Assemble the canonical, frozen quotation document for a manual quote.
 * buildQuotationData() re-verifies every identity below, so a bug in
 * this assembly (or a corrupt payload) fails loudly instead of printing
 * an arithmetically wrong quote.
 */
export function buildManualQuotation(
  input: ManualQuotationInput,
  ctx: ManualQuotationContext,
): QuotationData {
  const sameState = isSameState(input.state, ctx.businessStateCode);
  const deliveryRate = input.withGst ? ctx.deliveryGstRate : null;
  const totals = computeManualQuotationTotals({
    items: input.items,
    deliveryChargePaise: input.deliveryChargePaise,
    deliveryGstRate: deliveryRate,
    sameState,
  });

  const cartage =
    input.deliveryChargePaise === 0
      ? { name: "Delivery", description: "Included in the quoted item prices" }
      : ctx.deliveryLine;

  const doc: BuildQuotationInput = {
    quotationNumber: ctx.quotationNumber,
    quotationDate: ctx.quotationDate,
    validTill: ctx.validTill,
    // No order behind a manual quotation: the document's own number is
    // the reference printed by the PDF, and the quote is provisional by
    // construction.
    orderNumber: ctx.quotationNumber,
    orderCreatedAt: `${ctx.quotationDate}T12:00:00.000Z`,
    orderStatus: "draft",
    paymentMethod: "upi",
    business: ctx.business,
    bank: ctx.bank,
    signatory: ctx.signatory,
    terms: ctx.terms,
    about: ctx.about,
    placeOfSupply: input.state,
    customer: {
      name: input.name,
      phone: input.phone,
      email: input.email,
      gstin: input.gstin,
    },
    billing: {
      name: input.businessName ?? input.name,
      addressLine: input.addressLine,
      city: input.city,
      state: input.state,
      stateCode: stateCodeFromName(input.state),
      pincode: input.pincode,
    },
    shipping: {
      name: input.businessName ?? input.name,
      phone: input.phone,
      pincode: (input.sameAsBilling ? input.pincode : input.shippingPincode) ?? "",
      partnerName: "",
      addressLine: input.sameAsBilling
        ? input.addressLine
        : input.shippingAddressLine ?? input.addressLine,
      city: input.sameAsBilling ? input.city : input.shippingCity ?? input.city,
      state: input.sameAsBilling ? input.state : input.shippingState ?? input.state,
    },
    items: input.items.map((item, index) => ({
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise,
      lineTotalPaise: item.unitPricePaise * item.quantity,
      gstRate: item.gstRate,
      lineTaxPaise: totals.lineTaxesPaise[index] ?? 0,
      hsn: item.hsn,
    })),
    cartage: {
      name: cartage.name,
      description: cartage.description,
      chargePaise: totals.deliveryPaise,
      sac: ctx.deliverySac,
      gstRate: deliveryRate,
      taxPaise: totals.deliveryTaxPaise,
    },
    totals: {
      treatment: input.withGst ? "gst" : "non_gst",
      subtotalPaise: totals.subtotalPaise,
      deliveryPaise: totals.deliveryPaise,
      deliveryTaxPaise: totals.deliveryTaxPaise,
      taxablePaise: totals.taxablePaise,
      cgstPaise: totals.cgstPaise,
      sgstPaise: totals.sgstPaise,
      igstPaise: totals.igstPaise,
      discountPaise: 0,
      couponCode: null,
      grandTotalPaise: totals.grandTotalPaise,
    },
    source: "manual",
  };

  return buildQuotationData(doc);
}

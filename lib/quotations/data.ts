import { parseGstRate } from "@/lib/tax/india";
import type { BusinessDetails } from "@/lib/invoices/business";
import type { BankDetails, Signatory } from "@/lib/quotations/config";

/**
 * Quotation document model (pure, unit-tested).
 *
 * buildQuotationData() assembles the canonical frozen QuotationData
 * EXCLUSIVELY from values the caller already read from immutable
 * snapshots (order / order-item / tax columns) plus server
 * configuration (business block, cartage/tax config, terms, bank,
 * signatory). It takes NO product/customer master rows — so there is
 * structurally nowhere for a post-request catalogue or profile edit
 * to leak in.
 *
 * A quotation is PROVISIONAL: it is issued for unpaid orders and must
 * never be mistaken for a tax invoice. The document carries its own
 * QTN-TS number (never an invoice number), a validity window, and no
 * "TAX INVOICE" labelling anywhere. Paid-order gating lives in
 * canIssueQuotation(), enforced by the service layer AND re-checked
 * here so the builder refuses incoherent input even if called
 * directly.
 *
 * Every monetary identity is re-verified before the document is
 * returned; corrupt snapshots fail loudly (500) instead of rendering
 * a wrong quotation. All money stays integer paise throughout.
 */

export type QuotationTaxTreatment = "gst" | "non_gst";

/** Quotation-eligible order statuses (provisional stages only). */
const QUOTABLE_STATUSES = new Set([
  "draft",
  "pending_payment",
  "payment_submitted",
]);

/**
 * A quotation is issued while the order is still provisional. Paid,
 * fulfilled, cancelled or refunded orders get the tax invoice (or
 * nothing) — never a fresh quotation.
 */
export function canIssueQuotation(orderStatus: string): boolean {
  return QUOTABLE_STATUSES.has(orderStatus);
}

export interface QuotationItemSnapshot {
  name: string;
  /** Frozen product description (grey sub-line, may be empty). */
  description: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  /** GST percent snapshot (decimal string); null = 0%. */
  gstRate: string | number | null;
  lineTaxPaise: number;
  /** HSN code snapshot (4/6/8 digits); null renders the cell blank. */
  hsn: string | null;
}

export interface QuotationCartageSnapshot {
  name: string;
  description: string;
  chargePaise: number;
  /** SAC snapshot (6 digits); null renders the cell blank. */
  sac: string | null;
  gstRate: string | null;
  taxPaise: number;
}

export interface QuotationBillingSnapshot {
  name: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
}

export interface BuildQuotationInput {
  quotationNumber: string;
  /** YYYY-MM-DD (quotation_date). */
  quotationDate: string;
  /** YYYY-MM-DD (valid_till, >= quotationDate). */
  validTill: string;
  orderNumber: string;
  /** ISO timestamp of order placement. */
  orderCreatedAt: string;
  orderStatus: string;
  paymentMethod: string;
  business: BusinessDetails;
  bank: BankDetails | null;
  signatory: Signatory | null;
  terms: string[];
  /** Place of supply (billing state name); null renders blank. */
  placeOfSupply: string | null;
  customer: {
    /** Order-time snapshots (NOT the live customer master). */
    name: string;
    phone: string;
    email: string | null;
    gstin: string | null;
  };
  billing: QuotationBillingSnapshot;
  shipping: {
    name: string;
    phone: string;
    pincode: string;
    partnerName: string;
    /**
     * Free-text delivery address (orders.shipping_address). Optional:
     * documents frozen before it existed render without it.
     */
    addressLine?: string | null;
  };
  /** "About Trolift Solutions" copy (frozen like terms; optional). */
  about?: string;
  items: QuotationItemSnapshot[];
  cartage: QuotationCartageSnapshot;
  totals: {
    treatment: QuotationTaxTreatment;
    subtotalPaise: number;
    deliveryPaise: number;
    deliveryTaxPaise: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    /** Rupees knocked off by a redeem code (0 when the order used none). */
    discountPaise: number;
    /** Redeem code the discount came from (label for the printed line). */
    couponCode?: string | null;
    grandTotalPaise: number;
  };
}

export interface QuotationItem {
  serial: number;
  name: string;
  description: string;
  hsn: string | null;
  quantity: number;
  unitPricePaise: number;
  /** Ex-GST line value. */
  taxablePaise: number;
  gstRate: string | number | null;
  taxPaise: number;
  /** Taxable + tax. */
  lineTotalPaise: number;
}

export interface QuotationData {
  version: 1;
  kind: "quotation";
  quotationNumber: string;
  quotationDate: string;
  validTill: string;
  orderNumber: string;
  orderCreatedAt: string;
  orderStatus: string;
  paymentMethod: string;
  business: BusinessDetails;
  bank: BankDetails | null;
  signatory: Signatory | null;
  terms: string[];
  /** "About Trolift Solutions" copy (undefined on legacy frozen docs). */
  about?: string;
  placeOfSupply: string | null;
  customer: {
    name: string;
    phone: string;
    email: string | null;
    gstin: string | null;
  };
  billing: QuotationBillingSnapshot;
  shipping: BuildQuotationInput["shipping"];
  treatment: QuotationTaxTreatment;
  items: QuotationItem[];
  cartage: {
    name: string;
    description: string;
    sac: string | null;
    chargePaise: number;
    gstRate: string | null;
    taxPaise: number;
    lineTotalPaise: number;
  };
  totals: {
    subtotalPaise: number;
    deliveryPaise: number;
    deliveryTaxPaise: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalTaxPaise: number;
    /** Absent on documents frozen before the redeem-code feature. */
    discountPaise?: number;
    couponCode?: string | null;
    grandTotalPaise: number;
  };
}

function fail(message: string): never {
  throw new Error(`[quotations] Refusing to render: ${message}`);
}

function assertPaise(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer paise amount.`);
  }
}

/** Mirror of public.generate_quotation_number() (QTN-TS + 10 digits). */
export function formatQuotationNumber(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    fail("quotation sequence must be a positive integer.");
  }
  return `QTN-TS${String(sequence).padStart(10, "0")}`;
}

export function buildQuotationData(input: BuildQuotationInput): QuotationData {
  if (!canIssueQuotation(input.orderStatus)) {
    fail("a quotation is issued only while the order is provisional.");
  }
  if (!/^QTN-TS[0-9]{10}$/.test(input.quotationNumber)) {
    fail("quotation number has an unexpected shape.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.quotationDate)) {
    fail("quotation date must be YYYY-MM-DD.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validTill)) {
    fail("validity date must be YYYY-MM-DD.");
  }
  if (input.validTill < input.quotationDate) {
    fail("validity must not end before the quotation date.");
  }
  if (input.items.length === 0) fail("a quotation needs at least one item.");
  if (input.terms.length === 0) fail("a quotation needs terms.");

  // Treatment/GSTIN coherence (same rule as invoices/data.ts): GST
  // applies to every order (B2C and B2B alike), so a missing GSTIN on
  // a GST quotation is normal — it just has no input credit. A non-GST
  // document must not carry one (legacy rows only) — a mismatch means
  // corrupt snapshots.
  if (input.totals.treatment === "non_gst" && (input.customer.gstin ?? "") !== "") {
    fail("a non-GST quotation must not carry a customer GSTIN.");
  }

  const items: QuotationItem[] = input.items.map((item, i) => {
    const label = `item ${i + 1}`;
    if (item.name.trim() === "") fail(`${label} needs a product name.`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      fail(`${label} needs a positive whole quantity.`);
    }
    assertPaise(item.unitPricePaise, `${label} unit price`);
    assertPaise(item.lineTotalPaise, `${label} line total`);
    assertPaise(item.lineTaxPaise, `${label} line tax`);
    if (item.lineTotalPaise !== item.unitPricePaise * item.quantity) {
      fail(`${label} line total does not equal unit price × quantity.`);
    }
    // Two accepted storage shapes (see invoices/data.ts): legacy add-on
    // `round(total × r/100)` or all-inclusive embedded
    // `total − round(total × 100/(100 + r))` — both derive fully from
    // the snapshotted rate.
    const lineRate = parseGstRate(item.gstRate);
    const addOnTax = Math.round((item.lineTotalPaise * lineRate) / 100);
    const inclusiveTax =
      item.lineTotalPaise -
      Math.round((item.lineTotalPaise * 100) / (100 + lineRate));
    if (item.lineTaxPaise !== addOnTax && item.lineTaxPaise !== inclusiveTax) {
      fail(`${label} tax does not match its snapshotted rate.`);
    }
    if (item.hsn !== null && !/^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/.test(item.hsn)) {
      fail(`${label} HSN has an unexpected shape.`);
    }
    return {
      serial: i + 1,
      name: item.name,
      description: item.description,
      hsn: item.hsn,
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise,
      taxablePaise: item.lineTotalPaise,
      gstRate: item.gstRate,
      taxPaise: item.lineTaxPaise,
      lineTotalPaise: item.lineTotalPaise + item.lineTaxPaise,
    };
  });

  // Cartage (delivery) line: quoted freight with its own GST. Two
  // accepted shapes, both fully determined by the snapshotted rate
  // (same rule as item lines): an add-on charge whose tax is
  // round(charge × r/100) — the store's model, where the base charge
  // sits in delivery_charge and its GST rides in the order tax split —
  // or a legacy reverse-inclusive charge (freight extracted from a
  // flat inclusive fee). The all-inclusive (zero-charge) row carries
  // neither.
  const c = input.cartage;
  if (c.name.trim() === "") fail("the cartage line needs a name.");
  assertPaise(c.chargePaise, "cartage charge");
  assertPaise(c.taxPaise, "cartage tax");
  if (c.sac !== null && !/^[0-9]{6}$/.test(c.sac)) {
    fail("cartage SAC has an unexpected shape.");
  }
  const cartageRateNum = parseGstRate(c.gstRate);
  const addOnCartageTax = Math.round((c.chargePaise * cartageRateNum) / 100);
  const inclusiveFreight = Math.round(
    ((c.chargePaise + c.taxPaise) * 100) / (100 + cartageRateNum),
  );
  if (c.taxPaise !== addOnCartageTax && c.chargePaise !== inclusiveFreight) {
    fail("cartage tax does not match its snapshotted rate.");
  }

  const t = input.totals;
  for (const [label, value] of Object.entries({
    subtotal: t.subtotalPaise,
    delivery: t.deliveryPaise,
    deliveryTax: t.deliveryTaxPaise,
    taxable: t.taxablePaise,
    cgst: t.cgstPaise,
    sgst: t.sgstPaise,
    igst: t.igstPaise,
    discount: t.discountPaise,
    grandTotal: t.grandTotalPaise,
  })) {
    assertPaise(value, `totals.${label}`);
  }

  const lineTaxable = items.reduce((n, i) => n + i.taxablePaise, 0);
  const lineTax = items.reduce((n, i) => n + i.taxPaise, 0);
  // Subtotal covers goods AND quoted freight (provisional delivered price).
  if (t.subtotalPaise !== lineTaxable + c.chargePaise) {
    fail("subtotal does not equal goods plus cartage.");
  }
  if (t.deliveryPaise !== c.chargePaise) {
    fail("delivery total does not equal the cartage charge.");
  }
  if (t.deliveryTaxPaise !== c.taxPaise) {
    fail("delivery tax total does not equal the cartage tax.");
  }
  if (t.taxablePaise !== lineTaxable) {
    fail("taxable amount does not equal the sum of goods values.");
  }
  if (t.treatment === "non_gst") {
    if (
      t.cgstPaise !== 0 || t.sgstPaise !== 0 || t.igstPaise !== 0 ||
      t.deliveryTaxPaise !== 0 || lineTax !== 0 || c.taxPaise !== 0
    ) {
      fail("non-GST quotation carries tax amounts.");
    }
  } else {
    if (lineTax + c.taxPaise !== t.cgstPaise + t.sgstPaise + t.igstPaise) {
      fail("order tax split does not equal goods plus cartage taxes.");
    }
    // CGST+SGST and IGST are mutually exclusive by construction.
    const intra = t.cgstPaise + t.sgstPaise;
    if (intra !== 0 && t.igstPaise !== 0) {
      fail("quotation mixes intra-state and inter-state tax.");
    }
  }
  // Quoted freight lives INSIDE the subtotal (provisional delivered
  // price), unlike tax invoices where delivery is a separate add-on.
  // The redeem discount is netted exactly like the orders_total_check
  // constraint: the customer pays subtotal + tax − discount, so the
  // quotation total must agree with the amount on the pay page.
  if (
    t.grandTotalPaise !==
    t.subtotalPaise + t.cgstPaise + t.sgstPaise + t.igstPaise - t.discountPaise
  ) {
    fail("grand total does not equal subtotal + tax - discount.");
  }

  if (input.customer.name.trim() === "" || input.customer.phone.trim() === "") {
    fail("customer name and phone snapshots are required.");
  }

  const totalTaxPaise = t.cgstPaise + t.sgstPaise + t.igstPaise;
  return {
    version: 1,
    kind: "quotation",
    quotationNumber: input.quotationNumber,
    quotationDate: input.quotationDate,
    validTill: input.validTill,
    orderNumber: input.orderNumber,
    orderCreatedAt: input.orderCreatedAt,
    orderStatus: input.orderStatus,
    paymentMethod: input.paymentMethod,
    business: input.business,
    bank: input.bank,
    signatory: input.signatory,
    terms: [...input.terms],
    ...(input.about === undefined ? {} : { about: input.about }),
    placeOfSupply: input.placeOfSupply,
    customer: { ...input.customer },
    billing: { ...input.billing },
    shipping: { ...input.shipping },
    treatment: t.treatment,
    items,
    cartage: {
      name: c.name,
      description: c.description,
      sac: c.sac,
      chargePaise: c.chargePaise,
      gstRate: c.gstRate,
      taxPaise: c.taxPaise,
      lineTotalPaise: c.chargePaise + c.taxPaise,
    },
    totals: {
      subtotalPaise: t.subtotalPaise,
      deliveryPaise: t.deliveryPaise,
      deliveryTaxPaise: t.deliveryTaxPaise,
      taxablePaise: t.taxablePaise,
      cgstPaise: t.cgstPaise,
      sgstPaise: t.sgstPaise,
      igstPaise: t.igstPaise,
      totalTaxPaise,
      discountPaise: t.discountPaise,
      couponCode: t.couponCode ?? null,
      grandTotalPaise: t.grandTotalPaise,
    },
  };
}

import { parseGstRate } from "@/lib/tax/india";
import type { BusinessDetails } from "@/lib/invoices/business";

/**
 * Invoice document model (pure, unit-tested).
 *
 * buildInvoiceData() assembles the canonical frozen InvoiceData EXCLUSIVELY
 * from values the caller already read from immutable snapshots (order /
 * order-item / tax columns) plus server configuration (business block).
 * It takes NO product/customer master rows — so there is structurally
 * nowhere for a post-order catalogue or profile edit to leak in.
 *
 * Every monetary identity is re-verified before the document is returned;
 * corrupt snapshots fail loudly (500) instead of rendering a wrong
 * invoice. All money stays integer paise throughout.
 */

export type InvoiceTaxTreatment = "gst" | "non_gst";

export interface InvoiceItemSnapshot {
  name: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  /** GST percent decimal string (snapshot); null = 0%. A JSON number from PostgREST is accepted too. */
  gstRate: string | number | null;
  lineTaxPaise: number;
}

export interface InvoiceBillingSnapshot {
  name: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
}

export interface BuildInvoiceInput {
  invoiceNumber: string;
  /** YYYY-MM-DD (invoice_date). */
  invoiceDate: string;
  orderNumber: string;
  /** ISO timestamp of order placement. */
  orderCreatedAt: string;
  paymentStatus: string;
  paymentMethod: string;
  business: BusinessDetails;
  customer: {
    /** Order-time snapshots (NOT the live customer master). */
    name: string;
    phone: string;
    email: string | null;
    gstin: string | null;
  };
  billing: InvoiceBillingSnapshot;
  shipping: {
    name: string;
    phone: string;
    pincode: string;
    partnerName: string;
  };
  items: InvoiceItemSnapshot[];
  totals: {
    treatment: InvoiceTaxTreatment;
    subtotalPaise: number;
    deliveryPaise: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    grandTotalPaise: number;
  };
}

export interface InvoiceItem {
  name: string;
  quantity: number;
  unitPricePaise: number;
  /** Ex-GST line value. */
  taxablePaise: number;
  gstRate: string | number | null;
  taxPaise: number;
  /** Taxable + tax. */
  lineTotalPaise: number;
}

export interface InvoiceData {
  version: 1;
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  orderCreatedAt: string;
  paymentStatus: string;
  paymentMethod: string;
  business: BusinessDetails;
  customer: {
    name: string;
    phone: string;
    email: string | null;
    gstin: string | null;
  };
  billing: InvoiceBillingSnapshot;
  shipping: BuildInvoiceInput["shipping"];
  treatment: InvoiceTaxTreatment;
  items: InvoiceItem[];
  totals: {
    subtotalPaise: number;
    deliveryPaise: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalTaxPaise: number;
    grandTotalPaise: number;
  };
}

function fail(message: string): never {
  throw new Error(`[invoices] Refusing to render: ${message}`);
}

function assertPaise(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer paise amount.`);
  }
}

/**
 * A final tax invoice is issued ONLY for paid orders. Anything else —
 * pending, submitted, failed, cancelled, refunded — gets no invoice,
 * because an unpaid (or un-paid-now) document must never be labelled
 * as a paid tax invoice.
 */
export function canIssueInvoice(paymentStatus: string): boolean {
  return paymentStatus === "paid";
}

/** Indian financial year for a date (April–March), e.g. FY26-27. */
export function getFinancialYear(date: Date): string {
  const year = date.getFullYear();
  const start = date.getMonth() >= 3 ? year : year - 1;
  const yy = (y: number) => String(y).slice(-2);
  return `FY${yy(start)}-${yy(start + 1)}`;
}

/** Mirror of public.generate_invoice_number() (prefix/FY/zero-padded seq). */
export function formatInvoiceNumber(
  prefix: string,
  financialYear: string,
  sequence: number,
): string {
  if (!/^[A-Z]{2,10}$/.test(prefix)) fail("invoice prefix is invalid.");
  if (!/^FY[0-9]{2}-[0-9]{2}$/.test(financialYear)) {
    fail("financial year is invalid.");
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    fail("invoice sequence must be a positive integer.");
  }
  return `${prefix}/${financialYear}/${String(sequence).padStart(6, "0")}`;
}

export function buildInvoiceData(input: BuildInvoiceInput): InvoiceData {
  // Defense in depth: the service layer gates on canIssueInvoice(), but
  // the frozen-document builder must never produce a "tax invoice" for
  // an unpaid order even if called directly.
  if (input.paymentStatus !== "paid") {
    fail("a tax invoice is issued only for paid orders.");
  }
  // Treatment/GSTIN coherence: GST documents require a customer GSTIN
  // (the order engine sets treatment from GSTIN presence), and non-GST
  // documents must not carry one — a mismatch means corrupt snapshots.
  if (input.totals.treatment === "gst" && (input.customer.gstin ?? "") === "") {
    fail("a GST invoice needs the customer GSTIN snapshot.");
  }
  if (input.totals.treatment === "non_gst" && (input.customer.gstin ?? "") !== "") {
    fail("a non-GST invoice must not carry a customer GSTIN.");
  }
  if (!/^[A-Z]{2,10}\/FY[0-9]{2}-[0-9]{2}\/[0-9]{4,}$/.test(input.invoiceNumber)) {
    fail("invoice number has an unexpected shape.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate)) {
    fail("invoice date must be YYYY-MM-DD.");
  }
  if (input.items.length === 0) fail("an invoice needs at least one item.");

  const items: InvoiceItem[] = input.items.map((item, i) => {
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
    const expectedTax = Math.round(
      (item.lineTotalPaise * parseGstRate(item.gstRate)) / 100,
    );
    if (item.lineTaxPaise !== expectedTax) {
      fail(`${label} tax does not match its snapshotted rate.`);
    }
    return {
      name: item.name,
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise,
      taxablePaise: item.lineTotalPaise,
      gstRate: item.gstRate,
      taxPaise: item.lineTaxPaise,
      lineTotalPaise: item.lineTotalPaise + item.lineTaxPaise,
    };
  });

  const t = input.totals;
  for (const [label, value] of Object.entries({
    subtotal: t.subtotalPaise,
    delivery: t.deliveryPaise,
    taxable: t.taxablePaise,
    cgst: t.cgstPaise,
    sgst: t.sgstPaise,
    igst: t.igstPaise,
    grandTotal: t.grandTotalPaise,
  })) {
    assertPaise(value, `totals.${label}`);
  }

  const lineTaxable = items.reduce((n, i) => n + i.taxablePaise, 0);
  const lineTax = items.reduce((n, i) => n + i.taxPaise, 0);
  if (t.subtotalPaise !== lineTaxable) {
    fail("subtotal does not equal the sum of line values.");
  }
  if (t.taxablePaise !== lineTaxable) {
    fail("taxable amount does not equal the sum of line values.");
  }
  if (t.treatment === "non_gst") {
    if (t.cgstPaise !== 0 || t.sgstPaise !== 0 || t.igstPaise !== 0 || lineTax !== 0) {
      fail("non-GST invoice carries tax amounts.");
    }
  } else {
    if (lineTax !== t.cgstPaise + t.sgstPaise + t.igstPaise) {
      fail("order tax split does not equal the sum of line taxes.");
    }
    // CGST+SGST and IGST are mutually exclusive by construction.
    const intra = t.cgstPaise + t.sgstPaise;
    if (intra !== 0 && t.igstPaise !== 0) {
      fail("invoice mixes intra-state and inter-state tax.");
    }
  }
  if (t.grandTotalPaise !== t.subtotalPaise + t.cgstPaise + t.sgstPaise + t.igstPaise + t.deliveryPaise) {
    fail("grand total does not equal subtotal + tax + delivery.");
  }

  if (input.customer.name.trim() === "" || input.customer.phone.trim() === "") {
    fail("customer name and phone snapshots are required.");
  }

  const totalTaxPaise = t.cgstPaise + t.sgstPaise + t.igstPaise;
  return {
    version: 1,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    orderNumber: input.orderNumber,
    orderCreatedAt: input.orderCreatedAt,
    paymentStatus: input.paymentStatus,
    paymentMethod: input.paymentMethod,
    business: input.business,
    customer: { ...input.customer },
    billing: { ...input.billing },
    shipping: { ...input.shipping },
    treatment: t.treatment,
    items,
    totals: {
      subtotalPaise: t.subtotalPaise,
      deliveryPaise: t.deliveryPaise,
      taxablePaise: t.taxablePaise,
      cgstPaise: t.cgstPaise,
      sgstPaise: t.sgstPaise,
      igstPaise: t.igstPaise,
      totalTaxPaise,
      grandTotalPaise: t.grandTotalPaise,
    },
  };
}

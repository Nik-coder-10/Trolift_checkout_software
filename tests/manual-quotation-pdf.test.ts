import { describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));
// Inner entry: the package root self-tests when module.parent is unset
// (vitest interop), so bypass it — same parser function, no side effects.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { renderQuotationPdf } from "@/lib/quotations/pdf";
import {
  buildManualQuotation,
  parseManualQuotationInput,
  type ManualQuotationContext,
} from "@/lib/quotations/manual";

/**
 * The quotation maker must print the SAME document as an order
 * quotation, minus the order-specific footer. These tests render the
 * real PDF (pdfkit + logo/signature assets) and read its text back.
 */

const BUSINESS = {
  name: "Trolift Solutions",
  address: "14 Industrial Estate, Jaipur 302001",
  phone: "+919810000000",
  email: "sales@trolift.in",
  gstin: "08ABCDE1234F1Z0",
};

const CTX: ManualQuotationContext = {
  quotationNumber: "QTN-TS0000121264",
  quotationDate: "2026-10-26",
  validTill: "2026-11-02",
  business: { ...BUSINESS },
  bank: {
    bankName: "HDFC BANK LTD",
    accountName: "TROLIFT SOLUTIONS",
    accountNumber: "50200110000011",
    ifsc: "HDFC0000001",
    accountType: "CURRENT",
  },
  signatory: { name: "Test Signatory", title: "Proprietor" },
  terms: ["100% Advance along with the Order Confirmation"],
  about: "Trolift Solutions builds material-handling equipment.",
  deliveryGstRate: "18.00",
  deliverySac: "996812",
  deliveryLine: {
    name: "Cartage - delivery charge",
    description: "Delivery Fees through Our Designated Delivery Partners",
  },
  businessStateCode: "08",
};

function form(over: Record<string, unknown> = {}) {
  return {
    partyType: "dealer",
    name: "Sharma Traders",
    businessName: "Sharma Traders",
    phone: "9876543210",
    email: "dealer@example.com",
    gstin: "08ABCDE1234F1Z0",
    addressLine: "12 Transport Nagar",
    city: "Jaipur",
    state: "Rajasthan",
    pincode: "302001",
    items: [
      {
        name: "Hydraulic Hand Pallet Truck 2500 kg",
        description: "Capacity 2500 kg",
        hsn: "87168010",
        quantity: "2",
        unitPrice: "24999.00",
        gstRate: "18",
      },
    ],
    deliveryCharge: "800",
    withGst: true,
    validityDays: "7",
    ...over,
  };
}

async function render(over: Record<string, unknown> = {}, ctx = CTX) {
  const parsed = parseManualQuotationInput(form(over));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const pdf = await renderQuotationPdf(buildManualQuotation(parsed.value, ctx));
  return { pdf, text: (await pdfParse(pdf)).text };
}

describe("manual quotation PDF", () => {
  it("is a real QUOTATION document with the maker's figures", async () => {
    const { pdf, text } = await render();
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(2000);
    for (const needle of [
      "QUOTATION",
      "QTN-TS0000121264",
      "26 Oct 2026",
      "02 Nov 2026",
      "Sharma Traders",
      "Rajasthan",
      "Bill To",
      "Ship To",
      "12 Transport Nagar",
      "GSTIN: 08ABCDE1234F1Z0",
      "Hydraulic Hand Pallet Truck 2500 kg",
      "87168010",
      "Cartage - delivery charge",
      "996812",
      "Prepared by Trolift Solutions for this offer",
      "Rs. 59,941.64",
    ]) {
      expect(text).toContain(needle);
    }
    // Never a tax invoice, and never the order-snapshot footer.
    expect(text).not.toContain("TAX INVOICE");
    expect(text).not.toContain("frozen order");
  });

  it("splits intra-state GST and prints both components", async () => {
    const { text } = await render();
    expect(text).toContain("CGST");
    expect(text).toContain("SGST");
  });

  it("charges IGST for an out-of-state dealer", async () => {
    const { text } = await render({ state: "Maharashtra", pincode: "400001" });
    expect(text).toContain("Maharashtra");
    expect(text).toContain("IGST");
  });

  it("prints an included-delivery line when the charge is zero", async () => {
    const { text } = await render({ deliveryCharge: "0" });
    expect(text).toContain("Included in the quoted item prices");
  });

  it("omits every tax figure on a non-GST quotation", async () => {
    const { text } = await render({ withGst: false, gstin: "" });
    expect(text).toContain("no GST charged on this quotation");
    expect(text).not.toContain("CGST");
    expect(text).not.toContain("IGST");
  });
});

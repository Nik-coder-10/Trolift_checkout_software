import { describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));
// Inner entry: the package root self-tests when module.parent is unset
// (vitest interop), so bypass it — same parser function, no side effects.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import {
  buildQuotationData,
  type BuildQuotationInput,
} from "@/lib/quotations/data";
import { formatQuoteDate, renderQuotationPdf } from "@/lib/quotations/pdf";

const BUSINESS = {
  name: "Trolift Solutions",
  address: "14 Industrial Estate, Mumbai 400001",
  phone: "+919810000000",
  email: "sales@trolift.in",
  gstin: "27ABCDE1234F1Z0",
};

function base(over: Partial<BuildQuotationInput> = {}): BuildQuotationInput {
  return {
    quotationNumber: "QTN-TS0000121264",
    quotationDate: "2026-10-09",
    validTill: "2026-10-16",
    orderNumber: "TS-261009-0001",
    orderCreatedAt: "2026-10-09T10:00:00Z",
    orderStatus: "pending_payment",
    paymentMethod: "upi",
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
    placeOfSupply: "Delhi",
    customer: {
      name: "Acme Pvt Ltd",
      phone: "+919810001111",
      email: null,
      gstin: "07ABCDE1234F1Z2",
    },
    billing: {
      name: "Acme Pvt Ltd",
      addressLine: "14 Industrial Estate",
      city: "South West Delhi",
      state: "Delhi",
      stateCode: "07",
      pincode: "110075",
    },
    shipping: {
      name: "Acme Pvt Ltd",
      phone: "+919810001111",
      pincode: "110075",
      partnerName: "Partner A",
      addressLine: "Plot 22, MIDC Andheri East",
    },
    items: [
      {
        name: "Metal Trolley 600 Kg",
        description: "Metal Trolley 600 Kg",
        quantity: 1,
        unitPricePaise: 505000,
        lineTotalPaise: 505000,
        gstRate: "5.00",
        lineTaxPaise: 25250,
        hsn: "87168010",
      },
    ],
    cartage: {
      name: "Cartage - delivery charge",
      description: "Delivery Fees",
      chargePaise: 47000,
      sac: null,
      gstRate: "18.00",
      taxPaise: 8460,
    },
    totals: {
      treatment: "gst",
      subtotalPaise: 552000,
      deliveryPaise: 47000,
      deliveryTaxPaise: 8460,
      taxablePaise: 505000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 33710,
      grandTotalPaise: 585710,
    },
    ...over,
  };
}

describe("quotation PDF (reference layout)", () => {
  it("formats quote dates like the reference", () => {
    expect(formatQuoteDate("2026-10-09")).toBe("09 Oct 2026");
    expect(formatQuoteDate("2026-10-16")).toBe("16 Oct 2026");
  });

  it("renders a quotation carrying every reference block, never a tax invoice", async () => {
    const pdf = await renderQuotationPdf(buildQuotationData(base()));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(2000);
    const text = (await pdfParse(pdf)).text;
    for (const needle of [
      "QUOTATION",
      "QTN-TS0000121264",
      "09 Oct 2026",
      "16 Oct 2026",
      "Acme Pvt Ltd",
      "Bill To",
      "Ship To",
      "Plot 22, MIDC Andheri East",
      "About Trolift Solutions",
      "Trolift Solutions is a Jaipur-based manufacturer",
      "Metal Trolley 600 Kg",
      "87168010",
      "Cartage - delivery charge",
      "IGST",
      "Rs. 5,857.10",
      "provisional quotation, not a tax invoice",
      "50200110000011",
      "Test Signatory",
      "Authorized Signatory",
    ]) {
      expect(text, needle).toContain(needle);
    }
    expect(text).not.toContain("TAX INVOICE");
    expect(text).not.toContain("INV/");
  });

  it("shows billing only when the customer provided a GSTIN", async () => {
    const noGst = base({
      customer: {
        name: "Retail Buyer",
        phone: "+919810002222",
        email: null,
        gstin: null,
      },
      shipping: {
        name: "Retail Buyer",
        phone: "+919810002222",
        pincode: "110075",
        partnerName: "Partner A",
        addressLine: "Plot 22, MIDC Andheri East",
      },
      items: [
        {
          name: "Metal Trolley 600 Kg",
          description: "Metal Trolley 600 Kg",
          quantity: 1,
          unitPricePaise: 505000,
          lineTotalPaise: 505000,
          gstRate: null,
          lineTaxPaise: 0,
          hsn: "87168010",
        },
      ],
      cartage: {
        name: "Cartage - delivery charge",
        description: "Delivery Fees",
        chargePaise: 47000,
        sac: null,
        gstRate: null,
        taxPaise: 0,
      },
      totals: {
        treatment: "non_gst",
        subtotalPaise: 552000,
        deliveryPaise: 47000,
        deliveryTaxPaise: 0,
        taxablePaise: 505000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        grandTotalPaise: 552000,
      },
    });
    const text = (await pdfParse(await renderQuotationPdf(buildQuotationData(noGst)))).text;
    // Shipping address alone carries a non-GST quotation.
    expect(text).toContain("Ship To");
    expect(text).toContain("Plot 22, MIDC Andheri East");
    expect(text).not.toContain("Bill To");
    expect(text).not.toContain("GSTIN: —");
    expect(text).toContain("About Trolift Solutions");
  });

  it("embeds the header logo and the signature strip", async () => {
    const pdf = await renderQuotationPdf(buildQuotationData(base()));
    const raw = pdf.toString("latin1");
    expect(raw.match(/\/Subtype\s*\/Image/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic for identical frozen input", async () => {
    const a = await renderQuotationPdf(buildQuotationData(base()));
    const b = await renderQuotationPdf(buildQuotationData(base()));
    expect(a.equals(b)).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));
// Inner entry: the package root self-tests when module.parent is unset
// (vitest interop), so bypass it — same parser function, no side effects.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { buildInvoiceData, type BuildInvoiceInput } from "@/lib/invoices/data";
import { formatINR, renderInvoicePdf } from "@/lib/invoices/pdf";

const BUSINESS = {
  name: "Trolift Solutions",
  address: "14 Industrial Estate, Mumbai 400001",
  phone: "+919810000000",
  email: "sales@trolift.in",
  gstin: "27ABCDE1234F1Z5",
};

function base(over: Partial<BuildInvoiceInput> = {}): BuildInvoiceInput {
  return {
    invoiceNumber: "INV/FY26-27/000042",
    invoiceDate: "2026-10-05",
    orderNumber: "TS-261005-0001",
    orderCreatedAt: "2026-10-05T10:00:00Z",
    paymentStatus: "paid",
    paymentMethod: "upi",
    business: { ...BUSINESS },
    customer: {
      name: "Acme Pvt Ltd",
      phone: "+919810001111",
      email: "acme@example.in",
      gstin: "27ABCDE1234F1Z5",
    },
    billing: {
      name: "Acme Pvt Ltd",
      addressLine: "14 Industrial Estate",
      city: "Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      pincode: "400001",
    },
    shipping: {
      name: "Acme Pvt Ltd",
      phone: "+919810001111",
      pincode: "400001",
      partnerName: "Partner A",
    },
    items: [
      {
        name: "Heavy-Duty Platform Trolley 500 kg",
        quantity: 2,
        unitPricePaise: 629900,
        lineTotalPaise: 1259800,
        gstRate: "18.00",
        lineTaxPaise: 226764,
      },
    ],
    totals: {
      treatment: "gst",
      subtotalPaise: 1259800,
      deliveryPaise: 45000,
      taxablePaise: 1259800,
      cgstPaise: 113382,
      sgstPaise: 113382,
      igstPaise: 0,
      grandTotalPaise: 1531564,
    },
    ...over,
  };
}

describe("invoice PDF (structured data → A4 document)", () => {
  it("formats paise exactly with en-IN grouping", () => {
    expect(formatINR(1531564)).toBe("Rs. 15,315.64");
    expect(formatINR(100)).toBe("Rs. 1.00");
    expect(formatINR(0)).toBe("Rs. 0.00");
  });

  it("renders a GST invoice whose text carries every reference", async () => {
    const pdf = await renderInvoicePdf(buildInvoiceData(base()));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(2000);
    const text = (await pdfParse(pdf)).text;
    for (const needle of [
      "TAX INVOICE",
      "INV/FY26-27/000042",
      "TS-261005-0001",
      "Acme Pvt Ltd",
      "Heavy-Duty Platform Trolley",
      "CGST",
      "SGST",
      "Rs. 15,315.64",
      "TROLIFT SOLUTIONS",
    ]) {
      expect(text, needle).toContain(needle);
    }
    expect(text).not.toContain("IGST");
  });

  it("renders a non-GST invoice without tax rows", async () => {
    const pdf = await renderInvoicePdf(
      buildInvoiceData(
        base({
          customer: { name: "Jane", phone: "+919820002222", email: null, gstin: null },
          billing: { name: null, addressLine: null, city: null, state: null, stateCode: null, pincode: null },
          items: [
            { name: "Trolley", quantity: 1, unitPricePaise: 10000, lineTotalPaise: 10000, gstRate: null, lineTaxPaise: 0 },
          ],
          totals: {
            treatment: "non_gst",
            subtotalPaise: 10000,
            deliveryPaise: 5000,
            taxablePaise: 10000,
            cgstPaise: 0,
            sgstPaise: 0,
            igstPaise: 0,
            grandTotalPaise: 15000,
          },
        }),
      ),
    );
    const text = (await pdfParse(pdf)).text;
    expect(text).toContain("Rs. 150.00");
    expect(text).toContain("no GST charged");
    expect(text).not.toContain("CGST");
  });

  it("renders very long names and many items across pages", async () => {
    const long = "Acme International Trading Corporation Private Limited ".repeat(4).trim();
    const items = Array.from({ length: 30 }, (_, i) => ({
      name: `Item ${i + 1} — ${long}`,
      quantity: 1,
      unitPricePaise: 10000,
      lineTotalPaise: 10000,
      gstRate: "18.00" as string | null,
      lineTaxPaise: 1800,
    }));
    const subtotal = 30 * 10000;
    const tax = 30 * 1800;
    const pdf = await renderInvoicePdf(
      buildInvoiceData(
        base({
          customer: { name: long, phone: "+919810001111", email: null, gstin: "27ABCDE1234F1Z5" },
          items,
          totals: {
            treatment: "gst",
            subtotalPaise: subtotal,
            deliveryPaise: 0,
            taxablePaise: subtotal,
            cgstPaise: tax / 2,
            sgstPaise: tax / 2,
            igstPaise: 0,
            grandTotalPaise: subtotal + tax,
          },
        }),
      ),
    );
    const parsed = await pdfParse(pdf);
    expect(parsed.numpages).toBeGreaterThan(1);
    expect(parsed.text).toContain("Item 30");
  });

  it("is deterministic for identical frozen input", async () => {
    const a = await renderInvoicePdf(buildInvoiceData(base()));
    const b = await renderInvoicePdf(buildInvoiceData(base()));
    expect(a.equals(b)).toBe(true);
  });
});

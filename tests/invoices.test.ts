import { afterEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));
import {
  buildInvoiceData,
  canIssueInvoice,
  formatInvoiceNumber,
  getFinancialYear,
  type BuildInvoiceInput,
} from "@/lib/invoices/data";
import {
  getBusinessDetails,
  getInvoicePrefix,
} from "@/lib/invoices/business";
import { invoiceFilename } from "@/lib/invoices/pdf";

const BUSINESS = {
  name: "Trolift Solutions",
  address: "14 Industrial Estate, Mumbai 400001",
  phone: "+919810000000",
  email: "sales@trolift.in",
  gstin: "27ABCDE1234F1Z0",
};

const BILLING = {
  name: "Acme Pvt Ltd",
  addressLine: "14 Industrial Estate",
  city: "Mumbai",
  state: "Maharashtra",
  stateCode: "27",
  pincode: "400001",
};

function gstInput(over: Partial<BuildInvoiceInput> = {}): BuildInvoiceInput {
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
      gstin: "27ABCDE1234F1Z0",
    },
    billing: { ...BILLING },
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
      discountPaise: 0,
      grandTotalPaise: 1531564,
    },
    ...over,
  };
}

describe("invoice generation (snapshot-only)", () => {
  it("builds a GST invoice with verified totals", () => {
    const inv = buildInvoiceData(gstInput());
    expect(inv.invoiceNumber).toBe("INV/FY26-27/000042");
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0]?.lineTotalPaise).toBe(1259800 + 226764);
    expect(inv.totals.totalTaxPaise).toBe(226764);
    expect(inv.totals.grandTotalPaise).toBe(1531564);
  });

  it("builds a non-GST invoice with zero tax", () => {
    const inv = buildInvoiceData(
      gstInput({
        customer: {
          name: "Jane",
          phone: "+919820002222",
          email: null,
          gstin: null,
        },
        billing: {
          name: null,
          addressLine: null,
          city: null,
          state: null,
          stateCode: null,
          pincode: null,
        },
        items: [
          {
            name: "Trolley",
            quantity: 1,
            unitPricePaise: 10000,
            lineTotalPaise: 10000,
            gstRate: null,
            lineTaxPaise: 0,
          },
        ],
        totals: {
          treatment: "non_gst",
          subtotalPaise: 10000,
          deliveryPaise: 5000,
          taxablePaise: 10000,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          discountPaise: 0,
          grandTotalPaise: 15000,
        },
      }),
    );
    expect(inv.treatment).toBe("non_gst");
    expect(inv.totals.totalTaxPaise).toBe(0);
  });

  it("builds a multi-item IGST invoice with mixed rates", () => {
    const items = [
      { name: "A", quantity: 1, unitPricePaise: 10000, lineTotalPaise: 10000, gstRate: "18.00", lineTaxPaise: 1800 },
      { name: "B", quantity: 3, unitPricePaise: 5000, lineTotalPaise: 15000, gstRate: "5.00", lineTaxPaise: 750 },
      { name: "C", quantity: 2, unitPricePaise: 2000, lineTotalPaise: 4000, gstRate: null, lineTaxPaise: 0 },
      { name: "D", quantity: 1, unitPricePaise: 999, lineTotalPaise: 999, gstRate: "12.00", lineTaxPaise: 120 },
      { name: "E", quantity: 10, unitPricePaise: 100, lineTotalPaise: 1000, gstRate: "28.00", lineTaxPaise: 280 },
    ];
    const tax = 1800 + 750 + 0 + 120 + 280;
    const subtotal = 10000 + 15000 + 4000 + 999 + 1000;
    const inv = buildInvoiceData(
      gstInput({
        items,
        totals: {
          treatment: "gst",
          subtotalPaise: subtotal,
          deliveryPaise: 10000,
          taxablePaise: subtotal,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: tax,
          discountPaise: 0,
          grandTotalPaise: subtotal + tax + 10000,
        },
      }),
    );
    expect(inv.items).toHaveLength(5);
    expect(inv.totals.totalTaxPaise).toBe(tax);
  });

  it("refuses corrupt snapshots instead of rendering wrong totals", () => {
    expect(() =>
      buildInvoiceData(
        gstInput({ totals: { ...gstInput().totals, grandTotalPaise: 1 } }),
      ),
    ).toThrow(/grand total/);
    // A redeem discount must be netted into the printed grand total.
    expect(() =>
      buildInvoiceData(
        gstInput({
          totals: {
            ...gstInput().totals,
            discountPaise: 30000,
            couponCode: "FIRST300",
          },
        }),
      ),
    ).toThrow(/grand total/);
    expect(() =>
      buildInvoiceData(
        gstInput({
          totals: {
            ...gstInput().totals,
            discountPaise: 30000,
            couponCode: "FIRST300",
            grandTotalPaise: 1531564 - 30000,
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      buildInvoiceData(
        gstInput({
          items: [
            { name: "X", quantity: 1, unitPricePaise: 100, lineTotalPaise: 100, gstRate: "18.00", lineTaxPaise: 999 },
          ],
        }),
      ),
    ).toThrow(/rate/);
    expect(() =>
      buildInvoiceData(
        gstInput({
          totals: {
            ...gstInput().totals,
            cgstPaise: 100000,
            sgstPaise: 100000,
            igstPaise: 26764,
            grandTotalPaise: 1259800 + 226764 + 45000,
          },
        }),
      ),
    ).toThrow(/mixes intra-state/);
    expect(() =>
      buildInvoiceData(
        gstInput({
          customer: {
            name: "Jane",
            phone: "+919820002222",
            email: null,
            gstin: null,
          },
          items: [
            {
              name: "Trolley",
              quantity: 1,
              unitPricePaise: 100,
              lineTotalPaise: 100,
              gstRate: null,
              lineTaxPaise: 0,
            },
          ],
          totals: {
            treatment: "non_gst",
            subtotalPaise: 100,
            deliveryPaise: 0,
            taxablePaise: 100,
            cgstPaise: 10,
            sgstPaise: 0,
          igstPaise: 0,
          discountPaise: 0,
          grandTotalPaise: 110,
          },
        }),
      ),
    ).toThrow(/non-GST invoice carries tax/);
    expect(() =>
      buildInvoiceData(
        gstInput({
          totals: {
            ...gstInput().totals,
            treatment: "non_gst",
          },
        }),
      ),
    ).toThrow(/must not carry a customer GSTIN/);
    expect(() =>
      buildInvoiceData(
        gstInput({
          customer: {
            name: "Jane",
            phone: "+919820002222",
            email: null,
            gstin: null,
          },
          totals: {
            ...gstInput().totals,
            treatment: "gst",
          },
        }),
      ),
    ).not.toThrow(); // B2C GST invoices (no customer GSTIN) are valid.
    expect(() =>
      buildInvoiceData(gstInput({ paymentStatus: "pending" })),
    ).toThrow(/only for paid orders/);
  });

  it("tolerates missing optional fields and very long names", () => {
    const long = "Acme ".repeat(40).trim();
    const inv = buildInvoiceData(
      gstInput({
        business: { ...BUSINESS, phone: null, email: null, gstin: null },
        customer: { name: long, phone: "+919810001111", email: null, gstin: null },
        billing: { name: null, addressLine: null, city: null, state: null, stateCode: null, pincode: null },
        items: [
          { name: long, quantity: 1, unitPricePaise: 100, lineTotalPaise: 100, gstRate: null, lineTaxPaise: 0 },
        ],
        totals: {
          treatment: "non_gst",
          subtotalPaise: 100,
          deliveryPaise: 0,
          taxablePaise: 100,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          discountPaise: 0,
          grandTotalPaise: 100,
        },
      }),
    );
    expect(inv.customer.name).toBe(long);
    expect(inv.items[0]?.name).toBe(long);
  });
});

describe("unpaid order behavior (never label unpaid as paid)", () => {
  it.each(["pending", "submitted", "failed", "cancelled", "refunded"])(
    "refuses invoices for %s orders",
    (status) => {
      expect(canIssueInvoice(status)).toBe(false);
    },
  );

  it("allows invoices for paid orders", () => {
    expect(canIssueInvoice("paid")).toBe(true);
  });
});

describe("invoice numbering (human-readable, FY-aware)", () => {
  it("computes the Indian financial year without hard-coding", () => {
    expect(getFinancialYear(new Date("2026-10-05T00:00:00Z"))).toBe("FY26-27");
    expect(getFinancialYear(new Date("2026-04-01T00:00:00Z"))).toBe("FY26-27");
    expect(getFinancialYear(new Date("2026-03-31T00:00:00Z"))).toBe("FY25-26");
    expect(getFinancialYear(new Date("2027-01-15T00:00:00Z"))).toBe("FY26-27");
  });

  it("formats PREFIX/FY/SEQ numbers and rejects bad parts", () => {
    expect(formatInvoiceNumber("INV", "FY26-27", 42)).toBe("INV/FY26-27/000042");
    expect(() => formatInvoiceNumber("inv!", "FY26-27", 1)).toThrow();
    expect(() => formatInvoiceNumber("INV", "2026", 1)).toThrow();
    expect(() => formatInvoiceNumber("INV", "FY26-27", 0)).toThrow();
  });

  it("sanitises numbers for download filenames", () => {
    expect(invoiceFilename("INV/FY26-27/000042")).toBe("INV-FY26-27-000042.pdf");
  });
});

describe("business configuration", () => {
  afterEach(() => {
    delete process.env.TROLIFT_BUSINESS_NAME;
    delete process.env.TROLIFT_BUSINESS_ADDRESS;
    delete process.env.TROLIFT_BUSINESS_PHONE;
    delete process.env.TROLIFT_BUSINESS_EMAIL;
    delete process.env.TROLIFT_BUSINESS_GSTIN;
    delete process.env.TROLIFT_INVOICE_PREFIX;
  });

  it("defaults the prefix and omits unconfigured optionals", () => {
    process.env.TROLIFT_BUSINESS_NAME = "Trolift Solutions";
    process.env.TROLIFT_BUSINESS_ADDRESS = "Mumbai";
    expect(getInvoicePrefix()).toBe("INV");
    expect(getBusinessDetails()).toEqual({
      name: "Trolift Solutions",
      address: "Mumbai",
      phone: null,
      email: null,
      gstin: null,
    });
  });

  it("fails closed on missing identity or bad prefix", () => {
    process.env.TROLIFT_BUSINESS_ADDRESS = "Mumbai";
    expect(() => getBusinessDetails()).toThrow(/TROLIFT_BUSINESS_NAME/);
    process.env.TROLIFT_BUSINESS_NAME = "Trolift";
    process.env.TROLIFT_INVOICE_PREFIX = "nope!";
    expect(() => getInvoicePrefix()).toThrow(/PREFIX/);
  });
});

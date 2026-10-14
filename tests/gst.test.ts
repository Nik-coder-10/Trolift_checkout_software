import { afterEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));

import {
  computeOrderTax,
  getBusinessStateCode,
  gstinMatchesBillingState,
  gstinStateCode,
  INDIAN_STATES,
  isStateCode,
  lineTaxPaise,
  parseGstRate,
} from "@/lib/tax/india";
import {
  EMPTY_BILLING_FORM,
  EMPTY_CHECKOUT_FORM,
  normalizeBillingForm,
  validateCheckoutForm,
} from "@/lib/checkout/validation";
import { parseOrderRequestBody } from "@/lib/orders/request";
import { priceOrderLines } from "@/lib/orders/quote";

const GSTIN = "27ABCDE1234F1Z0";
const lines = (rates: Array<string | null>, base = 10000) =>
  rates.map((gstRate) => ({ lineTotalPaise: base, gstRate }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("computeOrderTax (integer paise, per-line rounding)", () => {
  it("returns zero tax but the full taxable base for non-GST orders", () => {
    // taxablePaise always equals the goods value (it must match the
    // order subtotal — invoice verification requires this identity for
    // GST and non-GST orders alike). Only the tax components are zero.
    expect(
      computeOrderTax({
        lines: lines(["18.00"]),
        gstin: null,
        customerStateCode: "27",
        businessStateCode: "27",
      }),
    ).toEqual({
      treatment: "non_gst",
      type: "none",
      taxablePaise: 10000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      totalGstPaise: 0,
    });
  });

  it("splits CGST+SGST on same-state sales", () => {
    const tax = computeOrderTax({
      lines: lines(["18.00"], 629900),
      gstin: GSTIN,
      customerStateCode: "27",
      businessStateCode: "27",
    });
    expect(tax.treatment).toBe("gst");
    expect(tax.type).toBe("cgst_sgst");
    expect(tax.taxablePaise).toBe(629900);
    expect(tax.totalGstPaise).toBe(113382);
    expect(tax.cgstPaise + tax.sgstPaise).toBe(tax.totalGstPaise);
    expect(tax.igstPaise).toBe(0);
  });

  it("charges IGST on inter-state sales", () => {
    const tax = computeOrderTax({
      lines: lines(["18.00"], 629900),
      gstin: GSTIN,
      customerStateCode: "29",
      businessStateCode: "27",
    });
    expect(tax.type).toBe("igst");
    expect(tax.igstPaise).toBe(tax.totalGstPaise);
    expect(tax.cgstPaise).toBe(0);
    expect(tax.sgstPaise).toBe(0);
  });

  it("splits odd paise deterministically (floor/ceil, sum preserved)", () => {
    // 1 paise base × 5% rounds to 0… use a total of 1 paise GST instead:
    // 11 paise × 9% = 0.99 → 1 paise total → cgst 0, sgst 1.
    const tax = computeOrderTax({
      lines: [{ lineTotalPaise: 11, gstRate: "9.00" }],
      gstin: GSTIN,
      customerStateCode: "27",
      businessStateCode: "27",
    });
    expect(tax.totalGstPaise).toBe(1);
    expect(tax.cgstPaise).toBe(0);
    expect(tax.sgstPaise).toBe(1);
  });

  it("treats unset (NULL) rates as 0% and sums mixed-rate lines", () => {
    const tax = computeOrderTax({
      lines: [
        { lineTotalPaise: 10000, gstRate: "18.00" },
        { lineTotalPaise: 20000, gstRate: null },
        { lineTotalPaise: 10000, gstRate: "5.00" },
      ],
      gstin: GSTIN,
      customerStateCode: "24",
      businessStateCode: "27",
    });
    expect(tax.taxablePaise).toBe(40000);
    // 1800 + 0 + 500, each rounded per line.
    expect(tax.totalGstPaise).toBe(2300);
    expect(tax.igstPaise).toBe(2300);
  });

  it("rounds per line before summing (no float drift)", () => {
    // 333 × 18% = 59.94 → 60 per line; two lines → 120.
    const tax = computeOrderTax({
      lines: [
        { lineTotalPaise: 333, gstRate: "18.00" },
        { lineTotalPaise: 333, gstRate: "18.00" },
      ],
      gstin: GSTIN,
      customerStateCode: "27",
      businessStateCode: "27",
    });
    expect(tax.totalGstPaise).toBe(120);
  });

  it("falls back to IGST when the business state is unconfigured", () => {
    const tax = computeOrderTax({
      lines: lines(["18.00"], 10000),
      gstin: GSTIN,
      customerStateCode: "27",
      businessStateCode: null,
    });
    expect(tax.type).toBe("igst");
    expect(tax.igstPaise).toBe(1800);
  });

  it("guards invalid rates to zero", () => {
    expect(parseGstRate(null)).toBe(0);
    expect(parseGstRate("101")).toBe(0);
    expect(parseGstRate("-5")).toBe(0);
    expect(parseGstRate("nope")).toBe(0);
    expect(parseGstRate("18.00")).toBe(18);
    expect(lineTaxPaise(10000, null)).toBe(0);
    expect(lineTaxPaise(10000, "18.00")).toBe(1800);
  });

  it("reads the business state from TROLIFT_STATE_CODE only", () => {
    vi.stubEnv("TROLIFT_STATE_CODE", "27");
    expect(getBusinessStateCode()).toBe("27");
    vi.stubEnv("TROLIFT_STATE_CODE", "bogus");
    expect(getBusinessStateCode()).toBeNull();
    vi.stubEnv("TROLIFT_STATE_CODE", "");
    expect(getBusinessStateCode()).toBeNull();
  });

  it("covers the current CBIC state list (38 Ladakh, 37 Andhra Pradesh)", () => {
    expect(isStateCode("37")).toBe(true);
    expect(isStateCode("38")).toBe(true);
    expect(isStateCode("99")).toBe(false);
    expect(INDIAN_STATES.find((s) => s.code === "37")?.name).toContain("Andhra Pradesh");
    expect(INDIAN_STATES.find((s) => s.code === "38")?.name).toContain("Ladakh");
  });

  it("cross-checks GSTIN state against billing state", () => {
    expect(gstinStateCode(GSTIN)).toBe("27");
    expect(gstinMatchesBillingState(GSTIN, "27")).toBe(true);
    expect(gstinMatchesBillingState(GSTIN, "29")).toBe(false);
    expect(gstinMatchesBillingState("short", "27")).toBe(false);
  });
});

describe("checkout billing validation", () => {
  const business = {
    ...EMPTY_CHECKOUT_FORM,
    name: "Acme Pvt Ltd",
    phone: "9810001111",
    pincode: "400001",
    customerType: "business" as const,
    gstin: GSTIN,
    billing: {
      name: "Acme Pvt Ltd",
      addressLine: "14 Industrial Estate",
      city: "Mumbai",
      stateCode: "27",
      pincode: "400001",
    },
  };

  it("accepts a complete business profile", () => {
    expect(validateCheckoutForm(business, 1).valid).toBe(true);
  });

  it("requires GSTIN and every billing field for business orders", () => {
    expect(
      validateCheckoutForm({ ...business, gstin: "" }, 1).errors.gstin,
    ).toBeTruthy();
    for (const field of [
      "name",
      "addressLine",
      "city",
      "stateCode",
      "pincode",
    ] as const) {
      const bad = {
        ...business,
        billing: { ...business.billing, [field]: "" },
      };
      expect(
        validateCheckoutForm(bad, 1).errors[`billing.${field}`],
        field,
      ).toBeTruthy();
    }
  });

  it("keeps individual + optional GSTIN free of billing requirements", () => {
    const individual = {
      ...EMPTY_CHECKOUT_FORM,
      name: "Jane",
      phone: "9810001111",
      pincode: "400001",
      customerType: "individual" as const,
      gstin: GSTIN,
      billing: { ...EMPTY_BILLING_FORM },
    };
    expect(validateCheckoutForm(individual, 1).valid).toBe(true);
  });

  it("rejects a billing state that does not match the GSTIN state", () => {
    const mismatched = {
      ...business,
      billing: { ...business.billing, stateCode: "29" },
    };
    const result = validateCheckoutForm(mismatched, 1);
    expect(result.valid).toBe(false);
    expect(result.errors["billing.stateCode"]).toContain("GSTIN");
    expect(normalizeBillingForm(mismatched.billing, GSTIN)).toBeNull();
  });

  it("normalises billing profiles with server-derived state names", () => {
    expect(normalizeBillingForm({ ...EMPTY_BILLING_FORM }, null)).toEqual({
      gstin: null,
      stateCode: null,
      name: null,
      addressLine: null,
      city: null,
      state: null,
      pincode: null,
    });
    const full = normalizeBillingForm(business.billing, GSTIN);
    expect(full).toMatchObject({
      gstin: GSTIN,
      stateCode: "27",
      state: "Maharashtra",
      pincode: "400001",
    });
    expect(
      normalizeBillingForm({ ...business.billing, city: "" }, GSTIN),
    ).toBeNull();
  });
});

describe("order request billing (server authority)", () => {
  const itemId = "123e4567-e89b-12d3-a456-426614174000";
  const key = "123e4567-e89b-12d3-a456-426614174001";
  const body = (over: Record<string, unknown> = {}) => ({
    items: [{ productId: itemId, quantity: 1 }],
    customer: { name: "Acme", phone: "9810001111", email: "", gstin: GSTIN },
    pincode: "400001",
    idempotencyKey: key,
    ...over,
  });

  it("derives a GST (IGST) identity from a lone GSTIN without a profile", () => {
    const parsed = parseOrderRequestBody(body());
    expect(parsed.billing?.gstin).toBe(GSTIN);
    expect(parsed.billing?.stateCode).toBeNull();
  });

  it("keeps non-GST orders billing-free", () => {
    const parsed = parseOrderRequestBody(
      body({ customer: { name: "Jane", phone: "9810001111", email: "", gstin: "" } }),
    );
    expect(parsed.billing).toBeNull();
    expect(parsed.customer.gstin).toBeNull();
  });

  it("rejects incomplete business profiles instead of downgrading", () => {
    expect(() =>
      parseOrderRequestBody(body({ billing: { name: "Acme" } })),
    ).toThrow(/billing/i);
  });

  it("carries live GST rates through server-side line pricing", () => {
    const priced = priceOrderLines(
      [{ id: "p1", name: "Trolley", price: "6299.00", gst_rate: "18.00", hsn_code: "87168010", is_active: true, available: 99 }],
      [{ productId: "p1", quantity: 2 }],
    );
    expect(priced).toEqual([
      {
        productId: "p1",
        productName: "Trolley",
        quantity: 2,
        unitPricePaise: 629900,
        lineTotalPaise: 1259800,
        gstRate: "18.00",
        lineTaxPaise: 226764,
        hsn: "87168010",
      },
    ]);
    // Identity: subtotal + tax + delivery = total holds in integers.
    // 2 × 629900 = 1259800 taxable; 18% → 226764 GST.
    const subtotal = priced.reduce((n, l) => n + l.lineTotalPaise, 0);
    const tax = computeOrderTax({
      lines: priced.map((l) => ({ lineTotalPaise: l.lineTotalPaise, gstRate: l.gstRate })),
      gstin: GSTIN,
      customerStateCode: "27",
      businessStateCode: "27",
    });
    expect(subtotal).toBe(1259800);
    expect(tax.totalGstPaise).toBe(226764);
    expect(subtotal + tax.totalGstPaise + 45000).toBe(1531564);
    expect(tax.cgstPaise + tax.sgstPaise).toBe(tax.totalGstPaise);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));

import {
  computeOrderTax,
  getBusinessStateCode,
  gstinMatchesBillingState,
  gstinStateCode,
  INDIAN_STATES,
  inclusiveGstPaise,
  inclusiveTaxablePaise,
  isStateCode,
  parseGstRate,
  splitInclusiveLine,
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
/** Inclusive catalogue units → pre-split {taxable, embedded GST} inputs. */
const lines = (rates: Array<string | null>, unitIncl = 10000, qty = 1) =>
  rates.map((gstRate) => {
    const split = splitInclusiveLine(unitIncl, qty, gstRate);
    return { taxablePaise: split.taxablePaise, gstPaise: split.gstPaise };
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("computeOrderTax (integer paise, per-line rounding)", () => {
  it("charges GST on every order — no GSTIN required (B2C)", () => {
    // taxablePaise is the reverse-computed goods value (it must match
    // the order subtotal — invoice verification requires this
    // identity); the embedded GST complements it back to the charge.
    const tax = computeOrderTax({
      lines: lines(["18.00"]),
      customerStateCode: "27",
      businessStateCode: "27",
    });
    expect(tax.treatment).toBe("gst");
    expect(tax.type).toBe("cgst_sgst");
    expect(tax.taxablePaise).toBe(8475);
    expect(tax.totalGstPaise).toBe(1525);
    expect(tax.taxablePaise + tax.totalGstPaise).toBe(10000);
    expect(tax.cgstPaise + tax.sgstPaise).toBe(1525);
  });

  it("keeps taxable + GST equal to the inclusive charge on mixed rates", () => {
    const tax = computeOrderTax({
      lines: lines(["18.00", "5.00", null], 99999),
      customerStateCode: "27",
      businessStateCode: "27",
    });
    // No paisa is created or lost across the three splits.
    expect(tax.taxablePaise + tax.totalGstPaise).toBe(99999 * 3);
    expect(tax.treatment).toBe("gst");
  });

  it("splits CGST+SGST on same-state sales", () => {
    const tax = computeOrderTax({
      lines: lines(["18.00"], 629900),
      customerStateCode: "27",
      businessStateCode: "27",
    });
    expect(tax.treatment).toBe("gst");
    expect(tax.type).toBe("cgst_sgst");
    expect(tax.taxablePaise).toBe(533814);
    expect(tax.totalGstPaise).toBe(96086);
    expect(tax.cgstPaise + tax.sgstPaise).toBe(tax.totalGstPaise);
    expect(tax.igstPaise).toBe(0);
  });

  it("charges IGST on inter-state sales", () => {
    const tax = computeOrderTax({
      lines: lines(["18.00"], 629900),
      customerStateCode: "29",
      businessStateCode: "27",
    });
    expect(tax.type).toBe("igst");
    expect(tax.igstPaise).toBe(tax.totalGstPaise);
    expect(tax.igstPaise).toBe(96086);
    expect(tax.cgstPaise).toBe(0);
    expect(tax.sgstPaise).toBe(0);
  });

  it("splits odd paise deterministically (floor/ceil, sum preserved)", () => {
    // Inclusive 11 paise @ 9% → taxable 10, embedded GST 1 → cgst 0, sgst 1.
    const tax = computeOrderTax({
      lines: lines(["9.00"], 11),
      customerStateCode: "27",
      businessStateCode: "27",
    });
    expect(tax.taxablePaise).toBe(10);
    expect(tax.totalGstPaise).toBe(1);
    expect(tax.cgstPaise).toBe(0);
    expect(tax.sgstPaise).toBe(1);
  });

  it("treats unset (NULL) rates as 0% and sums mixed-rate lines", () => {
    const tax = computeOrderTax({
      lines: [
        ...lines(["18.00"], 10000),
        ...lines([null], 20000),
        ...lines(["5.00"], 10000),
      ],
      customerStateCode: "24",
      businessStateCode: "27",
    });
    // 8475 + 20000 + 9524 taxable; 1525 + 0 + 476 embedded GST.
    expect(tax.taxablePaise).toBe(37999);
    expect(tax.totalGstPaise).toBe(2001);
    expect(tax.igstPaise).toBe(2001);
  });

  it("rounds per line before summing (no float drift)", () => {
    // Inclusive 333 × 18% → taxable 282, GST 51 per line; two lines → 102.
    const tax = computeOrderTax({
      lines: lines(["18.00", "18.00"], 333),
      customerStateCode: "27",
      businessStateCode: "27",
    });
    expect(tax.taxablePaise).toBe(564);
    expect(tax.totalGstPaise).toBe(102);
  });

  it("keeps unit-first rounding exact when quantity multiplies", () => {
    // unit 629900 @ 18% → unit taxable 533814; ×2 = 1067628; the
    // complement 192172 reconstructs the 1259800 charge exactly.
    const split = splitInclusiveLine(629900, 2, "18.00");
    expect(split.unitPricePaise).toBe(629900);
    expect(split.lineTotalPaise).toBe(1259800);
    expect(split.unitTaxablePaise).toBe(533814);
    expect(split.taxablePaise).toBe(1067628);
    expect(split.gstPaise).toBe(192172);
    expect(split.taxablePaise + split.gstPaise).toBe(split.lineTotalPaise);
    expect(split.taxablePaise).toBe(split.unitTaxablePaise * 2);
  });

  it("falls back to IGST when the business state is unconfigured", () => {
    const tax = computeOrderTax({
      lines: lines(["18.00"], 10000),
      customerStateCode: "27",
      businessStateCode: null,
    });
    expect(tax.type).toBe("igst");
    expect(tax.igstPaise).toBe(1525);
  });

  it("guards invalid rates to zero", () => {
    expect(parseGstRate(null)).toBe(0);
    expect(parseGstRate("101")).toBe(0);
    expect(parseGstRate("-5")).toBe(0);
    expect(parseGstRate("nope")).toBe(0);
    expect(parseGstRate("18.00")).toBe(18);
    expect(inclusiveGstPaise(10000, null)).toBe(0);
    expect(inclusiveTaxablePaise(10000, "18.00")).toBe(8475);
    expect(inclusiveGstPaise(10000, "18.00")).toBe(1525);
    // Invalid rates fall back to 0% — the whole amount stays taxable.
    expect(inclusiveGstPaise(10000, "nope")).toBe(0);
    expect(inclusiveGstPaise(10000, "101")).toBe(0);
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
        // Inclusive catalogue price / line total — what the customer pays.
        unitPricePaise: 629900,
        lineTotalPaise: 1259800,
        // Reverse-computed taxable + embedded GST — what the DB stores.
        unitTaxablePaise: 533814,
        taxablePaise: 1067628,
        gstRate: "18.00",
        lineTaxPaise: 192172,
        hsn: "87168010",
      },
    ]);
    // Identity: taxable + embedded GST reconstructs the inclusive
    // charge in integers; no separate delivery line exists (delivery
    // sits inside the catalogue price).
    const subtotal = priced.reduce((n, l) => n + l.taxablePaise, 0);
    const tax = computeOrderTax({
      lines: priced.map((l) => ({ taxablePaise: l.taxablePaise, gstPaise: l.lineTaxPaise })),
      customerStateCode: "27",
      businessStateCode: "27",
    });
    expect(subtotal).toBe(1067628);
    expect(tax.totalGstPaise).toBe(192172);
    expect(subtotal + tax.totalGstPaise).toBe(1259800);
    expect(tax.cgstPaise + tax.sgstPaise).toBe(tax.totalGstPaise);
  });
});

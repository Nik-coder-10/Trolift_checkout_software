import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMPTY_BILLING_FORM,
  EMPTY_CHECKOUT_FORM,
  normalizeCheckoutForm,
  validateCheckoutForm,
} from "@/lib/checkout/validation";

const VALID = {
  name: "Demo Traders",
  phone: "+919876543210",
  email: "",
  gstin: "",
  pincode: "400001",
  shippingAddress: "24, MG Road, Indiranagar, Bengaluru 560038",
  customerType: "individual" as const,
  billing: { ...EMPTY_BILLING_FORM },
};

describe("checkout validation", () => {
  it("accepts a valid form with a non-empty cart", () => {
    expect(validateCheckoutForm(VALID, 2)).toEqual({
      errors: {},
      cartEmpty: false,
      valid: true,
    });
  });

  it("requires a name", () => {
    const r = validateCheckoutForm({ ...VALID, name: " " }, 1);
    expect(r.valid).toBe(false);
    expect(r.errors.name).toContain("full name");
  });

  it("rejects an invalid phone", () => {
    for (const phone of ["123", "abcdefghij", ""]) {
      const r = validateCheckoutForm({ ...VALID, phone }, 1);
      expect(r.valid).toBe(false);
      expect(r.errors.phone).toContain("mobile");
    }
  });

  it("allows blank email but rejects junk", () => {
    expect(validateCheckoutForm(VALID, 1).valid).toBe(true);
    const r = validateCheckoutForm({ ...VALID, email: "not-an-email" }, 1);
    expect(r.valid).toBe(false);
    expect(r.errors.email).toContain("email");
  });

  it("keeps GSTIN optional but format-checks it", () => {
    expect(validateCheckoutForm(VALID, 1).valid).toBe(true);
    expect(
      validateCheckoutForm({ ...VALID, gstin: "27ABCDE1234F1Z0" }, 1).valid,
    ).toBe(true);
    const r = validateCheckoutForm({ ...VALID, gstin: "BOGUS" }, 1);
    expect(r.valid).toBe(false);
    expect(r.errors.gstin).toContain("GSTIN");
  });

  it("requires a 6-digit pincode", () => {
    for (const pincode of ["", "123", "40001", "040001"]) {
      const r = validateCheckoutForm({ ...VALID, pincode }, 1);
      expect(r.valid).toBe(false);
      expect(r.errors.pincode).toContain("pincode");
    }
  });

  it("rejects an empty cart", () => {
    const r = validateCheckoutForm(VALID, 0);
    expect(r.cartEmpty).toBe(true);
    expect(r.valid).toBe(false);
  });

  it("requires a shipping address with the client details", () => {
    for (const shippingAddress of ["", "   ", "12 MG Rd"]) {
      const r = validateCheckoutForm({ ...VALID, shippingAddress }, 1);
      expect(r.valid).toBe(false);
      expect(r.errors.shippingAddress).toContain("shipping address");
    }
  });

  it("collapses a multi-line address instead of rejecting it", () => {
    const r = validateCheckoutForm(
      { ...VALID, shippingAddress: "  24,  MG\nRoad \t  Pune  " },
      1,
    );
    expect(r.valid).toBe(true);
    expect(normalizeCheckoutForm({ ...VALID, shippingAddress: "  24,  MG\nRoad \t  Pune  " }).shippingAddress)
      .toBe("24, MG Road Pune");
  });

  it("caps the shipping address at 500 characters", () => {
    const r = validateCheckoutForm(
      { ...VALID, shippingAddress: "x".repeat(501) },
      1,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.shippingAddress).toContain("500");
  });

  it("starts from an empty form", () => {
    expect(EMPTY_CHECKOUT_FORM).toEqual({
      name: "",
      phone: "",
      email: "",
      gstin: "",
      pincode: "",
      shippingAddress: "",
      customerType: "individual",
      billing: {
        name: "",
        addressLine: "",
        city: "",
        stateCode: "",
        pincode: "",
      },
    });
  });

  it("normalises for the future order API (no prices involved)", () => {
    expect(
      normalizeCheckoutForm({
        ...VALID,
        email: "  ",
        gstin: "27abcde1234f1z0",
        pincode: " 400001 ",
      }),
    ).toEqual({
      name: "Demo Traders",
      phone: "+919876543210",
      email: null,
      gstin: "27ABCDE1234F1Z0",
      pincode: "400001",
      shippingAddress: "24, MG Road, Indiranagar, Bengaluru 560038",
    });
  });
});

describe("checkout form contract (source)", () => {
  const form = () =>
    readFileSync(
      join(__dirname, "..", "components", "checkout", "CheckoutForm.tsx"),
      "utf8",
    );

  it("asks for the shipping address next to name, mobile and email", () => {
    const src = form();
    expect(src).toContain('label="Shipping address"');
    expect(src).toContain('name="shippingAddress"');
    expect(src).toContain("shippingAddress: form.shippingAddress");
    expect(src).toContain('autoComplete="street-address"');
    // Field lives inside the client-details section, before the GST step.
    expect(src.indexOf('label="Shipping address"')).toBeLessThan(
      src.indexOf('title="Customer type & GST"'),
    );
    expect(src.indexOf('label="Shipping address"')).toBeLessThan(
      src.indexOf('label="Delivery Pincode"'),
    );
  });

  it("puts the field first in the focus order after a failed submit", () => {
    const src = form();
    const at = src.indexOf("const focusFirstError");
    expect(at).toBeGreaterThan(-1);
    const focusBlock = src.slice(at, at + 600);
    expect(focusBlock.indexOf("shippingAddress")).toBeGreaterThan(-1);
    expect(focusBlock.indexOf("shippingAddress")).toBeLessThan(
      focusBlock.indexOf("pincode"),
    );
  });

  it("applies redeem codes in the order summary with a struck-through total", () => {
    const src = form();
    // The code input lives in the right-side summary, near the totals.
    expect(src).toContain('htmlFor="coupon-code"');
    expect(src).toContain("Redeem code");
    expect(src).toContain('name="couponCode"');
    expect(src).toContain('"/api/coupons/validate"');
    // Applied state feeds both the summary rows and the place-order body.
    expect(src).toContain("couponCode: appliedCoupon?.code ?? null");
    expect(src).toContain("Discount ({appliedCoupon.code})");
    expect(src).toContain("text-red-600 line-through");
    expect(src).toContain("You saved");
    // One code at a time: applied chip offers Remove, phone edits drop it.
    expect(src).toContain("removeCoupon");
    expect(src).toContain("c.status === \"applied\" ? { status: \"idle\" } : c");
  });
});

import { describe, expect, it } from "vitest";
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

  it("starts from an empty form", () => {
    expect(EMPTY_CHECKOUT_FORM).toEqual({
      name: "",
      phone: "",
      email: "",
      gstin: "",
      pincode: "",
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
    });
  });
});

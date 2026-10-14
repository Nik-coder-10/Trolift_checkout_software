import { describe, expect, it } from "vitest";
import {
  isValidEmail,
  isValidGstin,
  isValidIndianPhone,
  isValidPincode,
  normalizeGstin,
  normalizePincode,
} from "@/lib/validations/common";

describe("pincode validation (matches DB CHECK ^[1-9][0-9]{5}$)", () => {
  it.each(["400001", "110001", "799001"])("accepts %s", (p) => {
    expect(isValidPincode(p)).toBe(true);
  });
  it.each(["123", "40001", "040001", "40000a", ""])(
    "rejects %s",
    (p) => {
      expect(isValidPincode(p)).toBe(false);
    },
  );
  it("trims surrounding whitespace before testing", () => {
    expect(isValidPincode(" 400001 ")).toBe(true);
  });
  it("accepts padded input after normalising", () => {
    expect(normalizePincode("  400001\n")).toBe("400001");
    expect(isValidPincode(normalizePincode("  400001\n"))).toBe(true);
  });
});

describe("GSTIN validation (optional; format + checksum)", () => {
  it("accepts empty (optional field)", () => {
    expect(isValidGstin("")).toBe(true);
  });
  it("accepts a well-formed GSTIN", () => {
    expect(isValidGstin("27ABCDE1234F1Z0")).toBe(true);
  });
  it("accepts lowercase input after normalisation", () => {
    expect(isValidGstin(normalizeGstin("27abcde1234f1z0"))).toBe(true);
  });
  it("accepts a published valid GSTIN (independent check-digit vector)", () => {
    // 27AAPFU0939F1ZV is a documented worked example whose trailing V
    // is the check digit the GSTN base-36 algorithm produces.
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
  });
  it.each(["BOGUS123", "27ABCDE1234F1Z", "27ABCDE1234F1Z55"])(
    "rejects %s",
    (g) => {
      expect(isValidGstin(g)).toBe(false);
    },
  );
  it.each([
    // Well-formed but the check digit does not match the first 14 chars.
    "27ABCDE1234F1Z5",
    "27AAPFU0939F1ZQ",
    "07ABCDE1234F1Z5",
  ])("rejects checksum-invalid %s", (g) => {
    expect(isValidGstin(g)).toBe(false);
  });
});

describe("phone + email", () => {
  it.each(["+919876543210", "9876543210", "09876543210"])(
    "accepts %s",
    (p) => {
      expect(isValidIndianPhone(p)).toBe(true);
    },
  );
  it.each(["123", "+9118001234567890123", "abcdefghij"])("rejects %s", (p) => {
    expect(isValidIndianPhone(p)).toBe(false);
  });
  it("accepts valid email, rejects junk", () => {
    expect(isValidEmail("buyer@example.in")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
  });
});

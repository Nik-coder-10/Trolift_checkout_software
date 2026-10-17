import {
  isValidEmail,
  isValidGstin,
  isValidIndianPhone,
  isValidPincode,
  normalizeGstin,
  normalizePhone,
  normalizePincode,
} from "@/lib/validations/common";
import { INDIAN_STATES, gstinMatchesBillingState, isStateCode } from "@/lib/tax/india";

/**
 * Checkout form validation (client UX + shared with future order API).
 * Pure and dependency-free apart from lib/validations — unit-tested.
 * The server re-validates everything at order time.
 */

export type CustomerType = "individual" | "business";

export interface BillingFormData {
  name: string;
  addressLine: string;
  city: string;
  stateCode: string;
  pincode: string;
}

export interface CheckoutFormData {
  name: string;
  phone: string;
  email: string;
  gstin: string;
  pincode: string;
  /** Delivery address — asked with the client details, for every order. */
  shippingAddress: string;
  customerType: CustomerType;
  billing: BillingFormData;
}

export const SHIPPING_ADDRESS_MIN = 10;
export const SHIPPING_ADDRESS_MAX = 500;

export type CheckoutField =
  | keyof Omit<CheckoutFormData, "billing" | "customerType">
  | `billing.${keyof BillingFormData}`;

export type CheckoutErrors = Partial<Record<CheckoutField, string>>;

export const EMPTY_BILLING_FORM: BillingFormData = {
  name: "",
  addressLine: "",
  city: "",
  stateCode: "",
  pincode: "",
};

export const EMPTY_CHECKOUT_FORM: CheckoutFormData = {
  name: "",
  phone: "",
  email: "",
  gstin: "",
  pincode: "",
  shippingAddress: "",
  customerType: "individual",
  billing: { ...EMPTY_BILLING_FORM },
};

/** Whitespace-collapsed address as stored: "24,  MG\nRoad" → "24, MG Road". */
export function normalizeShippingAddress(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export interface CheckoutValidation {
  errors: CheckoutErrors;
  /** Empty cart is a form-level state (no field owns it). */
  cartEmpty: boolean;
  valid: boolean;
}

export function validateCheckoutForm(
  form: CheckoutFormData,
  itemCount: number,
): CheckoutValidation {
  const errors: CheckoutErrors = {};

  if (form.name.trim().length < 2) {
    errors.name = "Enter your full name.";
  }
  if (!isValidIndianPhone(form.phone)) {
    errors.phone = "Enter a valid 10-digit mobile number.";
  }
  if (form.email.trim() !== "" && !isValidEmail(form.email)) {
    errors.email = "Enter a valid email address, or leave it blank.";
  }
  if (!isValidGstin(form.gstin)) {
    errors.gstin = "Enter a valid 15-character GSTIN, or leave it blank.";
  }
  if (!isValidPincode(form.pincode)) {
    errors.pincode = "Enter a valid 6-digit delivery pincode.";
  }
  // The address is where the goods actually go — pincode alone has
  // never been enough to dispatch, so it is required for every order.
  const shippingAddress = normalizeShippingAddress(form.shippingAddress);
  if (shippingAddress.length < SHIPPING_ADDRESS_MIN) {
    errors.shippingAddress =
      "Enter the full shipping address (house/flat, street, area, city).";
  } else if (shippingAddress.length > SHIPPING_ADDRESS_MAX) {
    errors.shippingAddress =
      `Shipping address is too long — ${SHIPPING_ADDRESS_MAX} characters maximum.`;
  }
  if (form.customerType === "business") {
    // GST orders need a complete billing profile; format-checked here,
    // government verification is explicitly out of scope.
    if (form.billing.name.trim().length < 2) {
      errors["billing.name"] = "Enter the legal/business name.";
    }
    if (form.billing.addressLine.trim().length < 5) {
      errors["billing.addressLine"] = "Enter the billing street address.";
    }
    if (form.billing.city.trim().length < 2) {
      errors["billing.city"] = "Enter the billing city.";
    }
    if (!isStateCode(form.billing.stateCode)) {
      errors["billing.stateCode"] = "Select the billing state.";
    }
    if (!isValidPincode(form.billing.pincode)) {
      errors["billing.pincode"] = "Enter a valid 6-digit billing pincode.";
    }
    if (form.gstin.trim() === "") {
      errors.gstin = "Business orders need a GSTIN for the invoice.";
    } else if (
      isStateCode(form.billing.stateCode) &&
      isValidGstin(form.gstin) &&
      !gstinMatchesBillingState(form.gstin, form.billing.stateCode)
    ) {
      // The GSTIN embeds its registration state (first 2 digits) — a
      // mismatch with the billing state is almost always a typo, and
      // ITC follows the billing state. Multi-state customers must use
      // the GSTIN registered in the billing state.
      errors["billing.stateCode"] =
        "Billing state does not match the GSTIN state — check both.";
    }
  }
  const cartEmpty = itemCount <= 0;
  return {
    errors,
    cartEmpty,
    valid: Object.keys(errors).length === 0 && !cartEmpty,
  };
}

/** Normalised payload for the future order API (never prices/totals). */
export function normalizeCheckoutForm(form: CheckoutFormData) {
  return {
    name: form.name.trim(),
    phone: normalizePhone(form.phone),
    email: form.email.trim() === "" ? null : form.email.trim(),
    gstin: form.gstin.trim() === "" ? null : normalizeGstin(form.gstin),
    pincode: normalizePincode(form.pincode),
    shippingAddress: normalizeShippingAddress(form.shippingAddress),
  };
}

export interface NormalizedBilling {
  gstin: string | null;
  stateCode: string | null;
  name: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

/**
 * Normalise a billing profile. GSTIN comes from the already-normalised
 * customer payload (single source of truth). Returns null when a GST
 * order's profile is incomplete — callers fail with 422. Dependency-free.
 */
export function normalizeBillingForm(
  form: BillingFormData,
  gstin: string | null,
): NormalizedBilling | null {
  if (gstin === null) {
    return {
      gstin: null,
      stateCode: null,
      name: null,
      addressLine: null,
      city: null,
      state: null,
      pincode: null,
    };
  }
  if (validateBillingProfile(form) !== null) return null;
  if (!gstinMatchesBillingState(gstin, form.stateCode)) return null;
  return {
    gstin,
    stateCode: form.stateCode,
    name: form.name.trim(),
    addressLine: form.addressLine.trim(),
    city: form.city.trim(),
    state: INDIAN_STATES.find((s) => s.code === form.stateCode)?.name ?? null,
    pincode: normalizePincode(form.pincode),
  };
}

/** First billing problem, or null when the profile is complete. */
export function validateBillingProfile(form: BillingFormData): string | null {
  if (form.name.trim().length < 2) return "Enter the legal/business name.";
  if (form.addressLine.trim().length < 5) return "Enter the billing street address.";
  if (form.city.trim().length < 2) return "Enter the billing city.";
  if (!isStateCode(form.stateCode)) return "Select the billing state.";
  if (!isValidPincode(form.pincode)) return "Enter a valid 6-digit billing pincode.";
  return null;
}

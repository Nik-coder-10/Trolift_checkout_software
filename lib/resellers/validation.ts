import { isValidIndianPhone, normalizePhone } from "@/lib/validations/common";

/**
 * Reseller-enquiry validation (pure — no server imports, unit-tested).
 *
 * Resellers ask for trade rates we do not publish per item, so the
 * enquiry is a callback flow: a name, a REQUIRED mobile number and the
 * requirements in their own words. Business name is optional context
 * for the inbox. Same no-email stance as the contact form — the team
 * calls back, there is no reply-to address to harvest.
 */

export interface ResellerEnquiryInput {
  name: string;
  phone: string;
  business: string;
  message: string;
}

export interface ValidResellerEnquiry {
  name: string;
  /** Normalized `+91…` number — always present, the callback channel. */
  phone: string;
  /** Trading / firm name, or null when the visitor left it blank. */
  business: string | null;
  message: string;
}

export type ResellerEnquiryField = "name" | "phone" | "message";

export type ResellerEnquiryErrors = Partial<Record<ResellerEnquiryField, string>>;

export const RESELLER_MESSAGE_MIN = 15;
export const RESELLER_MESSAGE_MAX = 2_000;
export const RESELLER_NAME_MAX = 100;
export const RESELLER_BUSINESS_MAX = 120;

export function validateResellerEnquiry(input: ResellerEnquiryInput): {
  errors: ResellerEnquiryErrors;
  value: ValidResellerEnquiry | null;
} {
  const errors: ResellerEnquiryErrors = {};

  // Collapse whitespace runs so a multi-line paste can never smuggle
  // headers or layout into the subject line.
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) {
    errors.name = "Please tell us your name.";
  } else if (name.length > RESELLER_NAME_MAX) {
    errors.name = `Name must be ${RESELLER_NAME_MAX} characters or fewer.`;
  }

  // Unlike the contact form, a reseller enquiry without a number is
  // pointless — there is nothing to call back on.
  const rawPhone = input.phone.trim();
  let phone: string | null = null;
  if (rawPhone === "") {
    errors.phone = "Leave a mobile number so we can call you back.";
  } else {
    const normalized = normalizePhone(rawPhone);
    if (!isValidIndianPhone(normalized)) {
      errors.phone = "Enter a valid 10-digit Indian mobile number.";
    } else {
      phone = normalized;
    }
  }

  const businessRaw = input.business.trim().replace(/\s+/g, " ");
  const business =
    businessRaw === "" || businessRaw.length > RESELLER_BUSINESS_MAX
      ? null
      : businessRaw;

  const message = input.message.trim();
  if (message.length < RESELLER_MESSAGE_MIN) {
    errors.message = `Tell us what you need in at least ${RESELLER_MESSAGE_MIN} characters — equipment types, quantities, cities.`;
  } else if (message.length > RESELLER_MESSAGE_MAX) {
    errors.message = `Keep your requirements under ${RESELLER_MESSAGE_MAX} characters.`;
  }

  if (Object.keys(errors).length > 0 || phone === null) {
    return { errors, value: null };
  }
  return { errors: {}, value: { name, phone, business, message } };
}

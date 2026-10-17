import { isValidIndianPhone, normalizePhone } from "@/lib/validations/common";

/**
 * Contact-form validation (pure — no server imports, unit-tested).
 *
 * The form deliberately collects NO email address: the visitor leaves
 * a name, an optional callback number and their query, and the query
 * is delivered to our own inbox. Anything the server has not seen
 * before is rejected here so bad input never reaches the mailer.
 */

export interface ContactQueryInput {
  name: string;
  phone: string;
  message: string;
}

export interface ValidContactQuery {
  name: string;
  /** Normalized `+91…` number, or null when the visitor left it blank. */
  phone: string | null;
  message: string;
}

export type ContactQueryField = "name" | "phone" | "message";

export type ContactQueryErrors = Partial<Record<ContactQueryField, string>>;

export const CONTACT_MESSAGE_MIN = 10;
export const CONTACT_MESSAGE_MAX = 2_000;
export const CONTACT_NAME_MAX = 100;

export function validateContactQuery(input: ContactQueryInput): {
  errors: ContactQueryErrors;
  value: ValidContactQuery | null;
} {
  const errors: ContactQueryErrors = {};

  // Collapse every run of whitespace (including newlines) so a
  // multi-line paste can never smuggle headers or layout into the
  // subject line.
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) {
    errors.name = "Please tell us your name.";
  } else if (name.length > CONTACT_NAME_MAX) {
    errors.name = `Name must be ${CONTACT_NAME_MAX} characters or fewer.`;
  }

  const rawPhone = input.phone.trim();
  let phone: string | null = null;
  if (rawPhone !== "") {
    const normalized = normalizePhone(rawPhone);
    if (!isValidIndianPhone(normalized)) {
      errors.phone = "Enter a valid 10-digit Indian mobile number.";
    } else {
      phone = normalized;
    }
  }

  const message = input.message.trim();
  if (message.length < CONTACT_MESSAGE_MIN) {
    errors.message = `Please describe your query in at least ${CONTACT_MESSAGE_MIN} characters.`;
  } else if (message.length > CONTACT_MESSAGE_MAX) {
    errors.message = `Keep your query under ${CONTACT_MESSAGE_MAX} characters.`;
  }

  if (Object.keys(errors).length > 0) return { errors, value: null };
  return { errors: {}, value: { name, phone, message } };
}

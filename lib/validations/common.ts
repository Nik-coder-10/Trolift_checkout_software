/**
 * Dependency-free input validators shared by client + server.
 * Server re-validates everything — client checks are UX only.
 */

/** Exactly 6 digits (Indian PIN code). */
export function isValidPincode(value: string): boolean {
  return /^[1-9][0-9]{5}$/.test(value.trim());
}

/**
 * GSTIN: 15 chars — 2-digit state code, 10-char PAN, entity code,
 * 'Z', checksum. Format is checked by shape; the final character is
 * verified against the GSTN base-36 weighted checksum, so transposed
 * or mistyped characters fail instead of flowing into tax documents.
 * (Government-registry existence checks remain out of scope.)
 */
const GSTIN_FORMAT =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Check character for the first 14 GSTIN characters: base-36 values
 * weighted 1,2,1,2… (odd positions ×1, even ×2), each product reduced
 * to quotient + remainder mod 36, summed, then (36 − sum % 36) % 36.
 * Assumes uppercase alphanumeric input of length ≥ 14.
 */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const code = GSTIN_ALPHABET.indexOf(first14[i] ?? "");
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_ALPHABET[(36 - (sum % 36)) % 36] ?? "0";
}

/** Format shape plus checksum digit. Empty stays valid (GSTIN optional). */
export function isValidGstinChecksum(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (!GSTIN_FORMAT.test(v)) return false;
  return v[14] === gstinCheckDigit(v.slice(0, 14));
}

export function isValidGstin(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (v === "") return true; // GSTIN is optional
  return isValidGstinChecksum(v);
}

/** 10-digit Indian mobile (allows +91 / leading 0 for UX). */
export function isValidIndianPhone(value: string): boolean {
  const digits = value.replace(/[^\d]/g, "").replace(/^(91|0)/, "");
  return /^[6-9]\d{9}$/.test(digits);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function normalizePincode(value: string): string {
  return value.trim();
}

/**
 * Canonical Indian mobile: last 10 digits with +91 prefix.
 * Used for customer dedup — "+919876543210", "09876543210" and
 * "9876543210" all identify the same customer.
 */
export function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return `+91${national}`;
}

export function normalizeGstin(value: string): string {
  return value.trim().toUpperCase();
}

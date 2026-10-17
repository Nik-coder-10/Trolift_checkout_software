/** Pure coupon-code helpers — safe to import from client and server. */

export const COUPON_CODE_RE = /^[A-Z0-9]{3,32}$/;

export function normalizeCouponCode(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

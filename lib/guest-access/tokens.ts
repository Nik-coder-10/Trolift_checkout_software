import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Guest order capability tokens (server-only).
 *
 * Design:
 * - Raw token: 256 bits from `crypto.randomBytes`, base64url-encoded.
 *   Never persisted, never logged, never returned except once at
 *   issuance (checkout response / recovery / rotation).
 * - Stored: hex SHA-256 of the raw token, bound to exactly one order_id,
 *   with expires_at + revoked_at. Lookup compares hashes with
 *   timingSafeEqual in JS (portable across mocked + real backends).
 * - Transport: HttpOnly, Secure, SameSite=Lax cookie scoped to the
 *   order (`Path=/orders/<id>` is NOT used so the same cookie also
 *   authorizes `/api/orders/<id>/invoice`; instead the cookie NAME is
 *   bound to the order). A `?key=` URL param is accepted exactly once
 *   by the session-exchange endpoint and immediately stripped from the
 *   address bar — long-lived tokens never live in URLs, history,
 *   referrers or screenshots.
 * - The token HASH is never exposed through any public API.
 */

export const GUEST_TOKEN_BYTES = 32;
export const GUEST_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const GUEST_TOKEN_RE = /^[A-Za-z0-9_-]{40,50}$/;

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Per-order cookie name — deterministic without storing a registry. */
export function guestCookieName(orderId: string): string {
  const digest = createHash("sha256").update(orderId).digest("hex").slice(0, 16);
  return `tl_go_${digest}`;
}

export function generateGuestToken(): string {
  return randomBytes(GUEST_TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function hashGuestToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export interface GuestTokenRow {
  token_hash: string;
  order_id: string;
  expires_at: string;
  revoked_at: string | null;
}

export function isTokenRowUsable(
  row: GuestTokenRow,
  orderId: string,
  nowMs = Date.now(),
): boolean {
  if (row.order_id !== orderId) return false;
  if (row.revoked_at !== null) return false;
  const exp = Date.parse(row.expires_at);
  if (!Number.isFinite(exp) || exp <= nowMs) return false;
  return true;
}

/** True when the presented raw token matches any usable stored hash. */
export function matchesStoredToken(
  raw: string,
  rows: GuestTokenRow[],
  orderId: string,
  nowMs = Date.now(),
): boolean {
  if (!GUEST_TOKEN_RE.test(raw)) return false;
  const candidate = hashGuestToken(raw);
  for (const row of rows) {
    if (!isTokenRowUsable(row, orderId, nowMs)) continue;
    if (safeEqualHex(row.token_hash, candidate)) return true;
  }
  return false;
}

/**
 * Serialize a Set-Cookie value for the guest token. HttpOnly so page JS
 * (and any injected script) cannot exfiltrate it; SameSite=Lax; Secure
 * in production; Path=/ so invoice downloads under /api also carry it.
 * Max-Age mirrors the server-side expiry. Never log this string.
 */
export function serializeGuestCookie(
  orderId: string,
  rawToken: string,
  maxAgeSeconds: number,
): string {
  const parts = [
    `${guestCookieName(orderId)}=${encodeURIComponent(rawToken)}`,
    "Path=/",
    `Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function expiredGuestCookie(orderId: string): string {
  return `${guestCookieName(orderId)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

/** Extract the guest token for an order from a Cookie header value. */
export function guestTokenFromCookieHeader(
  orderId: string,
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null;
  const name = guestCookieName(orderId);
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const value = decodeURIComponent(part.slice(idx + 1).trim());
      return value === "" ? null : value;
    }
  }
  return null;
}

/** PII-safe redaction helpers for the customer-safe projection. */
export function maskPhoneFull(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length <= 4) return "••••";
  return `••••••${digits.slice(-4)}`;
}

/** Show first ~2 + last 3 of a GSTIN; the full value stays invoice-only. */
export function maskGstin(gstin: string | null): string | null {
  if (!gstin) return null;
  const clean = gstin.trim().toUpperCase();
  if (clean.length < 6) return "••••••";
  return `${clean.slice(0, 2)}•••••••${clean.slice(-3)}`;
}

/** Show only the last 4 of a payment reference publicly. */
export function maskReference(ref: string | null): string | null {
  if (!ref) return null;
  const clean = ref.trim();
  if (clean.length <= 4) return "••••";
  return `••••${clean.slice(-4)}`;
}

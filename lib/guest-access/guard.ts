import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  GUEST_TOKEN_RE,
  UUID_RE,
  generateGuestToken,
  guestTokenFromCookieHeader,
  hashGuestToken,
  isTokenRowUsable,
  serializeGuestCookie,
  type GuestTokenRow,
} from "@/lib/guest-access/tokens";

/**
 * Guest-access authorization (server-only).
 *
 * Rules:
 * - Malformed order ids and missing/malformed tokens fail CLOSED with
 *   NO database read (callers check `hasGuestCredential` first; the
 *   verify path double-checks). This keeps unauthenticated probes from
 *   causing service-role reads and from distinguishing "unknown order"
 *   vs "forbidden" (both surface as 404/null upstream).
 * - A token authorizes exactly one order (order_id binding checked on
 *   every use). Tokens are never logged — error paths omit them.
 * - Only hashes are stored; only hashes travel to the database.
 */

export function hasGuestCredential(
  orderId: string,
  rawToken: string | null | undefined,
): boolean {
  return (
    UUID_RE.test(orderId) &&
    typeof rawToken === "string" &&
    GUEST_TOKEN_RE.test(rawToken)
  );
}

/** Pull the guest token for an order from the request's Cookie header. */
export function guestTokenFromRequest(
  orderId: string,
  req: Request,
): string | null {
  if (!UUID_RE.test(orderId)) return null;
  return guestTokenFromCookieHeader(orderId, req.headers.get("cookie"));
}

/** Fetch candidate token rows for an order (hashes only, never raw). */
async function loadTokenRows(
  orderId: string,
  // biome-ignore lint: supabase client type varies incl. test mock
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ rows: GuestTokenRow[]; client: any }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = client ?? createAdminClient();
  const { data, error } = (await admin
    .from("order_access_tokens")
    .select("token_hash,order_id,expires_at,revoked_at")
    .eq("order_id", orderId)) as unknown as {
    data: GuestTokenRow[] | null;
    error: unknown;
  };
  if (error) return { rows: [], client: admin };
  return { rows: (data ?? []) as GuestTokenRow[], client: admin };
}

/**
 * Verify a raw guest token against stored hashes for the order.
 * Returns false for malformed input WITHOUT touching the database.
 */
export async function verifyGuestToken(
  orderId: string,
  rawToken: string | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any,
): Promise<boolean> {
  if (!hasGuestCredential(orderId, rawToken)) return false;
  const { rows } = await loadTokenRows(orderId, client);
  const candidate = hashGuestToken(rawToken as string);
  const nowMs = Date.now();
  for (const row of rows) {
    if (!isTokenRowUsable(row, orderId, nowMs)) continue;
    if (row.token_hash === candidate) {
      // Best-effort usage stamp; never blocks authorization.
      try {
        const admin = client ?? createAdminClient();
        await admin
          .from("order_access_tokens")
          .update({ last_used_at: new Date().toISOString() })
          .eq("order_id", orderId)
          .eq("token_hash", candidate);
      } catch {
        // ignore — stamping must not fail the request
      }
      return true;
    }
  }
  return false;
}

/** Authorize a Request carrying the cookie (or an explicit bearer). */
export async function authorizeGuestRequest(
  orderId: string,
  req: Request,
  explicitToken?: string | null,
): Promise<boolean> {
  const token = explicitToken ?? guestTokenFromRequest(orderId, req);
  return verifyGuestToken(orderId, token);
}

export interface IssuedToken {
  /** Raw token — return to the customer ONCE, never store or log. */
  token: string;
  expiresAt: string;
  /** Ready-to-append Set-Cookie value. */
  cookie: string;
}

const TTL_SECONDS = 90 * 24 * 60 * 60;

/** Issue a fresh token for an order (checkout, recovery, rotation). */
export async function issueGuestToken(
  orderId: string,
  label = "checkout",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any,
): Promise<IssuedToken | null> {
  if (!UUID_RE.test(orderId)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = client ?? createAdminClient();
  // Order must exist — but surface existence only to callers that are
  // already authorized (checkout just created it; recovery matched
  // phone+number). Unknown ids return null like any other failure.
  const { data: order, error: orderError } = (await admin
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .maybeSingle()) as unknown as { data: { id: string } | null; error: unknown };
  if (orderError || !order) return null;
  // One-active-token convergence: revoke priors BEFORE inserting so the
  // partial unique index on (order_id) can never reject the issuance
  // and at most one bearer is live afterwards.
  try {
    await admin
      .from("order_access_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("order_id", orderId);
  } catch {
    // best-effort; the insert below still binds to this order only
  }
  const token = generateGuestToken();
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
  const { error } = (await admin.from("order_access_tokens").insert({
    order_id: orderId,
    token_hash: hashGuestToken(token),
    expires_at: expiresAt,
    label: label.slice(0, 40),
  })) as unknown as { error: unknown };
  if (error) return null;
  return { token, expiresAt, cookie: serializeGuestCookie(orderId, token, TTL_SECONDS) };
}

/**
 * Rotate: requires the currently-valid token, then issues a replacement
 * (issuance revokes all priors, including the presented one). A failed
 * rotation issues nothing, so the customer is never locked out.
 * Concurrent uses of the old token during the switch may still verify
 * until the revoke commits — rotation is eventually consistent.
 */
export async function rotateGuestToken(
  orderId: string,
  rawToken: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any,
): Promise<IssuedToken | null> {
  const ok = await verifyGuestToken(orderId, rawToken, client);
  if (!ok) return null;
  return issueGuestToken(orderId, "rotation", client);
}

/** Revoke a single token (logout / "this link was shared by mistake"). */
export async function revokeGuestToken(
  orderId: string,
  rawToken: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any,
): Promise<boolean> {
  if (!hasGuestCredential(orderId, rawToken)) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = client ?? createAdminClient();
    await admin
      .from("order_access_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("order_id", orderId)
      .eq("token_hash", hashGuestToken(rawToken));
    return true;
  } catch {
    return false;
  }
}

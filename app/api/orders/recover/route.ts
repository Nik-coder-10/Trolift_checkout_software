import { ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueGuestToken } from "@/lib/guest-access/guard";
import { normalizePhone } from "@/lib/validations/common";

/**
 * POST /api/orders/recover — safe recovery when a customer loses access.
 *
 * Body: { orderNumber, phone }. When BOTH match an order, all prior
 * tokens are revoked and a fresh token is issued (returned once + set
 * as the cookie). When they do not match, the response is an identical
 * generic 404 — an order number alone (or a wrong phone) discloses
 * nothing and grants nothing. Rate-limited as strictly as claims.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("recover", await checkRateLimit(req, "recover"));
  if (denied) return denied;
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const orderNumber = String(record["orderNumber"] ?? "").trim();
  const phone = String(record["phone"] ?? "").trim();
  if (orderNumber === "" || phone === "") {
    throw new AppError("NOT_FOUND", "Order not found.", 404);
  }
  const admin = createAdminClient();
  const { data: order, error: orderError } = (await admin
    .from("orders")
    .select("id,customer_id")
    .eq("order_number", orderNumber)
    .maybeSingle()) as unknown as {
    data: { id: string; customer_id: string } | null;
    error: unknown;
  };
  if (orderError || !order) {
    throw new AppError("NOT_FOUND", "Order not found.", 404);
  }
  const { data: customer } = (await admin
    .from("customers")
    .select("phone")
    .eq("id", order.customer_id)
    .maybeSingle()) as unknown as {
    data: { phone: string } | null;
  };
  if (!customer || normalizePhone(customer.phone) !== normalizePhone(phone)) {
    throw new AppError("NOT_FOUND", "Order not found.", 404);
  }
  // Revoke prior tokens (lost/stale links die), then issue fresh.
  try {
    await admin
      .from("order_access_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("order_id", order.id);
  } catch {
    // best-effort; issuance still binds to this order only
  }
  const issued = await issueGuestToken(order.id, "recovery", admin);
  if (!issued) {
    throw new AppError("NOT_FOUND", "Order not found.", 404);
  }
  const res = ok({
    orderId: order.id,
    expiresAt: issued.expiresAt,
    token: issued.token,
  });
  res.headers.append("Set-Cookie", issued.cookie);
  return res;
});

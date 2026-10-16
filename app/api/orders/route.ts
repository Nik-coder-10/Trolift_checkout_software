import { after } from "next/server";
import { ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { parseOrderRequestBody } from "@/lib/orders/request";
import { quoteOrder } from "@/lib/orders/quote";
import { fetchOrderSummary, persistOrder } from "@/lib/orders/create";
import { issueGuestToken } from "@/lib/guest-access/guard";
import { notifyOrderPlaced } from "@/lib/notifications/order-notifications";

/**
 * POST /api/orders — place an order from cart + checkout details.
 *
 * Server-authoritative flow:
 *   validate input → fetch live products → verify active → validate
 *   quantities → subtotal → validate GSTIN/billing/pincode → GST engine
 *   → delivery engine → partner + charge → total → customer upsert →
 *   order + items + pending payment (one atomic RPC) → issue guest
 *   access token → safe summary.
 *
 * The body carries IDs, quantities, customer details, pincode and an
 * idempotency key — and nothing else. Prices, charges, totals, partner
 * and statuses are all derived server-side. Retried requests with the
 * same key replay to the original order.
 *
 * Guest access: a fresh capability token is issued for the order and
 * returned ONCE as `guestToken` (plus set as the HttpOnly guest cookie)
 * so the customer reaches confirmation, payment, tracking and invoices
 * without the order UUID ever acting as authorization. The raw token is
 * never logged; only its hash is stored. Callers must not persist it in
 * localStorage — the cookie is the session.
 *
 * Notifications: after the response goes out, `after()` sends the
 * customer and owner email copies of the order details. An email
 * outage is logged and can never fail or delay a committed order, and
 * a replayed idempotency key (duplicate) does not ring twice.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("orders", await checkRateLimit(req, "orders"));
  if (denied) return denied;
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  const parsed = parseOrderRequestBody(body);
  const quote = await quoteOrder({
    items: parsed.items,
    pincode: parsed.pincode,
    billing: parsed.billing,
  });
  const persisted = await persistOrder({
    idempotencyKey: parsed.idempotencyKey,
    customer: parsed.customer,
    quote,
  });
  const summary = await fetchOrderSummary(persisted.orderId);
  // Duplicate replay (same idempotency key): rotate into a fresh token
  // so a retried checkout still lands in an authorized session.
  const issued = await issueGuestToken(
    persisted.orderId,
    persisted.duplicate ? "checkout-retry" : "checkout",
  );
  const res = ok({
    ...summary,
    duplicate: persisted.duplicate,
    // Raw token, delivered exactly once over this response body.
    guestToken: issued?.token ?? null,
    guestExpiresAt: issued?.expiresAt ?? null,
  });
  if (issued) res.headers.append("Set-Cookie", issued.cookie);
  // Owner + customer email copies, after the response is on the wire.
  // A duplicate submit (same idempotency key) is the same order, so it
  // must not message anyone a second time.
  if (!persisted.duplicate) {
    const notify = () =>
      notifyOrderPlaced({
        orderNumber: summary.orderNumber,
        customer: {
          name: parsed.customer.name,
          phone: parsed.customer.phone,
          email: parsed.customer.email,
        },
        billing: parsed.billing,
        lines: quote.lines.map((line) => ({
          productName: line.productName,
          quantity: line.quantity,
          lineTotalPaise: line.lineTotalPaise,
        })),
        subtotalPaise: summary.subtotalPaise,
        taxPaise: summary.cgstPaise + summary.sgstPaise + summary.igstPaise,
        deliveryChargePaise: summary.deliveryChargePaise,
        deliveryPartnerName: quote.deliveryPartnerName,
        etaDays: null,
        totalPaise: summary.totalPaise,
        pincode: quote.pincode,
      });
    try {
      after(notify);
    } catch {
      void notify();
    }
  }
  return res;
});

import { after } from "next/server";
import { ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { parseOrderRequestBody } from "@/lib/orders/request";
import { quoteOrder } from "@/lib/orders/quote";
import { fetchOrderSummary, persistOrder } from "@/lib/orders/create";
import { resolveCoupon } from "@/lib/coupons/resolve";
import { issueGuestToken } from "@/lib/guest-access/guard";
import { notifyOrderPlaced } from "@/lib/notifications/order-notifications";
import { getQuotationData } from "@/lib/quotations/service";
import { renderQuotationPdf } from "@/lib/quotations/pdf";
import { logWarn } from "@/lib/observability/logger";

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
    odaDoorDelivery: parsed.odaDoorDelivery,
  });
  // One offer at a time, re-resolved here against THIS order's phone
  // and total — the checkout preview is advisory, money is this side.
  const coupon = parsed.couponCode
    ? await resolveCoupon({
        code: parsed.couponCode,
        phone: parsed.customer.phone,
        totalPaise: quote.totalPaise,
      })
    : null;
  const persisted = await persistOrder({
    idempotencyKey: parsed.idempotencyKey,
    customer: parsed.customer,
    shippingAddress: parsed.shippingAddress,
    quote,
    coupon,
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
    const notify = async () => {
      // Best-effort: freeze + render the order's quotation so BOTH email
      // copies carry the PDF (the customer may have missed the pay-page
      // download; the owner keeps their copy). Any failure here is
      // logged and the emails still go out without the attachment —
      // a PDF hiccup can never fail a committed order.
      let quotation: { number: string; content: Buffer } | null = null;
      try {
        const data = await getQuotationData(persisted.orderId);
        quotation = {
          number: data.quotationNumber,
          content: await renderQuotationPdf(data),
        };
      } catch (error) {
        logWarn("Order emails sent without the quotation PDF.", {
          category: "email",
          operation: "order-notification",
          orderNumber: summary.orderNumber,
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
      return notifyOrderPlaced({
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
          // Inclusive line amount — what the customer actually pays.
          lineTotalPaise: line.lineTotalPaise,
        })),
        taxPaise: summary.cgstPaise + summary.sgstPaise + summary.igstPaise,
        taxType: summary.igstPaise > 0 ? "igst" : "cgst_sgst",
        deliveryPartnerName: quote.deliveryPartnerName,
        deliveryChargePaise: quote.deliveryChargePaise,
        deliveryTaxPaise: quote.deliveryTaxPaise,
        etaDays: quote.etaDays,
        totalPaise: summary.totalPaise,
        discountPaise: summary.discountPaise,
        couponCode: summary.couponCode,
        pincode: quote.pincode,
        shippingAddress: parsed.shippingAddress,
        quotation,
      });
    };
    try {
      after(notify);
    } catch {
      void notify();
    }
  }
  return res;
});

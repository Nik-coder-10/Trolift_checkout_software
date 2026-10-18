import { ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueGuestToken } from "@/lib/guest-access/guard";
import { isValidIndianPhone, normalizePhone } from "@/lib/validations/common";

const LIST_LIMIT = 20;

interface MyOrderRow {
  id: string;
  order_number: string;
  created_at: string;
  total_amount: string;
  payment_status: string;
  order_status: string;
  delivery_pincode: string;
  delivery_partner_name: string | null;
}

const toPaise = (decimal: string): number =>
  Math.round(Number(decimal) * 100);

/**
 * POST /api/orders/my — list a customer's orders by mobile number.
 *
 * Body: { phone }. The number is normalised (E.164) and matched
 * against the customers table; every order for those customer ids is
 * returned (newest first, capped at 20) as a SAFE projection — no
 * tokens, no addresses, no GSTINs in the response body. Access is
 * granted the same way recovery does it: one fresh guest token per
 * listed order, delivered only as HttpOnly Set-Cookie headers (the
 * raw values are never in the JSON). Listing an order rotates any
 * prior token for it — the same one-active-bearer rule recovery
 * follows — so another device's stale link dies; this device keeps
 * working because the replacement cookie arrives in this response.
 *
 * Phone-only auth is deliberately weaker than order-number + phone
 * recovery, so this endpoint shares the strict `recover` rate-limit
 * bucket (5/min, fail-closed) and malformed numbers fail with a plain
 * 400 rather than probing the database.
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
  const rawPhone = String(record["phone"] ?? "").trim();
  if (!isValidIndianPhone(rawPhone)) {
    throw new AppError("BAD_REQUEST", "Enter a valid 10-digit mobile number.", 400);
  }
  const phone = normalizePhone(rawPhone);
  const admin = createAdminClient();

  const { data: customers, error: customersError } = (await admin
    .from("customers")
    .select("id")
    .eq("phone", phone)) as unknown as {
    data: Array<{ id: string }> | null;
    error: unknown;
  };
  if (customersError) {
    throw new AppError("INTERNAL_ERROR", "Could not load your orders. Please try again.", 500);
  }
  const customerIds = (customers ?? []).map((c) => c.id);

  let orders: MyOrderRow[] = [];
  if (customerIds.length > 0) {
    const { data, error } = (await admin
      .from("orders")
      .select(
        "id,order_number,created_at,total_amount,payment_status," +
          "order_status,delivery_pincode,delivery_partner_name",
      )
      .in("customer_id", customerIds)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT)) as unknown as {
      data: MyOrderRow[] | null;
      error: unknown;
    };
    if (error) {
      throw new AppError("INTERNAL_ERROR", "Could not load your orders. Please try again.", 500);
    }
    orders = data ?? [];
  }

  const res = ok({
    orders: orders.map((o) => ({
      orderId: o.id,
      orderNumber: o.order_number,
      createdAt: o.created_at,
      totalPaise: toPaise(o.total_amount),
      paymentStatus: o.payment_status,
      orderStatus: o.order_status,
      deliveryPincode: o.delivery_pincode,
      deliveryPartnerName: o.delivery_partner_name,
    })),
  });
  // One HttpOnly cookie per listed order (each order has its own
  // cookie name). Raw tokens exist only inside these headers.
  for (const order of orders) {
    const issued = await issueGuestToken(order.id, "my-orders", admin);
    if (issued) res.headers.append("Set-Cookie", issued.cookie);
  }
  return res;
});

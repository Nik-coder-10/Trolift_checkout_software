import { withErrorHandling } from "@/lib/api/handler";
import { AppError } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { resolveCoupon } from "@/lib/coupons/resolve";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { isValidIndianPhone, normalizePhone } from "@/lib/validations/common";

/**
 * POST /api/coupons/validate — { code, phone? } → discount preview.
 *
 * Checkout calls this when the buyer presses Apply so the summary can
 * show the struck-through total. It is advisory only: POST /api/orders
 * runs resolveCoupon again with the order's own phone number and
 * total, so nothing here can move money on its own.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("coupon", await checkRateLimit(req, "coupon"));
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

  const rawPhone = String(record["phone"] ?? "");
  const phone = isValidIndianPhone(rawPhone) ? normalizePhone(rawPhone) : null;

  const coupon = await resolveCoupon({
    code: String(record["code"] ?? ""),
    phone,
  });
  return ok(coupon);
});

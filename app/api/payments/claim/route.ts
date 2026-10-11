import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { authorizeGuestRequest } from "@/lib/guest-access/guard";
import { submitPaymentClaim } from "@/lib/payments/submit";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/payments/claim — { orderId, reference, phone } → SUBMITTED.
 *
 * Dual authorization (both required, neither weakened):
 *  1. The HttpOnly guest token for THIS order (cookie or `accessToken`
 *     body field for non-cookie clients), and
 *  2. the existing phone-match against the order's customer.
 * Accepts NO amount — the authoritative total stays server-side.
 * Never marks anything paid; only pending/failed payments in
 * payable order states may transition. Failures are generic (404)
 * so arbitrary order UUIDs are not confirmed to exist.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("claim", await checkRateLimit(req, "claim"));
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
  const orderId = String(record["orderId"] ?? "");
  const reference = String(record["reference"] ?? "");
  const phone = String(record["phone"] ?? "");
  const accessToken =
    typeof record["accessToken"] === "string"
      ? (record["accessToken"] as string)
      : null;
  if (!UUID_RE.test(orderId)) {
    return badRequest("A valid order is required.");
  }
  if (reference.trim() === "") {
    return badRequest("Payment reference is required.");
  }
  if (phone.trim() === "") {
    return badRequest("The mobile number from the order is required.");
  }
  const authorized = await authorizeGuestRequest(orderId, req, accessToken);
  if (!authorized) {
    throw new AppError("NOT_FOUND", "Order not found.", 404);
  }
  const result = await submitPaymentClaim({ orderId, reference, phone });
  return ok(result);
});

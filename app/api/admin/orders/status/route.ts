import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { transitionOrderStatus } from "@/lib/admin/orders";
import { ORDER_TRANSITIONS } from "@/lib/orders/transitions";
import type { OrderStatus } from "@/types";

/**
 * Accepted targets come from the transition map itself — the same
 * source the admin UI renders buttons from. A hand-maintained copy
 * silently drifted once already: the UI offered "Move to Ready for
 * dispatch" (a legal packed → ready_for_dispatch step) while this list
 * rejected it as an unknown status.
 */
const STATUSES: ReadonlyArray<OrderStatus> = Object.keys(
  ORDER_TRANSITIONS,
) as OrderStatus[];

/**
 * POST /api/admin/orders/status — move an order through valid
 * transitions only. Body: { orderId, toStatus }. No totals, no
 * prices, no payment flags accepted.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
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
  const toStatus = String(record["toStatus"] ?? "") as OrderStatus;
  if (orderId === "") {
    return badRequest("An order is required.");
  }
  if (!STATUSES.includes(toStatus)) {
    return badRequest("Unknown target status.");
  }
  const result = await transitionOrderStatus(orderId, toStatus);
  return ok(result);
});

import { revalidatePath } from "next/cache";
import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { markFulfillmentStep } from "@/lib/admin/orders";

const STEPS = ["packed", "ready_for_dispatch"] as const;

/**
 * POST /api/admin/orders/fulfillment — record a packing milestone.
 * Body: { orderId, step: "packed" | "ready_for_dispatch" }.
 *
 * Milestones never move order_status (the state machine is untouched):
 * they append PACKED / READY_FOR_DISPATCH audit events in strict order
 * (packed first, each at most once) while the order is confirmed or
 * processing. No event type is client-selectable beyond this closed
 * two-value step enum.
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
  const step = String(record["step"] ?? "");
  if (orderId === "") {
    return badRequest("An order is required.");
  }
  if (!(STEPS as readonly string[]).includes(step)) {
    return badRequest("Unknown fulfilment step.");
  }
  const result = await markFulfillmentStep(
    orderId,
    step as (typeof STEPS)[number],
  );
  revalidatePath(`/admin/orders/${orderId}`);
  return ok(result);
});

import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { verifyPaymentClaim } from "@/lib/admin/orders";

/**
 * POST /api/admin/payments/verify — approve or reject a payment claim.
 * Body: { orderId, decision: "approve" | "reject", note? }.
 * Customer money/statuses are never accepted; transitions are guarded.
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
  const decision = String(record["decision"] ?? "");
  const note = String(record["note"] ?? "");
  if (orderId === "") {
    return badRequest("An order is required.");
  }
  if (decision !== "approve" && decision !== "reject") {
    return badRequest("Decision must be approve or reject.");
  }
  const result = await verifyPaymentClaim(
    orderId,
    decision,
    note === "" ? undefined : note,
  );
  return ok(result);
});

import { ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import {
  guestTokenFromRequest,
  rotateGuestToken,
} from "@/lib/guest-access/guard";

/**
 * POST /api/orders/[id]/rotate — safe token rotation.
 *
 * The currently-valid token (cookie) is required; all older tokens for
 * the order are revoked and exactly one replacement is issued + set as
 * the cookie. The raw replacement is also returned ONCE in the JSON
 * body for clients that need it (never logged, never stored client-side
 * long-term). Failures are generic 404s.
 */
export const POST = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const denied = await denyIfLimited(
    "session",
    await checkRateLimit(req, "session", { dims: { resourceId: id } }),
  );
  if (denied) return denied;
  const current = guestTokenFromRequest(id, req);
  if (!current) {
    throw new AppError("NOT_FOUND", "Order not found.", 404);
  }
  const issued = await rotateGuestToken(id, current);
  if (!issued) {
    throw new AppError("NOT_FOUND", "Order not found.", 404);
  }
  const res = ok({ expiresAt: issued.expiresAt, token: issued.token });
  res.headers.append("Set-Cookie", issued.cookie);
  return res;
});

import { withErrorHandling } from "@/lib/api/handler";
import { notFound, ok } from "@/lib/api/response";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { verifyGuestToken } from "@/lib/guest-access/guard";
import { GUEST_TOKEN_RE, serializeGuestCookie } from "@/lib/guest-access/tokens";

/**
 * POST /api/orders/[id]/session — exchange a one-time `?key=` bearer
 * for the HttpOnly guest cookie.
 *
 * Rate-limited under the dedicated "session" bucket keyed by IP AND
 * order (hash), so token-guessing against one order cannot borrow
 * budget from another. Failures are generic 404s (no oracle).
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
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    body = {};
  }
  const token =
    typeof body === "object" && body !== null
      ? String((body as Record<string, unknown>)["token"] ?? "")
      : "";
  if (!GUEST_TOKEN_RE.test(token)) return notFound("Session not found.");
  const valid = await verifyGuestToken(id, token);
  if (!valid) return notFound("Session not found.");
  const res = ok({ established: true });
  res.headers.append(
    "Set-Cookie",
    serializeGuestCookie(id, token, 90 * 24 * 60 * 60),
  );
  return res;
});

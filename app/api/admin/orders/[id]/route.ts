import { notFound, ok } from "@/lib/api/response";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { getAdminOrderDetail } from "@/lib/admin/orders";

/** GET /api/admin/orders/[id] — full order detail (admins only). */
export const GET = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const { id } = await params;
  const detail = await getAdminOrderDetail(id);
  if (!detail) return notFound("Order not found.");
  return ok(detail);
});

import { notFound, ok } from "@/lib/api/response";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { deleteOrder, getAdminOrderDetail } from "@/lib/admin/orders";
import { revalidatePath } from "next/cache";

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

/** DELETE /api/admin/orders/[id] — permanently remove an order and its dependents. */
export const DELETE = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const { id } = await params;
  const result = await deleteOrder(id);
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  return ok(result);
});

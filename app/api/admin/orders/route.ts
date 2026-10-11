import { ok } from "@/lib/api/response";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { listAdminOrders, parseAdminOrderQuery } from "@/lib/admin/orders";

/** GET /api/admin/orders — paginated, filtered order list (admins only). */
export const GET = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const url = new URL(req.url);
  const params: Record<string, string | string[] | undefined> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  const result = await listAdminOrders(parseAdminOrderQuery(params));
  return ok(result);
});

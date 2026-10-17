import { revalidatePath } from "next/cache";
import { ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { updateCoupon, validateCouponInput } from "@/lib/admin/coupons";

/** PATCH /api/admin/coupons/[id] — full update of one redeem code. */
export const PATCH = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const { id } = await params;
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  await updateCoupon(id, validateCouponInput(body));
  revalidatePath("/admin/coupons");
  return ok({ id });
});

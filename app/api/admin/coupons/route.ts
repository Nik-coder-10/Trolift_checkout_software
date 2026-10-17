import { revalidatePath } from "next/cache";
import { ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { createCoupon, listCoupons, validateCouponInput } from "@/lib/admin/coupons";

/** GET /api/admin/coupons — all redeem codes, newest change first. */
export const GET = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  return ok(await listCoupons());
});

/** POST /api/admin/coupons — create a redeem code (whitelisted fields). */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  const id = await createCoupon(validateCouponInput(body));
  revalidatePath("/admin/coupons");
  return ok({ id }, { status: 201 });
});

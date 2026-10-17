import { revalidatePath } from "next/cache";
import { ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { setAdminProductStock } from "@/lib/admin/products";

/**
 * PATCH /api/admin/products/[id]/stock — quick stock edit from the
 * admin list (absolute value, audit-logged as an adjusted event).
 */
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
  const stockQuantity =
    typeof body === "object" && body !== null
      ? (body as { stockQuantity?: unknown }).stockQuantity
      : undefined;
  if (
    typeof stockQuantity !== "number" ||
    !Number.isInteger(stockQuantity) ||
    stockQuantity < 0 ||
    stockQuantity > 1_000_000
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Stock quantity must be a whole number between 0 and 1000000.",
      422,
    );
  }
  await setAdminProductStock(id, stockQuantity);
  // Availability changed: storefront, homepage and the admin list all
  // show reserve-aware stock. Detail pages are dynamic.
  revalidatePath("/products");
  revalidatePath("/");
  revalidatePath("/admin/products");
  return ok({ id, stockQuantity });
});

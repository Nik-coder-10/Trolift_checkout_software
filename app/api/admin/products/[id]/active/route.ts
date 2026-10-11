import { revalidatePath } from "next/cache";
import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { setProductActive } from "@/lib/admin/products";

/**
 * POST /api/admin/products/[id]/active — deactivate/reactivate.
 * Body: { isActive: boolean }. Products are never hard-deleted, so
 * historical orders keep their snapshots and FK integrity.
 */
export const POST = withErrorHandling(async (
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
  const isActive =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)["isActive"]
      : undefined;
  if (typeof isActive !== "boolean") {
    return badRequest("isActive must be true or false.");
  }
  await setProductActive(id, isActive);
  revalidatePath("/products");
  revalidatePath("/");
  return ok({ id, isActive });
});

import { revalidatePath } from "next/cache";
import { badRequest, notFound, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { getAdminProduct, updateAdminProduct } from "@/lib/admin/products";
import { coerceProductInput } from "@/app/api/admin/products/route";

/** GET /api/admin/products/[id] — one product with specs (admins only). */
export const GET = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const { id } = await params;
  const product = await getAdminProduct(id);
  if (!product) return notFound("Product not found.");
  return ok(product);
});

/** PATCH /api/admin/products/[id] — full update (admins only). */
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
  if (typeof body !== "object" || body === null) {
    return badRequest("Product details are required.");
  }
  await updateAdminProduct(id, coerceProductInput(body));
  // Listing + homepage refresh immediately. Prerendered detail pages
  // for existing slugs refresh on next build; unknown slugs 404 until
  // then (documented catalogue limitation).
  revalidatePath("/products");
  revalidatePath("/");
  return ok({ id });
});

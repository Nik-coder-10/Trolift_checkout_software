import { revalidatePath } from "next/cache";
import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import {
  createAdminProduct,
  listAdminProducts,
  parseAdminProductQuery,
} from "@/lib/admin/products";
import type { ProductFormInput } from "@/lib/admin/product-validation";

/** GET /api/admin/products — paginated admin list (admins only). */
export const GET = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const url = new URL(req.url);
  const params: Record<string, string | string[] | undefined> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  const result = await listAdminProducts(parseAdminProductQuery(params));
  return ok(result);
});

/**
 * POST /api/admin/products — create (admins only). Body carries the
 * ProductFormInput shape; money arrives as a rupees decimal string and
 * converts to integer paise server-side.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  if (typeof body !== "object" || body === null) {
    return badRequest("Product details are required.");
  }
  const id = await createAdminProduct(coerceProductInput(body));
  revalidatePath("/products");
  revalidatePath("/");
  return ok({ id }, { status: 201 });
});

/** Whitelist the editable fields — nothing else reaches the database. */
export function coerceProductInput(body: unknown): ProductFormInput {
  const r = body as Record<string, unknown>;
  const images = Array.isArray(r["images"])
    ? (r["images"] as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const stock = r["stockQuantity"];
  return {
    name: String(r["name"] ?? ""),
    slug: String(r["slug"] ?? ""),
    description: String(r["description"] ?? ""),
    priceRupees: String(r["priceRupees"] ?? ""),
    category: String(r["category"] ?? ""),
    images,
    specificationsJson: String(r["specificationsJson"] ?? ""),
    stockQuantity: typeof stock === "number" ? stock : Number(stock ?? NaN),
    lowStockThreshold:
      typeof r["lowStockThreshold"] === "number"
        ? r["lowStockThreshold"]
        : Number(r["lowStockThreshold"] ?? NaN),
    isActive: r["isActive"] !== false,
    gstRate: String(r["gstRate"] ?? ""),
    weightKg: String(r["weightKg"] ?? ""),
  };
}

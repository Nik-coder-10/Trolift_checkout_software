import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { AppError } from "@/lib/api/errors";
import { resolveProductImage } from "@/lib/storage/images";
import {
  paiseToDecimal,
  validateProductInput,
  type ProductFormInput,
} from "@/lib/admin/product-validation";
import {
  fetchAvailability,
  stockStatus,
  type StockStatus,
} from "@/lib/inventory/availability";
import type { ProductRow } from "@/types/database";

/**
 * Admin product management (server-only, admins only).
 *
 * Reads/writes use the RLS-respecting server client (admin policies
 * apply) after requireAdmin(). Price/rate changes touch ONLY the live
 * products row — historical orders keep their snapshots by architecture
 * (items are never updated), and deactivation (never deletion) keeps FK
 * history intact via ON DELETE RESTRICT.
 */

export type AdminProductSort = "newest" | "oldest" | "price_desc" | "price_asc" | "name_asc";

export interface AdminProductQuery {
  q?: string;
  category?: string;
  active?: boolean;
  sort: AdminProductSort;
  page: number;
  pageSize: number;
}

export const ADMIN_PRODUCT_PAGE_SIZE = 15;

export function parseAdminProductQuery(
  sp: Record<string, string | string[] | undefined>,
): AdminProductQuery {
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const q = first(sp["q"]).slice(0, 100);
  const category = first(sp["category"]);
  const activeRaw = first(sp["active"]);
  const sortRaw = first(sp["sort"]);
  const page = Number(first(sp["page"]));
  return {
    ...(q === "" ? {} : { q }),
    ...(category === "" ? {} : { category }),
    ...(activeRaw === "true"
      ? { active: true as const }
      : activeRaw === "false"
        ? { active: false as const }
        : {}),
    sort:
      sortRaw === "oldest" || sortRaw === "price_desc" ||
      sortRaw === "price_asc" || sortRaw === "name_asc"
        ? sortRaw
        : "newest",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: ADMIN_PRODUCT_PAGE_SIZE,
  };
}

export interface AdminProductListItem {
  id: string;
  name: string;
  slug: string;
  category: string;
  pricePaise: number;
  stockQuantity: number;
  lowStockThreshold: number;
  /** Reserve-aware units available (on-hand minus live holds). */
  available: number;
  availability: StockStatus;
  imageCount: number;
  firstImage: string;
  isActive: boolean;
  createdAt: string;
}

const LIST_COLUMNS =
  "id,name,slug,category,price,stock_quantity,low_stock_threshold," +
  "images,is_active,created_at";

type AdminClient = Awaited<ReturnType<typeof createClient>>;

export async function listAdminProducts(query: AdminProductQuery): Promise<{
  products: AdminProductListItem[];
  total: number;
  page: number;
  totalPages: number;
}> {
  await requireAdmin();
  const client = await createClient();
  let builder = client.from("products").select(LIST_COLUMNS, { count: "exact" });
  if (query.q) {
    const pattern = `%${query.q.replace(/[%_\\]/g, "")}%`;
    builder = builder.or(`name.ilike.${pattern},slug.ilike.${pattern},category.ilike.${pattern}`);
  }
  if (query.category) builder = builder.eq("category", query.category);
  if (query.active !== undefined) builder = builder.eq("is_active", query.active);
  switch (query.sort) {
    case "oldest":
      builder = builder.order("created_at", { ascending: true });
      break;
    case "price_desc":
      builder = builder.order("price", { ascending: false });
      break;
    case "price_asc":
      builder = builder.order("price", { ascending: true });
      break;
    case "name_asc":
      builder = builder.order("name", { ascending: true });
      break;
    case "newest":
    default:
      builder = builder.order("created_at", { ascending: false });
      break;
  }
  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load products.", 500);
  }
  const rows = (data ?? []) as unknown as Array<
    Pick<ProductRow, "id" | "name" | "slug" | "category" | "price" | "stock_quantity" | "low_stock_threshold" | "is_active" | "created_at"> & {
      images: string[];
    }
  >;
  const availability = await fetchAvailability(
    client,
    rows.map((r) => r.id),
  );
  const total = count ?? 0;
  return {
    products: rows.map((r) => {
      const a = availability?.get(r.id);
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        category: r.category,
        pricePaise: Math.round(Number(r.price) * 100),
        stockQuantity: r.stock_quantity,
        lowStockThreshold: r.low_stock_threshold,
        available: a?.available ?? r.stock_quantity,
        availability:
          a?.status ?? stockStatus(r.stock_quantity, r.low_stock_threshold),
        imageCount: r.images.length,
        firstImage: resolveProductImage(r.images),
        isActive: r.is_active,
        createdAt: r.created_at,
      };
    }),
    total,
    page: query.page,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  };
}

/**
 * Restock radar: every product that is out of stock or at/below its
 * threshold, with reserve-aware availability. The catalogue is small
 * (single-digit products), so one narrow pull is cheaper and more
 * honest than paginated SQL filters over computed availability.
 */
export async function listInventoryAlerts(): Promise<{
  outOfStock: AdminProductListItem[];
  lowStock: AdminProductListItem[];
}> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("products")
    .select(
      "id,name,slug,category,price,stock_quantity,low_stock_threshold," +
        "images,is_active,created_at",
    )
    .order("stock_quantity", { ascending: true });
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load inventory.", 500);
  }
  const rows = (data ?? []) as unknown as Array<
    Pick<ProductRow, "id" | "name" | "slug" | "category" | "price" | "stock_quantity" | "low_stock_threshold" | "is_active" | "created_at"> & {
      images: string[];
    }
  >;
  const availability = await fetchAvailability(
    client,
    rows.map((r) => r.id),
  );
  const items: AdminProductListItem[] = rows.map((r) => {
    const a = availability?.get(r.id);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      category: r.category,
      pricePaise: Math.round(Number(r.price) * 100),
      stockQuantity: r.stock_quantity,
      lowStockThreshold: r.low_stock_threshold,
      available: a?.available ?? r.stock_quantity,
      availability:
        a?.status ?? stockStatus(r.stock_quantity, r.low_stock_threshold),
      imageCount: r.images.length,
      firstImage: resolveProductImage(r.images),
      isActive: r.is_active,
      createdAt: r.created_at,
    };
  });
  return {
    outOfStock: items.filter((p) => p.availability === "out_of_stock"),
    lowStock: items.filter((p) => p.availability === "low_stock"),
  };
}

/** Distinct categories across ALL products (active + inactive, admin view). */
export async function listAdminCategories(): Promise<string[]> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client.from("products").select("category");
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load categories.", 500);
  }
  const rows = (data ?? []) as unknown as Array<{ category: string }>;
  return [...new Set(rows.map((r) => r.category))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export type AdminProductDetail = AdminProductListItem & {
  description: string;
  specifications: unknown;
  images: string[];
  updatedAt: string;
  /** NUMERIC(5,2) decimal string; NULL = GST not configured. */
  gstRate: string | null;
  /** NUMERIC(10,3) decimal string; NULL = shipping weight unknown. */
  weightKg: string | null;
  /** HSN 4/6/8 digits; NULL = not configured. */
  hsnCode: string | null;
};

export async function getAdminProduct(
  productId: string,
): Promise<AdminProductDetail | null> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("products")
    .select(
      "id,name,slug,description,category,price,gst_rate,weight_kg,hsn_code,stock_quantity," +
        "low_stock_threshold,images," +
        "specifications,is_active,created_at,updated_at",
    )
    .eq("id", productId)
    .maybeSingle();
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load the product.", 500);
  }
  const r = data as unknown as (ProductRow & { images: string[] }) | null;
  if (!r) return null;
  const availability = await fetchAvailability(client, [r.id]);
  const a = availability?.get(r.id);
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    category: r.category,
    pricePaise: Math.round(Number(r.price) * 100),
    gstRate: r.gst_rate,
    weightKg: r.weight_kg,
    hsnCode: (r as unknown as { hsn_code: string | null }).hsn_code ?? null,
    stockQuantity: r.stock_quantity,
    lowStockThreshold: r.low_stock_threshold,
    available: a?.available ?? r.stock_quantity,
    availability:
      a?.status ?? stockStatus(r.stock_quantity, r.low_stock_threshold),
    images: r.images,
    firstImage: resolveProductImage(r.images),
    imageCount: r.images.length,
    isActive: r.is_active,
    createdAt: r.created_at,
    specifications: r.specifications,
    updatedAt: r.updated_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

async function writeProduct(
  client: AdminClient,
  input: ProductFormInput,
  productId?: string,
): Promise<string> {
  const { errors, value } = validateProductInput(input);
  if (!value) {
    throw new AppError("VALIDATION_ERROR", "Product details are invalid.", 422, errors);
  }
  const row = {
    name: value.name,
    slug: value.slug,
    description: value.description,
    category: value.category,
    specifications: value.specifications,
    price: paiseToDecimal(value.pricePaise),
    gst_rate: value.gstRate,
    weight_kg: value.weightKg,
    hsn_code: value.hsnCode,
    stock_quantity: value.stockQuantity,
    low_stock_threshold: value.lowStockThreshold,
    images: value.images,
    is_active: value.isActive,
  };
  // Manual stock movements are audit-logged with signed deltas so
  // discrepancies stay debuggable. Threshold edits are policy, not
  // movement — no event.
  let previousStock: number | null = null;
  if (productId) {
    const { data: prev } = await client
      .from("products")
      .select("stock_quantity")
      .eq("id", productId)
      .maybeSingle();
    previousStock = (prev as unknown as { stock_quantity: number } | null)
      ?.stock_quantity ?? null;
  }
  if (!productId) {
    const { data, error } = await client
      .from("products")
      .insert(row)
      .select("id")
      .maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("VALIDATION_ERROR", "That slug is already in use.", 422);
      }
      throw new AppError("INTERNAL_ERROR", "Could not create the product.", 500);
    }
    const created = data as unknown as { id: string } | null;
    if (!created) throw new AppError("INTERNAL_ERROR", "Could not create the product.", 500);
    return created.id;
  }
  const { data, error } = await client
    .from("products")
    .update(row)
    .eq("id", productId)
    .select("id");
  if (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("VALIDATION_ERROR", "That slug is already in use.", 422);
    }
    throw new AppError("INTERNAL_ERROR", "Could not update the product.", 500);
  }
  const updated = (data ?? []) as unknown as Array<{ id: string }>;
  if (updated.length === 0) {
    throw new AppError("NOT_FOUND", "Product not found.", 404);
  }
  if (previousStock !== null && previousStock !== value.stockQuantity) {
    const { error: eventError } = await client.from("inventory_events").insert({
      product_id: productId,
      order_id: null,
      event: "adjusted",
      quantity: value.stockQuantity - previousStock,
      balance_after: value.stockQuantity,
      note: "manual stock adjustment",
    });
    if (eventError) {
      console.error("[admin] inventory event log failed:", eventError.message);
    }
  }
  return productId;
}

export async function createAdminProduct(input: ProductFormInput): Promise<string> {
  await requireAdmin();
  return writeProduct(await createClient(), input);
}

export async function updateAdminProduct(
  productId: string,
  input: ProductFormInput,
): Promise<string> {
  await requireAdmin();
  return writeProduct(await createClient(), input, productId);
}

/** Deactivate/reactivate. Products are never hard-deleted (FK history). */
export async function setProductActive(
  productId: string,
  isActive: boolean,
): Promise<void> {
  await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("products")
    .update({ is_active: isActive })
    .eq("id", productId)
    .select("id");
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not update the product.", 500);
  }
  if (((data ?? []) as unknown as Array<unknown>).length === 0) {
    throw new AppError("NOT_FOUND", "Product not found.", 404);
  }
}

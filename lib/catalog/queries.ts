/**
 * Server-side catalogue reads (Server Components / Route Handlers only).
 *
 * - Active products only — inactive rows never reach the UI.
 * - Minimal column sets and LIMITs; no full-table scans from the UI.
 * - Resilient: Supabase unlinked/unreachable → static dev-data fallback
 *   (mirrors seed.sql); live-but-empty → empty array so pages render
 *   their EmptyState instead of stale data.
 *
 * The Supabase client is imported dynamically so a missing/broken
 * configuration degrades to the fallback instead of crashing the page.
 * Never import this module from Client Components.
 */
import { cache } from "react";
import {
  ALL_PRODUCTS,
  FEATURED_PRODUCTS,
  PRODUCT_CATEGORIES,
  groupByCategory,
  type CatalogProduct,
  type CatalogueParams,
  type CatalogueSort,
  type ProductCategory,
} from "@/lib/catalog/products";
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  fetchAvailability,
  stockStatus,
  type StockStatus,
} from "@/lib/inventory/availability";

const PRODUCT_COLUMNS =
  "id,name,slug,description,category,specifications,price,stock_quantity," +
  "low_stock_threshold,images,is_active";
const FEATURED_LIMIT = 4;

type ServerClient = Awaited<
  ReturnType<typeof import("@/lib/supabase/server").createClient>
>;

async function getServerClient(): Promise<ServerClient | null> {
  try {
    const { createClient } = await import("@/lib/supabase/server");
    return await createClient();
  } catch {
    return null;
  }
}

function toCatalog(rows: unknown): CatalogProduct[] {
  return (rows ?? []) as unknown as CatalogProduct[];
}

/** On-hand status for static rows (offline fallback — no holds visible). */
function fallbackStatus(p: {
  stock_quantity: number;
  low_stock_threshold?: number;
}): StockStatus {
  return stockStatus(
    p.stock_quantity,
    p.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
  );
}

/**
 * Attach reserve-aware storefront status to live rows (one batched RPC).
 * Degrades to on-hand status if the RPC fails — display only; the order
 * engine re-checks authoritatively, so browsing never breaks on a
 * transient availability outage.
 */
async function withAvailability(
  supabase: NonNullable<Awaited<ReturnType<typeof getServerClient>>>,
  products: CatalogProduct[],
): Promise<CatalogProduct[]> {
  if (products.length === 0) return products;
  const map = await fetchAvailability(
    supabase,
    products.map((p) => p.id),
  );
  return products.map((p) => ({
    ...p,
    availability:
      map?.get(p.id)?.status ?? fallbackStatus(p),
  }));
}

/** Newest active products, capped (homepage featured grid). */
export async function getFeaturedProducts(): Promise<CatalogProduct[]> {
  const supabase = await getServerClient();
  if (!supabase) return FEATURED_PRODUCTS;
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(FEATURED_LIMIT);
  if (error) {
    console.error("[catalog] featured query failed:", error.message);
    return FEATURED_PRODUCTS;
  }
  const rows = toCatalog(data);
  return rows.length > 0 ? await withAvailability(supabase, rows) : [];
}

/**
 * Single active product by slug (detail page). Null when missing/inactive.
 * Cached per request: generateMetadata and the page share one query.
 */
export const getProductBySlug = cache(
  async (slug: string): Promise<CatalogProduct | null> => {
    const supabase = await getServerClient();
    if (!supabase) {
      return ALL_PRODUCTS.find((p) => p.slug === slug) ?? null;
    }
    const { data, error } = await supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    if (error) {
      console.error("[catalog] product query failed:", error.message);
      return ALL_PRODUCTS.find((p) => p.slug === slug) ?? null;
    }
    const row = (data as unknown as CatalogProduct | null) ?? null;
    if (!row) return null;
    return (await withAvailability(supabase, [row]))[0] ?? row;
  },
);

/**
 * Active product slugs (detail-page generateStaticParams).
 * Build-time safe: falls back to static slugs when Supabase is
 * unlinked so `next build` never requires a live database.
 */
export async function getProductSlugs(): Promise<string[]> {
  const supabase = await getServerClient();
  if (!supabase) return ALL_PRODUCTS.map((p) => p.slug);
  const { data, error } = await supabase
    .from("products")
    .select("slug")
    .eq("is_active", true)
    .limit(10000);
  if (error) {
    console.error("[catalog] slugs query failed:", error.message);
    return ALL_PRODUCTS.map((p) => p.slug);
  }
  const rows = (data ?? []) as unknown as Array<{ slug: string }>;
  return rows.map((r) => r.slug);
}

export interface CatalogueResult {
  products: CatalogProduct[];
  categories: ProductCategory[];
  /** Resolved category, or null for "All". */
  activeCategory: ProductCategory | null;
  /** True when ?category= matches nothing (renders empty state). */
  unknownCategory: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** False when served from the static dev-data fallback. */
  live: boolean;
}

function paginate(
  all: CatalogProduct[],
  page: number,
  pageSize: number,
): { products: CatalogProduct[]; total: number; totalPages: number } {
  const total = all.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  return {
    products: all.slice(start, start + pageSize),
    total,
    totalPages,
  };
}

/**
 * Related products: same category, active only, excluding the current
 * product (limit 4). Static fallback offline; [] when nothing qualifies.
 */
export async function getRelatedProducts(
  category: string,
  excludeId: string,
  limit = 4,
): Promise<CatalogProduct[]> {
  const pick = (pool: CatalogProduct[]) =>
    pool.filter((p) => p.category === category && p.id !== excludeId).slice(0, limit);
  const supabase = await getServerClient();
  if (!supabase) return pick(ALL_PRODUCTS.filter((p) => p.is_active));
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("is_active", true)
    .eq("category", category)
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[catalog] related query failed:", error.message);
    return pick(ALL_PRODUCTS.filter((p) => p.is_active));
  }
  return withAvailability(supabase, toCatalog(data));
}

/**
 * Live category cards with counts; [] when the live catalogue is empty.
 *
 * Cached per request: the listing page's generateMetadata and component
 * share a single categories query instead of firing it twice. Defined
 * above its callers (const arrow functions are not hoisted).
 */
export const getCategories = cache(
  async (): Promise<ProductCategory[]> => {
    const supabase = await getServerClient();
    if (!supabase) return PRODUCT_CATEGORIES;
    const { data, error } = await supabase
      .from("products")
      .select("category")
      .eq("is_active", true)
      .limit(10000);
    if (error) {
      console.error("[catalog] categories query failed:", error.message);
      return PRODUCT_CATEGORIES;
    }
    const rows = (data ?? []) as unknown as Array<{ category: string }>;
    if (rows.length === 0) return [];
    return groupByCategory(rows);
  },
);

/**
 * Paginated, category-filtered catalogue. Two narrow queries (categories
 * for slug→name resolution, then a counted + ranged product query) —
 * never a full-table pull. Static fallback mirrors the same semantics
 * offline; unknown slugs yield an empty page, not an error.
 */
export async function getCataloguePage(
  filters: CatalogueParams,
): Promise<CatalogueResult> {
  const {
    categorySlug,
    q,
    sort = "featured",
    minPrice,
    maxPrice,
    page,
    pageSize,
  } = filters;
  const supabase = await getServerClient();
  const staticActive = ALL_PRODUCTS.filter((p) => p.is_active);

  const empty = (
    categories: ProductCategory[],
    unknownCategory: boolean,
    live: boolean,
  ): CatalogueResult => ({
    products: [],
    categories,
    activeCategory: null,
    unknownCategory,
    total: 0,
    page,
    pageSize,
    totalPages: 0,
    live,
  });

  // 1. Categories (slug→name resolution). Shared with generateMetadata
  // through the cached getCategories(): one query per request.
  // Offline → static dev data; live error → static nav (logged);
  // live empty → [] (empty states).
  let categories: ProductCategory[];
  if (!supabase) {
    const grouped = groupByCategory(
      staticActive.map((p) => ({ category: p.category })),
    );
    categories = grouped.length > 0 ? grouped : PRODUCT_CATEGORIES;
  } else {
    categories = await getCategories();
  }

  // 2. Resolve ?category=. Unknown slugs yield an empty page, not an error.
  const activeCategory = categorySlug
    ? (categories.find((c) => c.slug === categorySlug) ?? null)
    : null;
  if (categorySlug && !activeCategory) {
    return empty(categories, true, supabase !== null);
  }

  // 3. Products.
  const matchesPrice = (p: CatalogProduct) =>
    (minPrice === undefined || Number(p.price) >= minPrice) &&
    (maxPrice === undefined || Number(p.price) <= maxPrice);
  const matchesQuery = (p: CatalogProduct) => {
    if (!q) return true;
    const hay = `${p.name} ${p.category} ${p.description} ${p.slug}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  };
  const rankOf = (p: CatalogProduct) => {
    if (!q) return 0;
    const needle = q.toLowerCase();
    if (p.name.toLowerCase().includes(needle)) return 0;
    if (p.category.toLowerCase().includes(needle)) return 1;
    return 2;
  };
  const sortStatic = (items: CatalogProduct[]): CatalogProduct[] => {
    const arr = [...items];
    switch (sort) {
      case "price_asc":
        return arr.sort((a, b) => Number(a.price) - Number(b.price));
      case "price_desc":
        return arr.sort((a, b) => Number(b.price) - Number(a.price));
      case "name_asc":
        return arr.sort((a, b) => a.name.localeCompare(b.name));
      case "relevance":
        return arr.sort(
          (a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name),
        );
      case "featured":
      default:
        return arr;
    }
  };

  // Offline / unreachable: same semantics over static dev data.
  if (!supabase) {
    return pageOf(
      categories,
      activeCategory,
      sortStatic(
        staticActive.filter(
          (p) =>
            (!activeCategory || p.category === activeCategory.name) &&
            matchesPrice(p) &&
            matchesQuery(p),
        ),
      ),
      false,
    );
  }

  // Live search (query, price window and/or explicit relevance sort):
  // one RPC call returning the page plus the total — no full-table
  // pull, ever. Plain browsing stays on the simple ranged query.
  const needsSearch =
    Boolean(q) ||
    sort === "relevance" ||
    minPrice !== undefined ||
    maxPrice !== undefined;
  if (needsSearch) {
    const searched = await queryLiveSearch(supabase, {
      q: q ?? "",
      categoryName: activeCategory?.name ?? null,
      minPrice,
      maxPrice,
      sort: q ? sort : "relevance",
      page,
      pageSize,
    });
    if (searched) {
      return {
        products: searched.products,
        categories,
        activeCategory,
        unknownCategory: false,
        total: searched.total,
        page,
        pageSize,
        totalPages:
          searched.total === 0 ? 0 : Math.ceil(searched.total / pageSize),
        live: true,
      };
    }
    return pageOf(
      categories,
      activeCategory,
      sortStatic(
        staticActive.filter(
          (p) =>
            (!activeCategory || p.category === activeCategory.name) &&
            matchesPrice(p) &&
            matchesQuery(p),
        ),
      ),
      false,
    );
  }

  // Live browse (no query): counted + ranged query.
  const ranged = await queryLiveRange(
    supabase,
    activeCategory?.name ?? null,
    sort,
    page,
    pageSize,
  );
  if (!ranged) {
    return pageOf(
      categories,
      activeCategory,
      sortStatic(
        staticActive.filter(
          (p) =>
            (!activeCategory || p.category === activeCategory.name) &&
            matchesPrice(p),
        ),
      ),
      false,
    );
  }
  return {
    products: ranged.products,
    categories,
    activeCategory,
    unknownCategory: false,
    total: ranged.total,
    page,
    pageSize,
    totalPages: ranged.total === 0 ? 0 : Math.ceil(ranged.total / pageSize),
    live: true,
  };

  function pageOf(
    cats: ProductCategory[],
    active: ProductCategory | null,
    matching: CatalogProduct[],
    isLive: boolean,
  ): CatalogueResult {
    const { products, total, totalPages } = paginate(matching, page, pageSize);
    return {
      products,
      categories: cats,
      activeCategory: active,
      unknownCategory: false,
      total,
      page,
      pageSize,
      totalPages,
      live: isLive,
    };
  }
}

/**
 * One counted + ranged product query. Null on error (caller falls back
 * to static data); never pulls more than one page of rows.
 */
async function queryLiveRange(
  supabase: NonNullable<Awaited<ReturnType<typeof getServerClient>>>,
  categoryName: string | null,
  sort: CatalogueSort,
  page: number,
  pageSize: number,
): Promise<{ products: CatalogProduct[]; total: number } | null> {
  let query = supabase
    .from("products")
    .select(PRODUCT_COLUMNS, { count: "exact" })
    .eq("is_active", true);
  if (categoryName) query = query.eq("category", categoryName);
  switch (sort) {
    case "price_asc":
      query = query.order("price", { ascending: true });
      break;
    case "price_desc":
      query = query.order("price", { ascending: false });
      break;
    case "name_asc":
      query = query.order("name", { ascending: true });
      break;
    case "featured":
    case "relevance":
    default:
      query = query.order("created_at", { ascending: false });
      break;
  }
  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) {
    console.error("[catalog] catalogue page failed:", error.message);
    return null;
  }
  return {
    products: await withAvailability(supabase, toCatalog(data)),
    total: count ?? 0,
  };
}

/**
 * Single RPC call for search / relevance / price windows. Returns the
 * page plus the total, or null on error (caller falls back).
 */
async function queryLiveSearch(
  supabase: NonNullable<Awaited<ReturnType<typeof getServerClient>>>,
  args: {
    q: string;
    categoryName: string | null;
    minPrice?: number;
    maxPrice?: number;
    sort: CatalogueSort;
    page: number;
    pageSize: number;
  },
): Promise<{ products: CatalogProduct[]; total: number } | null> {
  const { data, error } = await supabase.rpc("search_products", {
    p_query: args.q,
    p_category: args.categoryName,
    p_min_price: args.minPrice ?? null,
    p_max_price: args.maxPrice ?? null,
    p_sort: args.sort,
    p_limit: args.pageSize,
    p_offset: (args.page - 1) * args.pageSize,
  });
  if (error) {
    console.error("[catalog] search RPC failed:", error.message);
    return null;
  }
  const rows = (data ?? []) as unknown as Array<
    CatalogProduct & { total_count: number | string }
  >;
  const products = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category,
    specifications: row.specifications,
    price: row.price,
    stock_quantity: row.stock_quantity,
    low_stock_threshold: row.low_stock_threshold,
    images: row.images,
    is_active: row.is_active,
    // Resolved below from reserve-aware availability.
    availability: fallbackStatus(row),
  }));
  return {
    products: await withAvailability(supabase, products),
    total: rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0,
  };
}

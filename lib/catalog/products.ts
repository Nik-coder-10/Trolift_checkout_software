/**
 * Catalogue data structures shared by the homepage and the product
 * pages. Shapes mirror public.products rows.
 *
 * Static lists below mirror supabase/seed/seed.sql and are used ONLY as
 * an offline fallback (Supabase unlinked / unreachable). Live data from
 * lib/catalog/queries.ts always wins when available — components consume
 * the same CatalogProduct type either way.
 */
import type { Json, ProductRow } from "@/types/database";
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  stockStatus,
  type StockStatus,
} from "@/lib/inventory/availability";

export type CatalogProduct = Pick<
  ProductRow,
  | "id"
  | "name"
  | "slug"
  | "description"
  | "category"
  | "specifications"
  | "price"
  | "stock_quantity"
  | "images"
  | "is_active"
> & {
  /** Reserve-aware storefront status (never an exact count). Live rows
   * carry it from product_availability(); static fallback rows compute
   * it from on-hand stock (no holds visible offline). */
  availability: StockStatus;
  /** Per-product low-stock threshold when known (live rows). */
  low_stock_threshold?: number;
};

export interface ProductCategory {
  slug: string;
  name: string;
  blurb: string;
  productCount: number;
}

const CATEGORY_BLURBS: Record<string, string> = {
  Ladders: "Telescopic, finger-protect and A-type ladders for safe height access.",
  Trolleys: "Metal and HDPE platform trolleys built for daily abuse.",
};

/** Editorial fallback when Supabase is unreachable (counts are static). */
export const PRODUCT_CATEGORIES: ProductCategory[] = [
  { slug: "ladders", name: "Ladders", blurb: CATEGORY_BLURBS["Ladders"] ?? "", productCount: 11 },
  { slug: "trolleys", name: "Trolleys", blurb: CATEGORY_BLURBS["Trolleys"] ?? "", productCount: 7 },
];

/** All seed products (dev-data fallback). Prices are NUMERIC decimal strings. */
const RAW_PRODUCTS: Array<Omit<CatalogProduct, "availability">> = [
  {
    id: "c7d8e9f0-0001-4000-8000-000000000001",
    name: "Telescopic Ladder TALT-032 (3.2 Mtr / 10.5 Ft)",
    slug: "talt-032",
    description:
      "Telescopic ladder TALT-032 — extends to 3.2 m (10.5 ft) with 11 steps at 30 cm step distance, 9 kg. Collapses for compact carry and storage.",
    category: "Ladders",
    specifications: { model: "TALT-032", ladder_type: "Telescopic", steps: 11, step_distance_cm: 30, extended_height: "3.2 Mtr (10.5 Ft)", weight_kg: 9 },
    price: "5790.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-0002-4000-8000-000000000002",
    name: "Telescopic Ladder TALT-038 (3.8 Mtr / 12.5 Ft)",
    slug: "talt-038",
    description:
      "Telescopic ladder TALT-038 — extends to 3.8 m (12.5 ft) with 13 steps at 30 cm step distance, 11 kg. Collapses for compact carry and storage.",
    category: "Ladders",
    specifications: { model: "TALT-038", ladder_type: "Telescopic", steps: 13, step_distance_cm: 30, extended_height: "3.8 Mtr (12.5 Ft)", weight_kg: 11 },
    price: "6990.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-0003-4000-8000-000000000003",
    name: "Telescopic Ladder TALT-044 (4.4 Mtr / 15 Ft)",
    slug: "talt-044",
    description:
      "Telescopic ladder TALT-044 — extends to 4.4 m (15 ft) with 15 steps at 30 cm step distance, 12.6 kg. Collapses for compact carry and storage.",
    category: "Ladders",
    specifications: { model: "TALT-044", ladder_type: "Telescopic", steps: 15, step_distance_cm: 30, extended_height: "4.4 Mtr (15 Ft)", weight_kg: 12.6 },
    price: "8090.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-0004-4000-8000-000000000004",
    name: "Telescopic Ladder TALT-055 (5.5 Mtr / 18 Ft)",
    slug: "talt-055",
    description:
      "Telescopic ladder TALT-055 — extends to 5.5 m (18 ft) with 14 steps at 40 cm step distance, 14 kg. Collapses for compact carry and storage.",
    category: "Ladders",
    specifications: { model: "TALT-055", ladder_type: "Telescopic", steps: 14, step_distance_cm: 40, extended_height: "5.5 Mtr (18 Ft)", weight_kg: 14 },
    price: "9290.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-0005-4000-8000-000000000005",
    name: "Telescopic Ladder TALT-060 (6 Mtr / 20 Ft)",
    slug: "talt-060",
    description:
      "Telescopic ladder TALT-060 — extends to 6 m (20 ft) with 15 steps at 40 cm step distance, 15.5 kg. Collapses for compact carry and storage.",
    category: "Ladders",
    specifications: { model: "TALT-060", ladder_type: "Telescopic", steps: 15, step_distance_cm: 40, extended_height: "6 Mtr (20 Ft)", weight_kg: 15.5 },
    price: "10490.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-0006-4000-8000-000000000006",
    name: "Telescopic Ladder TALT-072 (7.2 Mtr / 23.6 Ft)",
    slug: "talt-072",
    description:
      "Telescopic ladder TALT-072 — extends to 7.2 m (23.6 ft) with 16 steps at 45 cm step distance, 18.2 kg. Collapses for compact carry and storage.",
    category: "Ladders",
    specifications: { model: "TALT-072", ladder_type: "Telescopic", steps: 16, step_distance_cm: 45, extended_height: "7.2 Mtr (23.6 Ft)", weight_kg: 18.2 },
    price: "12290.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-0007-4000-8000-000000000007",
    name: "Finger-Protect Telescopic Ladder TALT-F44 (4.4 Mtr / 15 Ft)",
    slug: "talt-f44",
    description:
      "Finger-protect telescopic ladder TALT-F44 — extends to 4.4 m (15 ft) with 15 steps at 30 cm step distance, 13.8 kg. Anti-pinch finger guards on every step.",
    category: "Ladders",
    specifications: { model: "TALT-F44", ladder_type: "Telescopic (Finger protect)", steps: 15, step_distance_cm: 30, extended_height: "4.4 Mtr (15 Ft)", weight_kg: 13.8 },
    price: "8590.00",
    stock_quantity: 50,
    images: ["/images/products/talt-fp-01.png", "/images/products/talt-fp-02.png"],
    is_active: true,
  },
  {
    id: "c7d8e9f0-0008-4000-8000-000000000008",
    name: "Finger-Protect Telescopic Ladder TALT-F55 (5.5 Mtr / 18 Ft)",
    slug: "talt-f55",
    description:
      "Finger-protect telescopic ladder TALT-F55 — extends to 5.5 m (18 ft) with 15 steps at 37 cm step distance, 14.9 kg. Anti-pinch finger guards on every step.",
    category: "Ladders",
    specifications: { model: "TALT-F55", ladder_type: "Telescopic (Finger protect)", steps: 15, step_distance_cm: 37, extended_height: "5.5 Mtr (18 Ft)", weight_kg: 14.9 },
    price: "9990.00",
    stock_quantity: 50,
    images: ["/images/products/talt-fp-01.png", "/images/products/talt-fp-02.png"],
    is_active: true,
  },
  {
    id: "c7d8e9f0-0009-4000-8000-000000000009",
    name: "A-Type Ladder TALT-D44 (4.4 Mtr / 15 Ft)",
    slug: "talt-d44",
    description:
      "Double-sided A-type ladder TALT-D44 — 4.4 m (15 ft) working height, 7+7 steps at 30 cm step distance, 16 kg. Self-standing step ladder for two-sided access.",
    category: "Ladders",
    specifications: { model: "TALT-D44", ladder_type: "A-Type", steps: "7+7", step_distance_cm: 30, extended_height: "4.4 Mtr (15 Ft)", weight_kg: 16 },
    price: "9390.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-000a-4000-8000-00000000000a",
    name: "A-Type Ladder TALT-D56 (5.6 Mtr / 18.5 Ft)",
    slug: "talt-d56",
    description:
      "Double-sided A-type ladder TALT-D56 — 5.6 m (18.5 ft) working height, 9+9 steps at 30 cm step distance, 20.7 kg. Self-standing step ladder for two-sided access.",
    category: "Ladders",
    specifications: { model: "TALT-D56", ladder_type: "A-Type", steps: "9+9", step_distance_cm: 30, extended_height: "5.6 Mtr (18.5 Ft)", weight_kg: 20.7 },
    price: "12490.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-000b-4000-8000-00000000000b",
    name: "A-Type Ladder TALT-D66 (6.6 Mtr / 22 Ft)",
    slug: "talt-d66",
    description:
      "Double-sided A-type ladder TALT-D66 — 6.6 m (22 ft) working height, 8+8 steps at 40 cm step distance, 21.2 kg. Self-standing step ladder for two-sided access.",
    category: "Ladders",
    specifications: { model: "TALT-D66", ladder_type: "A-Type", steps: "8+8", step_distance_cm: 40, extended_height: "6.6 Mtr (22 Ft)", weight_kg: 21.2 },
    price: "13990.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-000c-4000-8000-00000000000c",
    name: "Metal Platform Trolley TMST-150 (150 Kg)",
    slug: "tmst-150",
    description:
      "Metal platform trolley TMST-150 — 150 kg capacity, 48*72 platform, 8.0 kg net weight. MS platform with TPR wheels.",
    category: "Trolleys",
    specifications: { model: "TMST-150", capacity_kg: 150, platform_size: "48*72", net_weight_kg: 8.0, material: "MS Platform with TPR" },
    price: "2999.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-000d-4000-8000-00000000000d",
    name: "Metal Platform Trolley TMST-300 (300 Kg)",
    slug: "tmst-300",
    description:
      "Metal platform trolley TMST-300 — 300 kg capacity, 61*91 platform, 13.0 kg net weight. MS platform with TPR wheels.",
    category: "Trolleys",
    specifications: { model: "TMST-300", capacity_kg: 300, platform_size: "61*91", net_weight_kg: 13.0, material: "MS Platform with TPR" },
    price: "3859.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-000e-4000-8000-00000000000e",
    name: "Metal Platform Trolley TMST-400 (400 Kg)",
    slug: "tmst-400",
    description:
      "Metal platform trolley TMST-400 — 400 kg capacity, 60*90 platform, 14.7 kg net weight. MS checkered platform with rubber wheels.",
    category: "Trolleys",
    specifications: { model: "TMST-400", capacity_kg: 400, platform_size: "60*90", net_weight_kg: 14.7, material: "MS checkered With Rubber Wheel" },
    price: "4999.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-000f-4000-8000-00000000000f",
    name: "Metal Platform Trolley TMST-600 (600 Kg)",
    slug: "tmst-600",
    description:
      "Metal platform trolley TMST-600 — 600 kg capacity, 65*110 platform, 21 kg net weight. MS checkered platform with rubber wheels.",
    category: "Trolleys",
    specifications: { model: "TMST-600", capacity_kg: 600, platform_size: "65*110", net_weight_kg: 21, material: "MS checkered With Rubber Wheel" },
    price: "5990.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-0010-4000-8000-000000000010",
    name: "Plastic Platform Trolley TPT-200 (200 Kg)",
    slug: "tpt-200",
    description:
      "Plastic platform trolley TPT-200 — 200 kg capacity, 48*72 platform, 10.2 kg net weight. High-grade HDPE platform trolley.",
    category: "Trolleys",
    specifications: { model: "TPT-200", capacity_kg: 200, platform_size: "48*72", net_weight_kg: 10.2, material: "High-grade HDPE Platform trolley" },
    price: "3250.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-0011-4000-8000-000000000011",
    name: "Plastic Platform Trolley TPT-400 (400 Kg)",
    slug: "tpt-400",
    description:
      "Plastic platform trolley TPT-400 — 400 kg capacity, 60*90 platform, 13.2 kg net weight. High-grade HDPE platform trolley.",
    category: "Trolleys",
    specifications: { model: "TPT-400", capacity_kg: 400, platform_size: "60*90", net_weight_kg: 13.2, material: "High-grade HDPE Platform trolley" },
    price: "3990.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
  {
    id: "c7d8e9f0-0012-4000-8000-000000000012",
    name: "Plastic Platform Trolley TPT-600 (600 Kg)",
    slug: "tpt-600",
    description:
      "Plastic platform trolley TPT-600 — 600 kg capacity, 63*105 platform, 16.1 kg net weight. High-grade HDPE platform trolley.",
    category: "Trolleys",
    specifications: { model: "TPT-600", capacity_kg: 600, platform_size: "63*105", net_weight_kg: 16.1, material: "High-grade HDPE Platform trolley" },
    price: "5690.00",
    stock_quantity: 50,
    images: [],
    is_active: true,
  },
];

/**
 * Static rows with storefront availability resolved from on-hand stock
 * (no reservation holds are visible offline — the live path in
 * queries.ts always wins when Supabase is reachable).
 */
export const ALL_PRODUCTS: CatalogProduct[] = RAW_PRODUCTS.map((p) => ({
  ...p,
  availability: stockStatus(
    p.stock_quantity,
    p.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
  ),
}));

const FEATURED_IDS = new Set([
  "c7d8e9f0-0003-4000-8000-000000000003",
  "c7d8e9f0-000a-4000-8000-00000000000a",
  "c7d8e9f0-000d-4000-8000-00000000000d",
  "c7d8e9f0-0011-4000-8000-000000000011",
]);

/** Homepage picks (dev-data fallback). */
export const FEATURED_PRODUCTS: CatalogProduct[] = ALL_PRODUCTS.filter((p) =>
  FEATURED_IDS.has(p.id),
);

export function slugifyCategory(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Groups category rows into display cards with live counts.
 * Pure — unit-tested, reused by getCategories() and fallbacks.
 */
export function groupByCategory(
  rows: Array<{ category: string }>,
): ProductCategory[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, productCount]) => ({
      slug: slugifyCategory(name),
      name,
      blurb:
        CATEGORY_BLURBS[name] ??
        `Industrial ${name.toLowerCase()} for plants and warehouses.`,
      productCount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** NUMERIC decimal string → integer paise (≤2dp, so exact). */
export function priceToPaise(price: string): number {
  return Math.round(Number(price) * 100);
}

export interface SpecEntry {
  label: string;
  value: string;
}

/**
 * Structured specifications → display rows. Top-level entries only;
 * nested objects render as compact JSON (never raw dumps in the UI).
 * Pure — unit-tested.
 */
export function formatSpecEntries(specs: Json): SpecEntry[] {
  if (specs === null || typeof specs !== "object" || Array.isArray(specs)) {
    return [];
  }
  return Object.entries(specs).map(([key, value]) => ({
    label: key.replace(/_/g, " "),
    value:
      typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value),
  }));
}

export const CATALOGUE_DEFAULT_PAGE_SIZE = 12;
export const CATALOGUE_MAX_PAGE_SIZE = 48;

export type CatalogueSort =
  | "relevance"
  | "featured"
  | "price_asc"
  | "price_desc"
  | "name_asc";

export const SORT_OPTIONS: ReadonlyArray<{ value: CatalogueSort; label: string }> = [
  { value: "relevance", label: "Best match" },
  { value: "featured", label: "Featured" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "name_asc", label: "Name: A to Z" },
];

const SORT_VALUES: ReadonlySet<string> = new Set(
  SORT_OPTIONS.map((o) => o.value),
);

export function isCatalogueSort(v: string): v is CatalogueSort {
  return SORT_VALUES.has(v);
}

export interface CatalogueParams {
  /** Category slug from the URL (validated against live categories). */
  categorySlug?: string;
  /** Search text (max 100 chars, trimmed). */
  q?: string;
  /** Defaults to "featured" (newest first). */
  sort?: CatalogueSort;
  /** Rupee bounds (undefined = unbounded). */
  minPrice?: number;
  maxPrice?: number;
  /** Set when both bounds are valid but min > max (range ignored). */
  priceError?: string;
  page: number;
  pageSize: number;
}

/**
 * Parses listing URL params defensively. Pure — unit-tested.
 * Unknown/blank category passes through; the query layer resolves it
 * against live categories (unknown → empty result, not an error).
 * Search (`q`) slots in here in the next phase without touching callers.
 */
export function parseCatalogueParams(
  searchParams: Record<string, string | string[] | undefined>,
): CatalogueParams {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const rawCategory = (first(searchParams["category"]) ?? "").trim();
  const rawQ = (first(searchParams["q"]) ?? "").trim().slice(0, 100);
  const rawSort = (first(searchParams["sort"]) ?? "").trim();
  const rawPage = Number(first(searchParams["page"]));
  const rawSize = Number(first(searchParams["pageSize"]));
  const rawMin = Number(first(searchParams["min"]));
  const rawMax = Number(first(searchParams["max"]));

  const page =
    Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const size = Number.isInteger(rawSize) ? rawSize : CATALOGUE_DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(
    CATALOGUE_MAX_PAGE_SIZE,
    Math.max(1, size),
  );
  const minPrice =
    Number.isFinite(rawMin) && rawMin >= 0 ? rawMin : undefined;
  const maxPrice =
    Number.isFinite(rawMax) && rawMax >= 0 ? rawMax : undefined;
  const priceError =
    minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice
      ? "Minimum price is higher than maximum price — the price filter was ignored."
      : undefined;
  const sort: CatalogueSort = isCatalogueSort(rawSort)
    ? rawSort
    : rawQ === ""
      ? "featured"
      : "relevance";

  return {
    ...(rawCategory === "" ? {} : { categorySlug: rawCategory }),
    ...(rawQ === "" ? {} : { q: rawQ }),
    sort,
    ...(minPrice === undefined || priceError ? {} : { minPrice }),
    ...(maxPrice === undefined || priceError ? {} : { maxPrice }),
    ...(priceError ? { priceError } : {}),
    page,
    pageSize,
  };
}

/** Canonical listing URL for a filter set (defaults omitted). */
export function buildCatalogueHref(args: {
  categorySlug?: string;
  q?: string;
  sort?: CatalogueSort;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
}): string {
  const params = new URLSearchParams();
  if (args.q) params.set("q", args.q);
  if (args.categorySlug) params.set("category", args.categorySlug);
  if (args.sort && args.sort !== "featured" && !(args.sort === "relevance" && !args.q)) {
    params.set("sort", args.sort);
  }
  if (args.minPrice !== undefined) params.set("min", String(args.minPrice));
  if (args.maxPrice !== undefined) params.set("max", String(args.maxPrice));
  if (args.page !== undefined && args.page > 1) params.set("page", String(args.page));
  const qs = params.toString();
  return qs === "" ? "/products" : `/products?${qs}`;
}

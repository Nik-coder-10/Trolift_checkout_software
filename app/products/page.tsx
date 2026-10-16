import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/States";
import { CategoryFilter } from "@/components/products/CategoryFilter";
import { FilterBar } from "@/components/products/FilterBar";
import { Pagination } from "@/components/products/Pagination";
import { ProductGrid } from "@/components/products/ProductGrid";
import { getCataloguePage } from "@/lib/catalog/queries";
import {
  buildCatalogueHref,
  parseCatalogueParams,
} from "@/lib/catalog/products";

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const params = parseCatalogueParams(await searchParams);
  // Category name only — use the cached getCategories() which is shared
  // with the page component through React's cache layer.
  const { getCategories } = await import("@/lib/catalog/queries");
  const categories = await getCategories();
  const active = params.categorySlug
    ? (categories.find((c) => c.slug === params.categorySlug)?.name ?? null)
    : null;
  const bits = [
    active ? ` — ${active}` : "",
    params.q ? ` — “${params.q}”` : "",
  ].join("");
  return {
    title: `Products${bits}`,
    description:
      `Browse Trolift industrial equipment${active ? ` — ${active}` : ""}` +
      `${params.q ? ` matching “${params.q}”` : ""} with transparent, all-inclusive ` +
      `pricing, stock availability and GST invoicing.`,
    // Canonical drops the page cursor (page 1 is the canonical view);
    // filter combinations keep their own canonical for shareability.
    alternates: {
      canonical: buildCatalogueHref({
        ...(params.categorySlug ? { categorySlug: params.categorySlug } : {}),
        ...(params.q ? { q: params.q } : {}),
        ...(params.sort && params.sort !== "featured" ? { sort: params.sort } : {}),
        ...(params.minPrice !== undefined ? { minPrice: params.minPrice } : {}),
        ...(params.maxPrice !== undefined ? { maxPrice: params.maxPrice } : {}),
      }),
    },
  };
}

/**
 * Public catalogue: search + category + price + sort, all in the URL.
 * Server-rendered grid; the FilterBar is the only client island.
 * Loading/empty/error states via loading.tsx / EmptyState / error.tsx.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = parseCatalogueParams(await searchParams);
  const result = await getCataloguePage(params);
  const heading = result.activeCategory
    ? result.activeCategory.name
    : params.q
      ? `Results for “${params.q}”`
      : "All products";

  const query = {
    ...(params.q ? { q: params.q } : {}),
    sort: params.sort,
    ...(params.minPrice !== undefined ? { minPrice: params.minPrice } : {}),
    ...(params.maxPrice !== undefined ? { maxPrice: params.maxPrice } : {}),
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <Breadcrumbs
        items={
          result.activeCategory
            ? [
                { label: "Home", href: "/" },
                { label: "Products", href: "/products" },
                { label: result.activeCategory.name },
              ]
            : [{ label: "Home", href: "/" }, { label: "Products" }]
        }
      />
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-brand-700 uppercase">
            Catalogue
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
            {heading}
          </h1>
          <p role="status" className="mt-1 text-sm text-zinc-600">
            {result.unknownCategory
              ? "Unknown category."
              : result.total === 0
                ? "No products match these filters."
                : `${result.total} ${result.total === 1 ? "product" : "products"} · prices incl. GST & delivery`}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <FilterBar
          key={JSON.stringify({
            sort: params.sort ?? "featured",
            min: params.minPrice ?? null,
            max: params.maxPrice ?? null,
            category: params.categorySlug ?? null,
          })}
          initial={{
            ...(params.q ? { q: params.q } : {}),
            sort: params.sort ?? "featured",
            ...(params.minPrice !== undefined
              ? { minPrice: params.minPrice }
              : {}),
            ...(params.maxPrice !== undefined
              ? { maxPrice: params.maxPrice }
              : {}),
            ...(params.categorySlug
              ? { categorySlug: params.categorySlug }
              : {}),
          }}
        />
      </div>

      {params.priceError ? (
        <div className="mt-4">
          <Alert tone="warning" title="Price filter ignored">
            {params.priceError}
          </Alert>
        </div>
      ) : null}

      <div className="mt-5">
        <CategoryFilter
          categories={result.categories}
          activeSlug={result.activeCategory?.slug}
          total={result.categories.reduce((n, c) => n + c.productCount, 0)}
          query={query}
        />
      </div>

      <div className="mt-6">
        {result.unknownCategory ? (
          <EmptyState
            title="Unknown category"
            message="That category does not exist. Browse all products instead."
          />
        ) : result.products.length === 0 ? (
          <EmptyState
            title={
              result.page > 1
                ? "No products on this page"
                : params.q || params.categorySlug || params.minPrice !== undefined || params.maxPrice !== undefined
                  ? "No products match"
                  : "No products available"
            }
            message={
              result.page > 1
                ? "Try an earlier page, or contact sales for availability."
                : params.q || params.categorySlug || params.minPrice !== undefined || params.maxPrice !== undefined
                  ? "Try different keywords, a wider price range, or clear the filters."
                  : "Our catalogue is being stocked. Contact sales for current availability and quotes."
            }
          />
        ) : (
          <ProductGrid products={result.products} />
        )}
      </div>

      {(result.unknownCategory || result.products.length === 0) &&
      (params.q ||
        params.categorySlug ||
        params.minPrice !== undefined ||
        params.maxPrice !== undefined) ? (
        <div className="mt-4 flex justify-center">
          <Link
            href="/products"
            className="inline-flex h-11 items-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            Clear all filters
          </Link>
        </div>
      ) : null}

      {result.products.length > 0 && (
        <div className="mt-8">
          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            categorySlug={result.activeCategory?.slug}
            query={query}
          />
        </div>
      )}

      <p className="mt-6 text-sm text-zinc-500">
        Need something specific?{" "}
        <Link href="/#contact" className="font-semibold text-brand-700 hover:underline">
          Ask sales for a quote
        </Link>
        .
      </p>
    </div>
  );
}

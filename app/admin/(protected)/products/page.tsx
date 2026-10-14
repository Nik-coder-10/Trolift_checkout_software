import type { Metadata } from "next";
import { ProductImage } from "@/components/ui/ProductImage";
import Link from "next/link";
import { BulkImportDialog } from "@/components/admin/BulkImportDialog";
import { listRecentAudits, type AuditRow } from "@/lib/admin/audit";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import {
  listAdminProducts,
  listAdminCategories,
  listInventoryAlerts,
  parseAdminProductQuery,
} from "@/lib/admin/products";
import { formatMoney } from "@/lib/orders/pricing";

export const metadata: Metadata = {
  title: "Products",
  robots: { index: false, follow: false },
};

function productsHref(
  base: Record<string, string | undefined>,
  page?: number,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v) params.set(k, v);
  }
  if (page !== undefined && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs === "" ? "/admin/products" : `/admin/products?${qs}`;
}

/** Admin product list: search, category/active filters, sort, pages. */
export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseAdminProductQuery(await searchParams);
  const [result, categories, alerts, audits] = await Promise.all([
    listAdminProducts(query).catch(() => null),
    listAdminCategories().catch((): string[] => []),
    listInventoryAlerts().catch(() => null),
    listRecentAudits(10).catch((): AuditRow[] => []),
  ]);

  const base: Record<string, string | undefined> = {
    q: query.q,
    category: query.category,
    active:
      query.active === undefined ? undefined : query.active ? "true" : "false",
    sort: query.sort === "newest" ? undefined : query.sort,
  };
  const selectCls =
    "h-10 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-brand-700";

  return (
    <AdminShell
      title="Products"
      subtitle="Catalogue data behind the storefront"
      actions={
        <Link
          href="/admin/products/new"
          className="inline-flex h-9 items-center rounded-md bg-brand-800 px-3 text-sm font-bold text-white hover:bg-brand-700"
        >
          + New product
        </Link>
      }
    >
      <form
        method="get"
        action="/admin/products"
        aria-label="Search and filter products"
        className="rounded-lg border border-zinc-200 bg-white p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-sm font-semibold text-zinc-800">
              Search
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={query.q ?? ""}
              placeholder="Name, slug, category…"
              className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none placeholder:text-zinc-400 focus:border-brand-700"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="category" className="text-sm font-semibold text-zinc-800">
              Category
            </label>
            <select id="category" name="category" defaultValue={query.category ?? ""} className={selectCls}>
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="active" className="text-sm font-semibold text-zinc-800">
              Status
            </label>
            <select
              id="active"
              name="active"
              defaultValue={
                query.active === undefined ? "" : query.active ? "true" : "false"
              }
              className={selectCls}
            >
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sort" className="text-sm font-semibold text-zinc-800">
              Sort
            </label>
            <select id="sort" name="sort" defaultValue={query.sort} className={selectCls}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="price_desc">Price: high to low</option>
              <option value="price_asc">Price: low to high</option>
              <option value="name_asc">Name: A to Z</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="submit"
            className="inline-flex h-10 cursor-pointer items-center rounded-md bg-brand-800 px-4 text-sm font-bold text-white hover:bg-brand-700"
          >
            Apply
          </button>
          <Link
            href="/admin/products"
            className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Clear
          </Link>
        </div>
      </form>

      {alerts && (alerts.outOfStock.length > 0 || alerts.lowStock.length > 0) ? (
        <section aria-label="Inventory alerts" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 sm:p-5">
          <h2 className="text-base font-bold text-zinc-900">Needs restocking</h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {alerts.outOfStock.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/admin/products/${p.id}`} className="font-bold text-zinc-900 hover:text-brand-700 hover:underline">
                  {p.name}
                </Link>
                <span>
                  <Badge tone="danger">Out of stock</Badge>{" "}
                  <span className="text-xs text-zinc-500">on hand {p.stockQuantity}</span>
                </span>
              </li>
            ))}
            {alerts.lowStock.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/admin/products/${p.id}`} className="font-bold text-zinc-900 hover:text-brand-700 hover:underline">
                  {p.name}
                </Link>
                <span>
                  <Badge tone="warning">Low stock</Badge>{" "}
                  <span className="text-xs text-zinc-500">
                    {p.available} sellable of {p.stockQuantity} on hand (threshold {p.lowStockThreshold})
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">
            Sellable = on hand minus live order holds (reserve-aware).
          </p>
        </section>
      ) : null}

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
        {!result ? (
          <div role="alert">
            <p className="font-bold text-red-800">Couldn&apos;t load products.</p>
          </div>
        ) : result.products.length === 0 ? (
          <EmptyState
            title="No products found"
            message="Try different search terms or clear the filters."
          />
        ) : (
          <>
            <p role="status" className="mb-3 text-sm text-zinc-600">
              {result.total} {result.total === 1 ? "product" : "products"}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500 uppercase">
                    <th scope="col" className="py-2 pr-3 font-bold">Product</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Category</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Price</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Stock</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Status</th>
                    <th scope="col" className="py-2 font-bold">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {result.products.map((p) => (
                    <tr key={p.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-3">
                          <ProductImage
                            src={p.firstImage}
                            alt=""
                            width={48}
                            height={36}
                            className="h-9 w-12 shrink-0 rounded border border-zinc-200 bg-brand-50 object-cover"
                          />
                          <span>
                            <Link href={`/admin/products/${p.id}`} className="font-bold text-zinc-900 hover:text-brand-700 hover:underline">
                              {p.name}
                            </Link>
                            <span className="block font-mono text-xs text-zinc-400">{p.slug}</span>
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-zinc-700">{p.category}</td>
                      <td className="py-2.5 pr-3 font-semibold whitespace-nowrap text-zinc-900">
                        {formatMoney({ amountPaise: p.pricePaise, currency: "INR" })}
                      </td>
                      <td className="py-2.5 pr-3 text-zinc-700">
                        <span className="font-semibold text-zinc-900">{p.available}</span>
                        <span className="text-zinc-400"> / {p.stockQuantity}</span>
                        {p.availability === "out_of_stock" ? (
                          <span className="ml-2"><Badge tone="danger">Out</Badge></span>
                        ) : p.availability === "low_stock" ? (
                          <span className="ml-2"><Badge tone="warning">Low</Badge></span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3">
                        {p.isActive ? (
                          <Badge tone="success">Active</Badge>
                        ) : (
                          <Badge tone="neutral">Inactive</Badge>
                        )}
                      </td>
                      <td className="py-2.5 text-xs whitespace-nowrap text-zinc-500">
                        {new Date(p.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.totalPages > 1 ? (
              <nav aria-label="Product pages" className="mt-4 flex flex-wrap items-center justify-center gap-3">
                {result.page > 1 ? (
                  <Link
                    href={productsHref(base, result.page - 1)}
                    className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span aria-disabled="true" className="inline-flex h-10 cursor-not-allowed items-center rounded-md border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-400">
                    ← Previous
                  </span>
                )}
                <p className="text-sm text-zinc-600">
                  Page {result.page} of {result.totalPages}
                </p>
                {result.page < result.totalPages ? (
                  <Link
                    href={productsHref(base, result.page + 1)}
                    className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                  >
                    Next →
                  </Link>
                ) : (
                  <span aria-disabled="true" className="inline-flex h-10 cursor-not-allowed items-center rounded-md border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-400">
                    Next →
                  </span>
                )}
              </nav>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-bold text-zinc-900">Bulk import &amp; export</h2>
        <div className="mt-3">
          <BulkImportDialog
            dataset="products"
            title="Slug is the stable match key (existing slugs update in place). Images and specifications stay form-managed."
            columnsHelp="name,slug,description,category,price,stock,threshold,active,gst,weight,hsn"
            sampleCsv={`name,slug,description,category,price,stock,threshold,active,gst,weight,hsn
Demo Trolley,demo-trolley,Steel platform trolley,Trolleys,6299.00,10,5,true,18,32,87168010`}
            sampleName="products-sample.csv"
          />
          <p className="mt-3 text-sm">
            <a
              href="/api/admin/export/products"
              download
              className="font-semibold text-brand-700 hover:underline"
            >
              Export all products (CSV)
            </a>
            <span className="text-zinc-500"> — same columns as import.</span>
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
        <h2 className="text-base font-bold text-zinc-900">Recent bulk operations</h2>
        {audits.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500">
            No imports or exports recorded yet.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {audits.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-zinc-50 px-3 py-2"
              >
                <span>
                  <strong>{a.operation}</strong>{" "}
                  <span className="text-zinc-500">
                    ({a.dataset}) · {a.totalRows} rows
                    {a.result !== "success" ? ` · ${a.result}` : ""}
                  </span>
                </span>
                <span className="text-xs text-zinc-500">
                  {new Date(a.createdAt).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { EmptyState } from "@/components/ui/States";
import { ActiveToggle } from "@/components/admin/ActiveToggle";
import { ProductForm } from "@/components/admin/ProductForm";
import { listStaffNotes } from "@/lib/admin/notes";
import { NotesSection } from "@/components/admin/NotesSection";
import { getAdminProduct } from "@/lib/admin/products";
import { resolveProductImage } from "@/lib/storage/images";

export const metadata: Metadata = {
  title: "Edit product",
  robots: { index: false, follow: false },
};

/**
 * Product detail + edit: live snapshot, activation toggle and the
 * full edit form. Price edits touch only products.price — order
 * snapshots are never rewritten.
 */
export default async function AdminProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let product = null;
  try {
    product = await getAdminProduct(id);
  } catch {
    product = null;
  }
  let notes: Awaited<ReturnType<typeof listStaffNotes>> = [];
  try {
    notes = await listStaffNotes("product", id);
  } catch {
    notes = [];
  }

  return (
    <AdminShell title="Edit product" subtitle="Catalogue data and availability">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/admin" },
          { label: "Products", href: "/admin/products" },
          { label: product ? product.name : "Detail" },
        ]}
      />
      {!product ? (
        <div className="mt-4">
          <EmptyState
            title="Product not found"
            message="It may have been removed, or the link is wrong."
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4">
            <Image
              src={resolveProductImage(product.images)}
              alt=""
              width={96}
              height={72}
              className="h-[72px] w-24 shrink-0 rounded-md border border-zinc-200 bg-brand-50 object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-zinc-400">{product.slug}</p>
              <div className="mt-1">
                <PriceDisplay amountPaise={product.pricePaise} size="md" />
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                GST rate:{" "}
                {product.gstRate !== null ? (
                  <span className="font-semibold text-zinc-800">
                    {Number(product.gstRate).toLocaleString("en-IN")}% (exclusive)
                  </span>
                ) : (
                  "not configured (0%)"
                )}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Weight:{" "}
                {product.weightKg !== null ? (
                  <span className="font-semibold text-zinc-800">
                    {Number(product.weightKg).toLocaleString("en-IN", {
                      maximumFractionDigits: 3,
                    })}{" "}
                    kg / unit
                  </span>
                ) : (
                  "unknown (weight slabs skipped)"
                )}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Stock:{" "}
                <span className="font-semibold text-zinc-800">
                  {product.available} sellable
                </span>{" "}
                of {product.stockQuantity} on hand · low-stock at ≤{" "}
                {product.lowStockThreshold}
                {product.availability === "out_of_stock" ? " · out of stock" : ""}
                {product.availability === "low_stock" ? " · low stock" : ""}
              </p>
            </div>
            {product.isActive ? (
              <Badge tone="success">Active</Badge>
            ) : (
              <Badge tone="neutral">Inactive</Badge>
            )}
            <ActiveToggle
              productId={product.id}
              productName={product.name}
              isActive={product.isActive}
            />
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5">
            <ProductForm
              initial={{
                name: product.name,
                slug: product.slug,
                description: product.description,
                priceRupees: (product.pricePaise / 100).toFixed(2),
                category: product.category,
                images: product.images,
                specificationsJson: JSON.stringify(product.specifications, null, 2),
                stockQuantity: product.stockQuantity,
                lowStockThreshold: product.lowStockThreshold,
                isActive: product.isActive,
                gstRate: product.gstRate ?? "",
                weightKg: product.weightKg ?? "",
              }}
              submitLabel="Save changes"
              endpoint={`/api/admin/products/${product.id}`}
              method="PATCH"
              redirectBase="/admin/products"
            />
          </div>

          {product ? (
            <NotesSection
              entityType="product"
              entityId={product.id}
              initialNotes={notes}
            />
          ) : null}
        </div>
      )}
    </AdminShell>
  );
}

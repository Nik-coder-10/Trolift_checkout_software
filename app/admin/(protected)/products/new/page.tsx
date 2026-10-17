import type { Metadata } from "next";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { ProductForm } from "@/components/admin/ProductForm";
import type { ProductFormInput } from "@/lib/admin/product-validation";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/lib/inventory/availability";
import { getSetting } from "@/lib/settings/server";

export const metadata: Metadata = {
  title: "New product",
  robots: { index: false, follow: false },
};

/** Blank creation form (server validation + slug uniqueness enforced). */
export default async function AdminNewProductPage() {
  const thresholdOverride = await getSetting("default_low_stock_threshold");
  const EMPTY: ProductFormInput = {
    name: "",
    slug: "",
    description: "",
    priceRupees: "",
    category: "",
    images: [],
    specificationsJson: "{}",
    stockQuantity: 0,
    lowStockThreshold:
      thresholdOverride === null
        ? DEFAULT_LOW_STOCK_THRESHOLD
        : Number(thresholdOverride),
    isActive: true,
    gstRate: "",
    weightKg: "",
    hsnCode: "",
  };
  return (
    <AdminShell title="New product" subtitle="Add to the customer catalogue">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/admin" },
          { label: "Products", href: "/admin/products" },
          { label: "New" },
        ]}
      />
      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-5">
        <ProductForm
          initial={EMPTY}
          submitLabel="Create product"
          endpoint="/api/admin/products"
          method="POST"
          redirectBase="/admin/products"
        />
      </div>
    </AdminShell>
  );
}

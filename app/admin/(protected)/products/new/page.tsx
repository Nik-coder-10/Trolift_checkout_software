import type { Metadata } from "next";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { ProductForm } from "@/components/admin/ProductForm";
import type { ProductFormInput } from "@/lib/admin/product-validation";

export const metadata: Metadata = {
  title: "New product",
  robots: { index: false, follow: false },
};

const EMPTY: ProductFormInput = {
  name: "",
  slug: "",
  description: "",
  priceRupees: "",
  category: "",
  images: [],
  specificationsJson: "{}",
  stockQuantity: 0,
  lowStockThreshold: 5,
  isActive: true,
  gstRate: "",
  weightKg: "",
  hsnCode: "",
};

/** Blank creation form (server validation + slug uniqueness enforced). */
export default function AdminNewProductPage() {
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

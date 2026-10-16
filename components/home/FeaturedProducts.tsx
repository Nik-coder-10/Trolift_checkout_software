import Link from "next/link";
import { ProductCard } from "@/components/products/ProductCard";
import { EmptyState } from "@/components/ui/States";
import { getFeaturedProducts } from "@/lib/catalog/queries";

/** Featured products, fetched live from Supabase (active only). */
export async function FeaturedProducts() {
  const products = await getFeaturedProducts();

  return (
    <section aria-labelledby="featured-heading" id="featured" className="scroll-mt-20">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-brand-700 uppercase">In demand</p>
          <h2 id="featured-heading" className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
            Featured equipment
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            All prices include GST and delivery. Serviceability is
            confirmed against your delivery pincode before payment.
          </p>
        </div>
      </div>
      {products.length === 0 ? (
        <EmptyState
          title="No featured products right now"
          message="Our catalogue is being stocked. Contact sales for current availability and quotes."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm text-zinc-500">
        Need something specific?{" "}
        <Link href="#contact" className="font-semibold text-brand-700 hover:underline">
          Ask sales for a quote
        </Link>
        .
      </p>
    </section>
  );
}

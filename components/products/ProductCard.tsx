import Link from "next/link";
import type { ReactNode } from "react";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { ProductImage } from "@/components/ui/ProductImage";
import { StockBadge } from "@/components/ui/StatusBadge";
import { priceToPaise, type CatalogProduct } from "@/lib/catalog/products";
import { resolveProductImage } from "@/lib/storage/images";

/**
 * Catalogue product card (homepage + /products grid).
 *
 * No cart exists yet, so the default action is a View Details link.
 * The cart phase injects its own UI via the `actions` slot without
 * touching this component (e.g. <AddToCartButton …/> next to View).
 */
export function ProductCard({
  product,
  actions,
}: {
  product: CatalogProduct;
  actions?: ReactNode;
}) {
  // Single source of truth for display paths: the first VALID image or
  // the branded placeholder. The same value is snapshotted into the
  // cart, so a malformed/empty path can never be persisted either.
  const image = resolveProductImage(product.images);
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <Link
        href={`/products/${product.slug}`}
        aria-label={`View ${product.name}`}
        className="block bg-brand-50"
      >
        <ProductImage
          src={image}
          alt={`${product.name} — product photo`}
          fallbackAlt={`${product.name} — product photo unavailable`}
          width={400}
          height={300}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="aspect-[4/3] w-full object-cover"
        />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
            {product.category}
          </p>
          <StockBadge status={product.availability} />
        </div>
        <h3 className="line-clamp-2 min-h-[3rem] text-base leading-6 font-bold text-zinc-900">
          <Link href={`/products/${product.slug}`} className="hover:text-brand-700 hover:underline">
            {product.name}
          </Link>
        </h3>
        <p className="line-clamp-2 text-sm text-zinc-600">{product.description}</p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <PriceDisplay amountPaise={priceToPaise(product.price)} unitNote="incl. GST" />
          {actions ?? (
            <span className="flex shrink-0 items-center gap-2">
              {product.availability === "out_of_stock" ? (
                <span
                  aria-disabled="true"
                  className="inline-flex h-11 shrink-0 cursor-not-allowed items-center rounded-md bg-zinc-100 px-4 text-sm font-bold text-zinc-400"
                >
                  Sold out
                </span>
              ) : (
                <AddToCartButton
                  product={{
                    productId: product.id,
                    slug: product.slug,
                    name: product.name,
                    category: product.category,
                    pricePaise: priceToPaise(product.price),
                    image: image,
                    stockQuantity: product.stock_quantity,
                  }}
                />
              )}
              <Link
                href={`/products/${product.slug}`}
                className="inline-flex h-11 items-center rounded-md bg-brand-800 px-4 text-sm font-semibold text-white hover:bg-brand-700"
              >
                View
              </Link>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

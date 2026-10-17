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
 *
 * Out of stock: the whole card dims, every link/button is replaced by
 * non-interactive elements (nothing navigable, nothing addable), and a
 * diagonal ribbon states the reason. Detail pages stay reachable from
 * elsewhere for specs/FAQ — the card itself just cannot be clicked.
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
  const outOfStock = product.availability === "out_of_stock";
  const media = (
    <ProductImage
      src={image}
      alt={`${product.name} — product photo`}
      fallbackAlt={`${product.name} — product photo unavailable`}
      width={400}
      height={300}
      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
      className="aspect-[4/3] w-full object-cover"
    />
  );
  return (
    <article className="relative flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {outOfStock ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-3 right-[-42px] z-10 w-36 rotate-45 bg-red-600 py-1 text-center text-[11px] font-bold tracking-wide text-white uppercase shadow-sm"
        >
          Out of stock
        </span>
      ) : null}
      <div className={outOfStock ? "opacity-60" : undefined}>
        {outOfStock ? (
          <div className="block bg-brand-50">{media}</div>
        ) : (
          <Link
            href={`/products/${product.slug}`}
            aria-label={`View ${product.name}`}
            className="block bg-brand-50"
          >
            {media}
          </Link>
        )}
      </div>
      <div className={`flex flex-1 flex-col gap-2 p-4 ${outOfStock ? "opacity-60" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
            {product.category}
          </p>
          {outOfStock ? null : <StockBadge status={product.availability} />}
        </div>
        <h3 className="line-clamp-2 min-h-[3rem] text-base leading-6 font-bold text-zinc-900">
          {outOfStock ? (
            <span>{product.name}</span>
          ) : (
            <Link href={`/products/${product.slug}`} className="hover:text-brand-700 hover:underline">
              {product.name}
            </Link>
          )}
        </h3>
        <p className="line-clamp-2 text-sm text-zinc-600">{product.description}</p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <PriceDisplay amountPaise={priceToPaise(product.price)} unitNote="incl. GST" />
          {outOfStock ? (
            <span
              aria-disabled="true"
              className="inline-flex h-11 shrink-0 cursor-not-allowed items-center rounded-md bg-zinc-100 px-4 text-sm font-bold text-zinc-400"
            >
              Sold out
            </span>
          ) : (
            actions ?? (
              <span className="flex shrink-0 items-center gap-2">
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
                <Link
                  href={`/products/${product.slug}`}
                  className="inline-flex h-11 items-center rounded-md bg-brand-800 px-4 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  View
                </Link>
              </span>
            )
          )}
        </div>
      </div>
    </article>
  );
}

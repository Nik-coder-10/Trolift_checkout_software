"use client";

import Link from "next/link";
import { useCart } from "@/components/cart/CartProvider";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { ProductImage } from "@/components/ui/ProductImage";
import { QuantitySelector } from "@/components/ui/QuantitySelector";
import { EmptyState } from "@/components/ui/States";

/**
 * Cart contents: line items with quantity steppers, remove/clear,
 * and a display-only estimate. Checkout re-prices everything
 * server-side — nothing here is an order total.
 */
export function CartView() {
  const { items, subtotalPaise, setQuantity, removeItem, clearCart } = useCart();

  if (items.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        message="Browse the catalogue and add the equipment your site needs."
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <section aria-label="Cart items">
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.productId}
              className="flex gap-4 rounded-lg border border-zinc-200 bg-white p-4"
            >
              <Link
                href={`/products/${item.slug}`}
                aria-label={`View ${item.name}`}
                className="block w-24 shrink-0 overflow-hidden rounded-md bg-brand-50"
              >
                <ProductImage
                  src={item.image}
                  alt=""
                  width={160}
                  height={120}
                  className="aspect-[4/3] w-full object-cover"
                />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
                      {item.category}
                    </p>
                    <Link
                      href={`/products/${item.slug}`}
                      className="text-sm font-bold text-zinc-900 hover:text-brand-700 hover:underline"
                    >
                      {item.name}
                    </Link>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.productId)}
                    aria-label={`Remove ${item.name} from cart`}
                    className="cursor-pointer rounded p-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-auto flex flex-wrap items-end justify-between gap-2">
                  <QuantitySelector
                    value={item.quantity}
                    onChange={(q) => setQuantity(item.productId, q)}
                    min={1}
                    max={Math.max(1, Math.min(item.stockQuantity, 999))}
                    label={`Quantity for ${item.name}`}
                    small
                  />
                  <PriceDisplay amountPaise={item.pricePaise * item.quantity} />
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <button
            type="button"
            onClick={clearCart}
            className="cursor-pointer text-sm font-semibold text-zinc-500 hover:text-red-700 hover:underline"
          >
            Clear cart
          </button>
        </div>
      </section>
      <aside aria-label="Order summary" className="h-fit rounded-lg border border-zinc-200 bg-white p-5 lg:sticky lg:top-20">
        <h2 className="text-base font-bold text-zinc-900">Summary</h2>
        <div className="mt-3">
          <PriceDisplay amountPaise={subtotalPaise} unitNote="incl. GST & delivery" size="md" />
        </div>
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          All prices include GST and delivery — the final total is
          verified server-side at checkout.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Link
            href="/checkout"
            className="inline-flex h-12 items-center justify-center rounded-md bg-brand-800 px-6 text-base font-bold text-white hover:bg-brand-700"
          >
            Proceed to Checkout
          </Link>
          <Link
            href="/products"
            className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
          >
            Continue browsing
          </Link>
        </div>
      </aside>
    </div>
  );
}

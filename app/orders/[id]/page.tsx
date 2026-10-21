import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/Alert";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/StatusBadge";
import { OrderActions } from "@/components/orders/OrderActions";
import { GuestKeyExchange } from "@/components/orders/GuestKeyExchange";
import { getPayableOrderForGuest } from "@/lib/payments/order";
import { guestCookieName } from "@/lib/guest-access/tokens";
import { buildTimeline } from "@/lib/orders/display";
import { canIssueQuotation } from "@/lib/quotations/data";

async function loadOrder(id: string) {
  try {
    const store = await cookies();
    const token = store.get(guestCookieName(id))?.value ?? null;
    return await getPayableOrderForGuest(id, token);
  } catch (error) {
    // Fail closed: unreadable orders look exactly like missing ones.
    // The token value is never logged.
    console.error("[order] Failed to load order.");
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const order = await loadOrder(id);
  return {
    title: order ? `Order ${order.orderNumber}` : "Order not found",
    description: "View your Trolift order status and details.",
    robots: { index: false, follow: false },
  };
}

/**
 * Order confirmation + details. Guest access requires the HttpOnly
 * session cookie issued at checkout (or via recovery/rotation) — the
 * order UUID alone authorizes nothing. A one-time `?key=` link is
 * exchanged into that cookie by <GuestKeyExchange/> and stripped from
 * the URL so tokens avoid history, referrers and screenshots.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const keyParam = sp["key"];
  const order = await loadOrder(id);
  if (!order) {
    // A one-time `?key=` link arrives without the cookie by definition:
    // render the exchanger (which POSTs the key, sets the cookie and
    // strips the URL) instead of 404ing. No order data renders here —
    // an invalid key still ends at not-found after the exchange fails.
    if (typeof keyParam === "string" && keyParam !== "") {
      return (
        <div className="mx-auto w-full max-w-xl px-4 py-6 sm:px-6">
          <Breadcrumbs
            items={[
              { label: "Home", href: "/" },
              { label: "Products", href: "/products" },
              { label: "Verifying order link" },
            ]}
          />
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-zinc-900">
            Verifying your order link…
          </h1>
          <GuestKeyExchange orderId={id} autoNotFound />
        </div>
      );
    }
    notFound();
  }

  const fresh = sp["fresh"] === "1";
  const hasKey = typeof keyParam === "string" && keyParam !== "";
  const { stages, cancelled } = buildTimeline(order.orderStatus);
  const payable =
    (order.paymentStatus === "pending" || order.paymentStatus === "failed") &&
    (order.orderStatus === "pending_payment" || order.orderStatus === "draft");
  // Quotations are provisional documents — downloadable while the
  // order is still pre-payment (same gate as the quotation service).
  const provisional = canIssueQuotation(order.orderStatus);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Products", href: "/products" },
          { label: `Order ${order.orderNumber}` },
        ]}
      />

      {fresh && !cancelled ? (
        <div role="status" className="mt-4">
          <Alert tone="success" title="Order placed successfully">
            Order {order.orderNumber} is confirmed in our system.
            {order.paymentStatus === "pending"
              ? " Complete the payment below to get it moving."
              : null}
          </Alert>
        </div>
      ) : null}
      {hasKey ? <GuestKeyExchange orderId={order.id} /> : null}

      {cancelled ? (
        <div className="mt-4">
          <Alert tone="error" title="This order was cancelled">
            Contact sales if you need help placing a fresh order.
          </Alert>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
          Order {order.orderNumber}
        </h1>
        <OrderStatusBadge status={order.orderStatus} />
        <PaymentStatusBadge status={order.paymentStatus} />
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        Placed {new Date(order.createdAt).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}{" "}
        · <OrderActions order={order} />
      </p>

      <section aria-label="Shipment tracking" className="mt-6 rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-base font-bold text-zinc-900">Shipment</h2>
        {order.tracking ? (
          <dl className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500">Tracking number</dt>
              <dd className="font-mono font-semibold text-zinc-900">{order.tracking.trackingNumber}</dd>
            </div>
            {order.tracking.estimatedDeliveryDate ? (
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-500">Estimated delivery</dt>
                <dd className="font-semibold text-zinc-900">{order.tracking.estimatedDeliveryDate}</dd>
              </div>
            ) : null}
            {order.tracking.trackingUrl ? (
              <a
                href={order.tracking.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 text-sm font-semibold text-brand-700 hover:underline"
              >
                Track on courier website →
              </a>
            ) : null}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-zinc-600">
            Tracking details appear here once your order ships. Your order
            number ({order.orderNumber}) is all you need until then.
          </p>
        )}
      </section>

      {order.timeline.length > 0 ? (
        <section aria-label="Order updates" className="mt-6 rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-bold text-zinc-900">Updates</h2>
          <ol className="mt-3 flex flex-col gap-0">
            {order.timeline.map((entry) => (
              <li key={`${entry.at}-${entry.label}`} className="relative flex gap-3 pb-3 pl-6 last:pb-0">
                <span
                  aria-hidden
                  className="absolute top-1.5 left-[5px] h-2.5 w-2.5 rounded-full bg-brand-700"
                />
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold text-zinc-900">{entry.label}</span>
                  <span className="shrink-0 text-xs whitespace-nowrap text-zinc-500">
                    {new Date(entry.at).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <ol aria-label="Order progress" className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {stages.map((s) => (
          <li
            key={s.key}
            aria-current={s.state === "current" ? "step" : undefined}
            className={`rounded-md border px-2 py-2.5 text-center ${
              s.state === "done"
                ? "border-green-300 bg-green-50"
                : s.state === "current"
                  ? "border-brand-700 bg-brand-50"
                  : "border-zinc-200 bg-white"
            }`}
          >
            <p
              className={`text-xs font-bold ${
                s.state === "todo" ? "text-zinc-400" : "text-zinc-900"
              }`}
            >
              {s.state === "done" ? "✓ " : ""}
              {s.label}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-label="Items" className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-bold text-zinc-900">Items</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {order.items.map((item) => (
                <li key={`${item.name}-${item.quantity}`} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-zinc-700">
                    {item.name} × {item.quantity}
                  </span>
                  <span className="shrink-0 font-semibold text-zinc-900">
                    <PriceDisplay amountPaise={item.lineTotalPaise} size="sm" />
                  </span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 flex flex-col gap-1.5 border-t border-zinc-100 pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-600">
                  {order.tax.treatment === "gst"
                    ? "Subtotal (excl. GST)"
                    : "Subtotal"}
                </dt>
                <dd className="font-semibold text-zinc-900">
                  <PriceDisplay amountPaise={order.subtotalPaise} size="sm" />
                </dd>
              </div>
              {order.tax.treatment === "gst" ? (
                <>
                  {order.tax.cgstPaise > 0 || order.tax.sgstPaise > 0 ? (
                    <>
                      <div className="flex justify-between">
                        <dt className="text-zinc-600">CGST</dt>
                        <dd className="font-semibold text-zinc-900">
                          <PriceDisplay amountPaise={order.tax.cgstPaise} size="sm" />
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-zinc-600">SGST</dt>
                        <dd className="font-semibold text-zinc-900">
                          <PriceDisplay amountPaise={order.tax.sgstPaise} size="sm" />
                        </dd>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between">
                      <dt className="text-zinc-600">IGST</dt>
                      <dd className="font-semibold text-zinc-900">
                        <PriceDisplay amountPaise={order.tax.igstPaise} size="sm" />
                      </dd>
                    </div>
                  )}
                </>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-zinc-600">
                  Delivery
                  {order.deliveryPartnerName
                    ? ` (${order.deliveryPartnerName})`
                    : ""}
                </dt>
                <dd className="font-semibold text-zinc-900">
                  {order.deliveryChargePaise > 0 ? (
                    <>
                      <PriceDisplay amountPaise={order.deliveryChargePaise} size="sm" />
                      {order.deliveryTaxPaise > 0 ? (
                        <span className="block text-xs font-normal text-zinc-500">
                          +{" "}
                          {Math.round(
                            (order.deliveryTaxPaise * 100) /
                              order.deliveryChargePaise,
                          )}
                          % GST ({" "}
                          <PriceDisplay
                            amountPaise={order.deliveryTaxPaise}
                            size="sm"
                          />{" "}
                          )
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span>Included</span>
                  )}
                </dd>
              </div>
              {order.discountPaise > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-zinc-600">
                    Discount{order.couponCode ? ` (${order.couponCode})` : ""}
                  </dt>
                  <dd className="font-semibold text-red-600">
                    -<PriceDisplay amountPaise={order.discountPaise} size="sm" />
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-zinc-100 pt-2 text-base">
                <dt className="font-bold text-zinc-900">Total</dt>
                <dd className="font-bold text-zinc-900">
                  <PriceDisplay amountPaise={order.totalPaise} size="md" />
                </dd>
              </div>
            </dl>
          </section>

          <section aria-label="Delivery details" className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-bold text-zinc-900">Delivery</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-zinc-500">Customer</dt>
                <dd className="font-semibold text-zinc-900">{order.customerName}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Phone</dt>
                <dd className="font-semibold text-zinc-900">{order.customerPhoneMasked}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Pincode</dt>
                <dd className="font-semibold text-zinc-900">{order.deliveryPincode}</dd>
              </div>
              <div className="sm:col-span-3">
                <dt className="text-zinc-500">Shipping address</dt>
                <dd className="font-semibold text-zinc-900">
                  {order.shippingAddress ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Partner</dt>
                <dd className="font-semibold text-zinc-900">{order.deliveryPartnerName}</dd>
              </div>
              {order.gstinMasked ? (
                <>
                  <div>
                    <dt className="text-zinc-500">GSTIN (customer-provided)</dt>
                    <dd className="font-semibold text-zinc-900">{order.gstinMasked}</dd>
                  </div>
                  {order.billingName ? (
                    <div>
                      <dt className="text-zinc-500">Billed to</dt>
                      <dd className="font-semibold text-zinc-900">{order.billingName}</dd>
                    </div>
                  ) : null}
                </>
              ) : null}
            </dl>
          </section>
        </div>

        <aside aria-label="Payment" className="h-fit rounded-lg border border-zinc-200 bg-white p-5 lg:sticky lg:top-20">
          <h2 className="text-base font-bold text-zinc-900">Payment</h2>
          <div className="mt-2">
            <PaymentStatusBadge status={order.paymentStatus} />
          </div>
          {order.paymentStatus === "pending" || order.paymentStatus === "failed" ? (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-sm text-zinc-600">
                {order.paymentStatus === "failed"
                  ? "The last attempt failed — try paying again."
                  : "Payment pending."}
              </p>
              {payable ? (
                <Link
                  href={`/orders/${order.id}/pay`}
                  className="inline-flex h-12 items-center justify-center rounded-md bg-brand-800 px-6 text-base font-bold text-white hover:bg-brand-700"
                >
                  Complete Payment
                </Link>
              ) : null}
            </div>
          ) : order.paymentStatus === "submitted" ? (
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              Payment verification pending — we confirm your order after
              verifying the payment. This usually happens within a few
              business hours.
            </p>
          ) : (
            <p className="mt-3 text-sm leading-6 text-zinc-600">Payment confirmed.</p>
          )}
          <div className="mt-4 border-t border-zinc-100 pt-4">
            {order.paymentStatus === "paid" ? (
              <a
                href={`/api/orders/${order.id}/invoice`}
                download
                className="inline-flex h-11 items-center justify-center rounded-md bg-brand-800 px-5 text-sm font-bold text-white hover:bg-brand-700"
              >
                Download Invoice
              </a>
            ) : (
              <div className="flex flex-col gap-2">
                {provisional ? (
                  <a
                    href={`/api/orders/${order.id}/quotation`}
                    download
                    className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                  >
                    Download Quotation
                  </a>
                ) : null}
                <p className="text-xs leading-5 text-zinc-500">
                  The tax invoice is issued after payment verification.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

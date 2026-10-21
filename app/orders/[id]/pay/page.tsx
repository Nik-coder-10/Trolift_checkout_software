import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/Alert";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/StatusBadge";
import { ClaimForm } from "@/components/payments/ClaimForm";
import { getPayableOrderForGuest } from "@/lib/payments/order";
import { guestCookieName } from "@/lib/guest-access/tokens";
import { getPaymentProvider } from "@/lib/payments/provider";
import { getPaymentWindowHours } from "@/lib/payments/upi";
import { canIssueQuotation } from "@/lib/quotations/data";

async function loadOrder(id: string) {
  try {
    const store = await cookies();
    const token = store.get(guestCookieName(id))?.value ?? null;
    return await getPayableOrderForGuest(id, token);
  } catch (error) {
    // Fail closed: an unreadable order (including a misconfigured or
    // unreachable database) looks exactly like a missing one publicly.
    // Details stay in server logs for operators; tokens are never logged.
    console.error("[pay] Failed to load order.");
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
    title: order ? `Pay for ${order.orderNumber}` : "Order not found",
    description: "Pay for your Trolift order over UPI.",
    robots: { index: false, follow: false },
  };
}

/**
 * Order payment page. Guest access requires the HttpOnly session
 * cookie (order UUID alone authorizes nothing): authoritative amount,
 * dynamic UPI QR, instructions, UTR claim. Nothing here verifies
 * payment — admin reconciliation flips SUBMITTED → PAID later.
 */
export default async function OrderPayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await loadOrder(id);
  if (!order) notFound();
  const paymentWindowHours = await getPaymentWindowHours();

  const canClaim =
    (order.paymentStatus === "pending" || order.paymentStatus === "failed") &&
    (order.orderStatus === "pending_payment" || order.orderStatus === "draft");

  let intent = null;
  let configError: string | null = null;
  if (canClaim) {
    try {
      intent = await getPaymentProvider().createPaymentIntent({
        orderId: order.id,
        orderNumber: order.orderNumber,
        amountPaise: order.totalPaise,
      });
    } catch (e) {
      configError =
        e instanceof Error ? e.message : "Payment is not configured.";
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Products", href: "/products" },
          { label: `Order ${order.orderNumber}` },
        ]}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
          Pay for {order.orderNumber}
        </h1>
        <PaymentStatusBadge status={order.paymentStatus} />
        <OrderStatusBadge status={order.orderStatus} />
        {canIssueQuotation(order.orderStatus) ? (
          <a
            href={`/api/orders/${order.id}/quotation`}
            download
            className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
          >
            Download Quotation
          </a>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        Hi {order.customerName} — please complete payment within{" "}
        {paymentWindowHours} hours so your equipment ships on time.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section aria-label="Scan and pay" className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-bold text-zinc-900">1. Scan to pay</h2>
          {configError || !intent ? (
            <div className="mt-3">
              <Alert tone="error" title="Payment is not configured">
                {configError ??
                  "The payment QR is unavailable because the order cannot be paid right now."}
              </Alert>
            </div>
          ) : (
            <>
              <div className="mx-auto mt-3 max-w-xs overflow-hidden rounded-md border border-zinc-200 bg-white p-3">
                <Image
                  src={intent.qrDataUrl}
                  alt={`UPI QR for ${order.orderNumber}: pay ${intent.payeeName}`}
                  width={320}
                  height={320}
                  className="h-auto w-full"
                />
              </div>
              <div className="mt-3 flex justify-center">
                <PriceDisplay amountPaise={intent.amountPaise} size="lg" />
              </div>
              <p className="mt-1 text-center text-xs text-zinc-500">
                To {intent.payeeName} · {intent.payeeVpa}
              </p>
              <ol className="mt-4 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-zinc-700">
                <li>Open any UPI app (GPay, PhonePe, Paytm, BHIM…).</li>
                <li>Scan the QR and verify the exact amount above.</li>
                <li>Complete the payment.</li>
                <li>
                  Submit the payment screenshot below — we verify every
                  payment manually. Add the UTR too if you have it to hand.
                </li>
              </ol>
            </>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          <section aria-label="Order summary" className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-bold text-zinc-900">2. Order summary</h2>
            <ul className="mt-3 flex flex-col gap-2 border-b border-zinc-100 pb-3">
              {order.items.map((item) => (
                <li key={`${item.name}-${item.quantity}`} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-zinc-700">
                    {item.name} × {item.quantity}
                  </span>
                  <span className="shrink-0 font-semibold text-zinc-900">
                    ₹{(item.lineTotalPaise / 100).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 flex flex-col gap-1.5 text-sm">
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
                <div className="flex justify-between">
                  <dt className="text-zinc-600">
                    GST included{" "}
                    {order.tax.igstPaise > 0 ? "(IGST)" : "(CGST + SGST)"}
                  </dt>
                  <dd className="font-semibold text-zinc-900">
                    <PriceDisplay
                      amountPaise={
                        order.tax.cgstPaise +
                        order.tax.sgstPaise +
                        order.tax.igstPaise
                      }
                      size="sm"
                    />
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-zinc-600">Delivery</dt>
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
                <dt className="font-bold text-zinc-900">Total due</dt>
                <dd className="font-bold text-zinc-900">
                  <PriceDisplay amountPaise={order.totalPaise} size="md" />
                </dd>
              </div>
            </dl>
            {order.paymentReferenceMasked ? (
              <p className="mt-2 text-xs text-zinc-500">
                Submitted reference:{" "}
                <span className="font-mono font-semibold">{order.paymentReferenceMasked}</span>
              </p>
            ) : null}
          </section>

          <section aria-label="Confirm payment" className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-bold text-zinc-900">3. Confirm payment</h2>
            <div className="mt-3">
              {canClaim ? (
                <ClaimForm orderId={order.id} />
              ) : order.paymentStatus === "submitted" ||
                order.orderStatus === "payment_submitted" ? (
                <Alert tone="info" title="Payment under verification">
                  We received your reference
                  {order.paymentReferenceMasked ? ` (${order.paymentReferenceMasked})` : ""}
                  {order.hasPaymentProof ? " and your payment screenshot" : ""} and
                  will confirm your order after verification.
                </Alert>
              ) : (
                <Alert tone="info" title="Nothing to pay here">
                  This order is {order.orderStatus.replace(/_/g, " ")} with payment{" "}
                  {order.paymentStatus}.{" "}
                  <Link href="/products" className="font-semibold text-brand-700 hover:underline">
                    Continue browsing
                  </Link>
                </Alert>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

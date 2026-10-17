import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { EmptyState } from "@/components/ui/States";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/StatusBadge";
import { PaymentActions } from "@/components/admin/PaymentActions";
import { StatusActions } from "@/components/admin/StatusActions";
import { getAdminOrderDetail } from "@/lib/admin/orders";
import { getOrderDocumentActions } from "@/lib/admin/order-documents";
import { listStaffNotes } from "@/lib/admin/notes";
import { ADMIN_EVENT_DESCRIPTIONS } from "@/lib/orders/events";
import { getShipmentByOrderId } from "@/lib/shipments/service";
import { NotesSection } from "@/components/admin/NotesSection";
import { DocumentActions } from "@/components/admin/DocumentActions";

export const metadata: Metadata = {
  title: "Order detail",
  robots: { index: false, follow: false },
};

/** Admin order detail: snapshots, payment verification, transitions, audit. */
export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  let order = null;
  try {
    order = await getAdminOrderDetail(orderId);
  } catch {
    order = null;
  }
  let shipment = null;
  try {
    shipment = await getShipmentByOrderId(orderId);
  } catch {
    shipment = null;
  }
  let notes: Awaited<ReturnType<typeof listStaffNotes>> = [];
  try {
    notes = await listStaffNotes("order", orderId);
  } catch {
    notes = [];
  }
  // Read-only: documents are numbered/frozen by the download routes, so
  // rendering this page never issues one. A failed probe only hides the
  // panel (fail closed); the server re-authorizes every download anyway.
  let documents: Awaited<ReturnType<typeof getOrderDocumentActions>> | null =
    null;
  if (order) {
    try {
      documents = await getOrderDocumentActions({
        id: order.id,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
      });
    } catch {
      documents = null;
    }
  }

  return (
    <AdminShell title="Order detail" subtitle="Snapshots, payment and audit trail">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/admin" },
          { label: "Orders", href: "/admin/orders" },
          { label: order ? order.orderNumber : "Detail" },
        ]}
      />
      {!order ? (
        <div className="mt-4">
          <EmptyState
            title="Order not found"
            message="It may have been removed, or the link is wrong."
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900">
              {order.orderNumber}
            </h1>
            <OrderStatusBadge status={order.orderStatus} />
            <PaymentStatusBadge status={order.paymentStatus} />
            <span className="inline-flex items-center rounded-md border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-xs font-bold text-zinc-600" title="Inventory position: reserved (held), consumed (sold), restored (returned), none (pre-inventory)">
              Stock: {order.stockState}
            </span>
          </div>

          {documents ? (
            <DocumentActions
              invoice={documents.invoice}
              quotation={documents.quotation}
              paymentStatus={order.paymentStatus}
              orderStatus={order.orderStatus}
            />
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-label="Customer" className="rounded-lg border border-zinc-200 bg-white p-5">
              <h2 className="text-base font-bold text-zinc-900">Customer</h2>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-zinc-500">Name</dt>
                  <dd className="font-semibold text-zinc-900">{order.customer.name}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Phone</dt>
                  <dd className="font-semibold text-zinc-900">{order.customer.phone}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Email</dt>
                  <dd className="font-semibold text-zinc-900">{order.customer.email ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">GSTIN (customer-provided)</dt>
                  <dd className="font-semibold text-zinc-900">{order.customer.gstin ?? "—"}</dd>
                </div>
              </dl>
            </section>

            {order.taxTreatment === "gst" ? (
              <section aria-label="GST billing" className="rounded-lg border border-zinc-200 bg-white p-5">
                <h2 className="text-base font-bold text-zinc-900">GST billing (order snapshot)</h2>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-zinc-500">Billed to</dt>
                    <dd className="font-semibold text-zinc-900">{order.billing.name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Address</dt>
                    <dd className="font-semibold text-zinc-900">
                      {[order.billing.addressLine, order.billing.city, order.billing.state, order.billing.pincode]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">State code</dt>
                    <dd className="font-semibold text-zinc-900">{order.billing.stateCode ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Tax type</dt>
                    <dd className="font-semibold text-zinc-900">
                      {order.cgstPaise > 0 || order.sgstPaise > 0 ? "CGST + SGST" : "IGST"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-zinc-500">
                  Frozen at order time — editing the customer profile never changes this.
                </p>
              </section>
            ) : null}

            <section aria-label="Payment verification" className="rounded-lg border border-zinc-200 bg-white p-5">
              <h2 className="text-base font-bold text-zinc-900">Payment</h2>
              <dl className="mt-3 flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Status</dt>
                  <dd>
                    <PaymentStatusBadge status={order.paymentStatus} />
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-500">UTR / reference</dt>
                  <dd className="font-mono font-semibold text-zinc-900">
                    {order.paymentReference ?? "—"}
                  </dd>
                </div>
                {order.paymentUpdatedAt ? (
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-500">Last update</dt>
                    <dd className="text-zinc-700">
                      {new Date(order.paymentUpdatedAt).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {order.paymentStatus === "submitted" ? (
                <div className="mt-4">
                  <PaymentActions orderId={order.id} />
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-zinc-500">
                  Verification actions appear while a claim is submitted. Paid,
                  failed and refunded states change only through their own
                  transitions.
                </p>
              )}
            </section>
          </div>

          <section aria-label="Items" className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-bold text-zinc-900">Items (purchase-time snapshots)</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {order.items.map((item) => (
                <li key={`${item.name}-${item.quantity}`} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-zinc-700">
                    {item.name} × {item.quantity}{" "}
                    <span className="text-zinc-400">
                      @ ₹{(item.unitPricePaise / 100).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                      {item.gstRate !== null ? ` + ${Number(item.gstRate).toLocaleString("en-IN")}% GST` : null}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold text-zinc-900">
                    <PriceDisplay amountPaise={item.lineTotalPaise} size="sm" />
                  </span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 flex flex-col gap-1.5 border-t border-zinc-100 pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-600">Subtotal (ex-GST)</dt>
                <dd className="font-semibold text-zinc-900">
                  <PriceDisplay amountPaise={order.subtotalPaise} size="sm" />
                </dd>
              </div>
              {order.taxTreatment === "gst" ? (
                <>
                  {order.cgstPaise > 0 || order.sgstPaise > 0 ? (
                    <>
                      <div className="flex justify-between">
                        <dt className="text-zinc-600">CGST</dt>
                        <dd className="font-semibold text-zinc-900">
                          <PriceDisplay amountPaise={order.cgstPaise} size="sm" />
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-zinc-600">SGST</dt>
                        <dd className="font-semibold text-zinc-900">
                          <PriceDisplay amountPaise={order.sgstPaise} size="sm" />
                        </dd>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between">
                      <dt className="text-zinc-600">IGST</dt>
                      <dd className="font-semibold text-zinc-900">
                        <PriceDisplay amountPaise={order.igstPaise} size="sm" />
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
                    <PriceDisplay amountPaise={order.deliveryChargePaise} size="sm" />
                  ) : (
                    <span>Included</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-600">Pincode</dt>
                <dd className="font-semibold text-zinc-900">{order.deliveryPincode}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-zinc-600">Shipping address</dt>
                <dd className="text-right font-semibold text-zinc-900">
                  {order.shippingAddress ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between border-t border-zinc-100 pt-2 text-base">
                <dt className="font-bold text-zinc-900">Total</dt>
                <dd className="font-bold text-zinc-900">
                  <PriceDisplay amountPaise={order.totalPaise} size="md" />
                </dd>
              </div>
            </dl>
          </section>

          <section aria-label="Fulfillment" className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-bold text-zinc-900">Fulfillment</h2>
            <div className="mt-2">
              <OrderStatusBadge status={order.orderStatus} />
            </div>
            <div className="mt-3">
              <StatusActions
                orderId={order.id}
                current={order.orderStatus}
                hasPacked={order.events.some((e) => e.eventType === "PACKED")}
                hasReady={order.events.some(
                  (e) => e.eventType === "READY_FOR_DISPATCH",
                )}
              />
            </div>
            {shipment ? (
              <div className="mt-4 border-t border-zinc-100 pt-4">
                <h3 className="text-sm font-bold text-zinc-900">Shipment</h3>
                <dl className="mt-2 flex flex-col gap-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-zinc-500">Tracking reference</dt>
                    <dd className="font-mono text-xs font-semibold text-zinc-900">
                      {shipment.trackingReference ?? "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-zinc-500">Expected delivery</dt>
                    <dd className="text-zinc-700">
                      {shipment.expectedDeliveryDate
                        ? new Date(shipment.expectedDeliveryDate).toLocaleDateString("en-IN")
                        : "—"}
                    </dd>
                  </div>
                  {shipment.dispatchNotes ? (
                    <div className="mt-1">
                      <dt className="text-zinc-500">Dispatch notes</dt>
                      <dd className="text-sm text-zinc-700">{shipment.dispatchNotes}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="mt-3">
                  <Link
                    href={`/admin/shipments/${shipment.id}`}
                    className="text-sm font-semibold text-brand-700 hover:underline"
                  >
                    Manage shipment →
                  </Link>
                </div>
              </div>
            ) : null}
            {order.orderStatus !== "cancelled" &&
            order.orderStatus !== "delivered" ? (
              <div className="mt-4 border-t border-zinc-100 pt-4">
                <h3 className="text-sm font-bold text-zinc-900">Lifecycle timeline</h3>
                <ol className="mt-2 flex flex-col gap-1 text-sm">
                  {[
                    { status: "confirmed", label: "Confirmed" },
                    { status: "processing", label: "Processing" },
                    { status: "packed", label: "Packed" },
                    { status: "ready_for_dispatch", label: "Ready for dispatch" },
                    { status: "dispatched", label: "Dispatched" },
                    { status: "delivered", label: "Delivered" },
                  ].map((stage) => {
                    const event = order.events.find(
                      (e) => e.toStatus === stage.status || e.eventType === stage.status.toUpperCase().replace(/_/g, "_"),
                    );
                    const isCurrent = order.orderStatus === stage.status;
                    const isPast = event !== undefined;
                    return (
                      <li key={stage.status} className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            isCurrent
                              ? "bg-brand-700"
                              : isPast
                                ? "bg-green-500"
                                : "bg-zinc-300"
                          }`}
                        />
                        <span className={isCurrent ? "font-bold text-zinc-900" : isPast ? "text-zinc-700" : "text-zinc-400"}>
                          {stage.label}
                        </span>
                        {event ? (
                          <span className="text-xs text-zinc-500">
                            {new Date(event.createdAt).toLocaleString("en-IN", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}
          </section>

          <section aria-label="Audit trail" className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-bold text-zinc-900">Activity</h2>
            {order.events.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">
                No events recorded yet. Order placement, payment decisions,
                status changes and fulfilment milestones appear here with
                timestamps.
              </p>
            ) : (
              <ol className="mt-3 flex flex-col gap-0">
                {order.events.map((e, i) => (
                  <li
                    key={`${e.createdAt}-${e.eventType}-${e.toStatus ?? ""}`}
                    className="relative flex gap-3 pb-4 pl-6 last:pb-0"
                  >
                    <span
                      aria-hidden
                      className="absolute top-1.5 left-[5px] h-2.5 w-2.5 rounded-full bg-brand-700"
                    />
                    {i < order.events.length - 1 ? (
                      <span
                        aria-hidden
                        className="absolute top-5 bottom-0 left-[10px] w-px bg-zinc-200"
                      />
                    ) : null}
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-2 rounded-md bg-zinc-50 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-semibold text-zinc-900">
                          {ADMIN_EVENT_DESCRIPTIONS[
                            e.eventType as keyof typeof ADMIN_EVENT_DESCRIPTIONS
                          ] ?? e.eventType}
                        </span>
                        {e.fromStatus || e.toStatus ? (
                          <span className="font-normal text-zinc-500">
                            {" "}
                            ({e.fromStatus ?? "—"} → {e.toStatus ?? "—"})
                          </span>
                        ) : null}
                        <span className="block text-xs font-normal text-zinc-500">
                          {e.actorType === "admin" ? "Staff" : e.actorType}
                          {e.actorId ? ` · ${e.actorId.slice(0, 8)}` : ""}
                        </span>
                        {e.note ? (
                          <span className="block text-xs font-normal text-zinc-500">{e.note}</span>
                        ) : null}
                        {Object.keys(e.metadata).length > 0 ? (
                          <span className="block text-xs font-normal text-zinc-500">
                            {Object.entries(e.metadata)
                              .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
                              .join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs whitespace-nowrap text-zinc-500">
                        {new Date(e.createdAt).toLocaleString("en-IN", {
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
            )}
          </section>

          {order ? (
            <NotesSection
              entityType="order"
              entityId={order.id}
              initialNotes={notes}
            />
          ) : null}

          <p className="text-sm text-zinc-500">
            <Link href="/admin/orders" className="font-semibold text-brand-700 hover:underline">
              ← Back to orders
            </Link>
          </p>
        </div>
      )}
    </AdminShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/States";
import { ShipmentActions } from "@/components/admin/ShipmentActions";
import { getShipmentDetail } from "@/lib/shipments/service";

export const metadata: Metadata = {
  title: "Shipment detail",
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<string, string> = {
  not_ready: "Not ready",
  ready: "Ready",
  dispatched: "Dispatched",
  in_transit: "In transit",
  delivered: "Delivered",
};

export default async function ShipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let shipment = null;
  try {
    shipment = await getShipmentDetail(id);
  } catch {
    shipment = null;
  }
  if (!shipment) notFound();

  return (
    <AdminShell title="Shipment detail" subtitle="Dispatch tracking and management">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/admin" },
          { label: "Shipments", href: "/admin/shipments" },
          { label: shipment.orderNumber },
        ]}
      />
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900">
            {shipment.orderNumber}
          </h1>
          <span className="inline-flex items-center rounded-md border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-xs font-bold text-zinc-600">
            {STATUS_LABELS[shipment.dispatchStatus] ?? shipment.dispatchStatus}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-label="Shipment details" className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-bold text-zinc-900">Shipment</h2>
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-500">Order</dt>
                <dd>
                  <Link
                    href={`/admin/orders/${shipment.orderId}`}
                    className="font-semibold text-brand-700 hover:underline"
                  >
                    {shipment.orderNumber}
                  </Link>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Customer</dt>
                <dd className="font-semibold text-zinc-900">{shipment.customerName}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Pincode</dt>
                <dd className="font-semibold text-zinc-900">{shipment.deliveryPincode}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Delivery partner</dt>
                <dd className="font-semibold text-zinc-900">
                  {shipment.deliveryPartnerName ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Tracking reference</dt>
                <dd className="font-mono text-xs font-semibold text-zinc-900">
                  {shipment.trackingReference ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Dispatched at</dt>
                <dd className="text-zinc-700">
                  {shipment.dispatchedAt
                    ? new Date(shipment.dispatchedAt).toLocaleString("en-IN")
                    : "—"}
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
              <div className="flex justify-between">
                <dt className="text-zinc-500">Delivered at</dt>
                <dd className="text-zinc-700">
                  {shipment.deliveredAt
                    ? new Date(shipment.deliveredAt).toLocaleString("en-IN")
                    : "—"}
                </dd>
              </div>
              {shipment.dispatchNotes ? (
                <div className="mt-2 border-t border-zinc-100 pt-2">
                  <dt className="text-zinc-500">Dispatch notes</dt>
                  <dd className="mt-1 text-sm text-zinc-700">{shipment.dispatchNotes}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section aria-label="Actions" className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-bold text-zinc-900">Actions</h2>
            <div className="mt-3">
              <ShipmentActions shipmentId={shipment.id} currentStatus={shipment.dispatchStatus} />
            </div>
          </section>
        </div>

        <p className="text-sm text-zinc-500">
          <Link href="/admin/shipments" className="font-semibold text-brand-700 hover:underline">
            ← Back to shipments
          </Link>
        </p>
      </div>
    </AdminShell>
  );
}

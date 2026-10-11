import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/States";
import { listShipments } from "@/lib/shipments/service";
import type { ShipmentStatus } from "@/lib/shipments/types";

export const metadata: Metadata = {
  title: "Shipments",
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  not_ready: "Not ready",
  ready: "Ready",
  dispatched: "Dispatched",
  in_transit: "In transit",
  delivered: "Delivered",
};

const PAGE_SIZE = 15;

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const status = first(sp["status"]) as ShipmentStatus | "";
  const search = first(sp["search"]);
  const page = Number(first(sp["page"]));

  let result: Awaited<ReturnType<typeof listShipments>> = { shipments: [], total: 0 };
  try {
    result = await listShipments({
      status: status || undefined,
      search: search || undefined,
      page: Number.isInteger(page) && page >= 1 ? page : 1,
      pageSize: PAGE_SIZE,
    });
  } catch {
    result = { shipments: [], total: 0 };
  }

  const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / PAGE_SIZE);

  return (
    <AdminShell title="Shipments" subtitle="Track and manage order dispatch">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/admin" },
          { label: "Shipments" },
        ]}
      />
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <form method="GET" className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              name="search"
              placeholder="Search by order number..."
              defaultValue={search}
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm"
            />
            <select
              name="status"
              defaultValue={status}
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm"
            >
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABELS) as ShipmentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="h-10 rounded-md bg-brand-800 px-4 text-sm font-bold text-white hover:bg-brand-700"
            >
              Filter
            </button>
          </form>
        </div>

        {result.shipments.length === 0 ? (
          <EmptyState
            title="No shipments found"
            message="Shipments appear here when orders are ready for dispatch."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-bold text-zinc-900">Order</th>
                  <th className="px-4 py-3 font-bold text-zinc-900">Customer</th>
                  <th className="px-4 py-3 font-bold text-zinc-900">Pincode</th>
                  <th className="px-4 py-3 font-bold text-zinc-900">Partner</th>
                  <th className="px-4 py-3 font-bold text-zinc-900">Status</th>
                  <th className="px-4 py-3 font-bold text-zinc-900">Tracking</th>
                  <th className="px-4 py-3 font-bold text-zinc-900">Dispatched</th>
                  <th className="px-4 py-3 font-bold text-zinc-900">Expected</th>
                </tr>
              </thead>
              <tbody>
                {result.shipments.map((s) => (
                  <tr key={s.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/shipments/${s.id}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {s.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-700">{s.customerName}</td>
                    <td className="px-4 py-3 text-zinc-700">{s.deliveryPincode}</td>
                    <td className="px-4 py-3 text-zinc-700">{s.deliveryPartnerName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-md border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs font-bold text-zinc-600">
                        {STATUS_LABELS[s.dispatchStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-700">
                      {s.trackingReference ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {s.dispatchedAt
                        ? new Date(s.dispatchedAt).toLocaleDateString("en-IN")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {s.expectedDeliveryDate
                        ? new Date(s.expectedDeliveryDate).toLocaleDateString("en-IN")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 ? (
          <div className="flex justify-center gap-2">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Link
                key={p}
                href={`/admin/shipments?page=${p}${status ? `&status=${status}` : ""}${search ? `&search=${search}` : ""}`}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm font-bold ${
                  p === (Number.isInteger(page) && page >= 1 ? page : 1)
                    ? "border-brand-700 bg-brand-50 text-brand-700"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                {p}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}

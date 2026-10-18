import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { EmptyState } from "@/components/ui/States";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/StatusBadge";
import {
  listAdminOrders,
  parseAdminOrderQuery,
} from "@/lib/admin/orders";
import { formatMoney } from "@/lib/orders/pricing";
import { DeleteOrderButton } from "@/components/admin/DeleteOrderButton";

export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false, follow: false },
};

const PAYMENT_OPTIONS = ["pending", "submitted", "paid", "failed", "cancelled", "refunded"];
const STATUS_OPTIONS = [
  "draft", "pending_payment", "payment_submitted", "paid", "confirmed",
  "processing", "packed", "ready_for_dispatch", "shipped", "dispatched",
  "delivered", "cancelled",
];
const SORT_OPTIONS = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["total_desc", "Total: high to low"],
  ["total_asc", "Total: low to high"],
] as const;

function adminOrdersHref(
  base: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
  page?: number,
): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v) params.set(k, v);
  }
  if (page !== undefined && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs === "" ? "/admin/orders" : `/admin/orders?${qs}`;
}

/** Paginated, searchable, filterable order list (server-rendered). */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = parseAdminOrderQuery(sp);
  let result = null;
  let loadError: string | null = null;
  try {
    result = await listAdminOrders(query);
  } catch {
    loadError = "Could not load orders.";
  }

  const base: Record<string, string | undefined> = {
    q: query.q,
    payment: query.paymentStatus,
    status: query.orderStatus,
    from: query.from?.slice(0, 10),
    to: query.to?.slice(0, 10),
    sort: query.sort === "newest" ? undefined : query.sort,
  };
  const selectCls =
    "h-10 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-brand-700";

  return (
    <AdminShell
      title="Orders"
      subtitle="Search, filter and manage customer orders"
      actions={
        <a
          href="/api/admin/export/orders"
          download
          className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
        >
          Export CSV
        </a>
      }
    >
      <form
        method="get"
        action="/admin/orders"
        aria-label="Search and filter orders"
        className="rounded-lg border border-zinc-200 bg-white p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-sm font-semibold text-zinc-800">
              Search
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={query.q ?? ""}
              placeholder="Order number, name, phone…"
              className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none placeholder:text-zinc-400 focus:border-brand-700"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="payment" className="text-sm font-semibold text-zinc-800">
              Payment status
            </label>
            <select id="payment" name="payment" defaultValue={query.paymentStatus ?? ""} className={selectCls}>
              <option value="">All</option>
              {PAYMENT_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="status" className="text-sm font-semibold text-zinc-800">
              Order status
            </label>
            <select id="status" name="status" defaultValue={query.orderStatus ?? ""} className={selectCls}>
              <option value="">All</option>
              {STATUS_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="from" className="text-sm font-semibold text-zinc-800">
              From date
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={query.from?.slice(0, 10) ?? ""}
              className={selectCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="to" className="text-sm font-semibold text-zinc-800">
              To date
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={query.to?.slice(0, 10) ?? ""}
              className={selectCls}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sort" className="text-sm font-semibold text-zinc-800">
              Sort
            </label>
            <select id="sort" name="sort" defaultValue={query.sort} className={selectCls}>
              {SORT_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="submit"
            className="inline-flex h-10 cursor-pointer items-center rounded-md bg-brand-800 px-4 text-sm font-bold text-white hover:bg-brand-700"
          >
            Apply
          </button>
          <Link
            href="/admin/orders"
            className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Clear
          </Link>
        </div>
      </form>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
        {loadError || !result ? (
          <div role="alert">
            <p className="font-bold text-red-800">Couldn&apos;t load orders.</p>
          </div>
        ) : result.orders.length === 0 ? (
          <EmptyState
            title="No orders found"
            message="Try different search terms or clear the filters."
          />
        ) : (
          <>
            <p role="status" className="mb-3 text-sm text-zinc-600">
              {result.total} {result.total === 1 ? "order" : "orders"}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500 uppercase">
                    <th scope="col" className="py-2 pr-3 font-bold">Order</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Customer</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Date</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Subtotal</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Delivery</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Total</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Payment</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Status</th>
                    <th scope="col" className="py-2 font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {result.orders.map((o) => (
                    <tr key={o.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                      <td className="py-2.5 pr-3 font-bold text-zinc-900">
                        <Link href={`/admin/orders/${o.id}`} className="hover:text-brand-700 hover:underline">
                          {o.orderNumber}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3 text-zinc-700">
                        {o.customerName}
                        <span className="block text-xs text-zinc-500">{o.customerPhone}</span>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-zinc-600">
                        {new Date(o.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-zinc-700">
                        {formatMoney({ amountPaise: o.subtotalPaise, currency: "INR" })}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-zinc-700">
                        {formatMoney({ amountPaise: o.deliveryChargePaise, currency: "INR" })}
                      </td>
                      <td className="py-2.5 pr-3 font-bold whitespace-nowrap text-zinc-900">
                        {formatMoney({ amountPaise: o.totalPaise, currency: "INR" })}
                      </td>
                      <td className="py-2.5 pr-3">
                        <PaymentStatusBadge status={o.paymentStatus} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <OrderStatusBadge status={o.orderStatus} />
                      </td>
                      <td className="py-2.5">
                        <DeleteOrderButton
                          orderId={o.id}
                          orderNumber={o.orderNumber}
                          orderStatus={o.orderStatus}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.totalPages > 1 ? (
              <nav aria-label="Order pages" className="mt-4 flex flex-wrap items-center justify-center gap-3">
                {result.page > 1 ? (
                  <Link
                    href={adminOrdersHref(base, {}, result.page - 1)}
                    className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span aria-disabled="true" className="inline-flex h-10 cursor-not-allowed items-center rounded-md border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-400">
                    ← Previous
                  </span>
                )}
                <p className="text-sm text-zinc-600">
                  Page {result.page} of {result.totalPages}
                </p>
                {result.page < result.totalPages ? (
                  <Link
                    href={adminOrdersHref(base, {}, result.page + 1)}
                    className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                  >
                    Next →
                  </Link>
                ) : (
                  <span aria-disabled="true" className="inline-flex h-10 cursor-not-allowed items-center rounded-md border border-zinc-200 bg-zinc-50 px-4 text-sm font-semibold text-zinc-400">
                    Next →
                  </span>
                )}
              </nav>
            ) : null}
          </>
        )}
      </div>
    </AdminShell>
  );
}

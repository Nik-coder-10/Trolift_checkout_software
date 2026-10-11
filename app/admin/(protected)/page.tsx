import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { Badge } from "@/components/ui/Badge";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { EmptyState } from "@/components/ui/States";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/StatusBadge";
import { getCommandCenterData, type CommandCenterData } from "@/lib/admin/dashboard";
import { signOutAdmin } from "@/lib/auth/actions";
import { priceToPaise } from "@/lib/catalog/products";
import type { OrderStatus, PaymentStatus } from "@/types";

export const metadata: Metadata = {
  title: "Admin Command Center",
  robots: { index: false, follow: false },
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">{value}</p>
    </div>
  );
}

function isOrderStatus(s: string): s is OrderStatus {
  return (
    ["draft","pending_payment","payment_submitted","paid","confirmed","processing",
     "packed","ready_for_dispatch","shipped","dispatched","delivered","cancelled"] as string[]
  ).includes(s);
}

function isPaymentStatus(s: string): s is PaymentStatus {
  return (
    ["pending","submitted","paid","failed","cancelled","refunded"] as string[]
  ).includes(s);
}

const DISPATCH_LABELS: Record<string, string> = {
  not_ready: "Not ready",
  ready: "Ready",
  dispatched: "Dispatched",
  in_transit: "In transit",
  delivered: "Delivered",
};

const TIME_FMT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * Operational command center for Trolift staff. Every number comes from
 * the live database via ONE consolidated RPC (get_admin_command_center)
 * — no fake counts, no widget-level query fan-out. Each queue links to
 * the filtered admin list so staff can act immediately.
 */
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rawPage = Number(Array.isArray(sp["page"]) ? sp["page"][0] : sp["page"]);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  let data: CommandCenterData | null = null;
  let loadError: string | null = null;
  try {
    data = await getCommandCenterData(page);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Dashboard unavailable.";
  }

  const q = data?.queues;
  const claims = q?.claims ?? { count: 0, items: [] };
  const today = data?.today;
  const summary = data?.summary;
  const recent = data?.recent_orders;
  const totalPages =
    recent && recent.page_size > 0 ? Math.ceil(recent.total / recent.page_size) : 0;

  const queues: Array<{
    key: string;
    label: string;
    count: number;
    href: string;
    tone: "danger" | "warning" | "neutral";
    empty: string;
  }> = [
    {
      key: "claims",
      label: "Payment claims to verify",
      count: claims.count,
      href: "/admin/orders?payment=submitted",
      tone: "warning",
      empty: "All caught up — no payment claims require review.",
    },
    {
      key: "confirmed",
      label: "Newly confirmed orders",
      count: q?.confirmed.count ?? 0,
      href: "/admin/orders?status=confirmed",
      tone: "neutral",
      empty: "No confirmed orders waiting to be processed.",
    },
    {
      key: "paid",
      label: "Awaiting processing",
      count: q?.paid.count ?? 0,
      href: "/admin/orders?status=paid",
      tone: "neutral",
      empty: "No paid orders awaiting processing.",
    },
    {
      key: "processing",
      label: "Awaiting packing",
      count: q?.processing.count ?? 0,
      href: "/admin/orders?status=processing",
      tone: "neutral",
      empty: "Nothing needs packing right now.",
    },
    {
      key: "ready_for_dispatch",
      label: "Ready for dispatch",
      count: q?.ready_for_dispatch.count ?? 0,
      href: "/admin/orders?status=ready_for_dispatch",
      tone: "neutral",
      empty: "Dispatch queue is clear.",
    },
    {
      key: "delayed",
      label: "Delayed shipments",
      count: q?.delayed_shipments.count ?? 0,
      href: "/admin/shipments",
      tone: "danger",
      empty: "No shipments are past their expected delivery date.",
    },
    {
      key: "low_stock",
      label: "Low / out of stock",
      count: q?.low_stock.count ?? 0,
      href: "/admin/products",
      tone: "warning",
      empty: "Stock levels are healthy across the catalogue.",
    },
    {
      key: "failed",
      label: "Failed payments (7 days)",
      count: q?.failed_payments.count ?? 0,
      href: "/admin/orders?payment=failed",
      tone: "danger",
      empty: "No payment failures in the last 7 days.",
    },
  ];

  const attentionTotal = queues.reduce((n, item) => n + item.count, 0);

  const quickActions: Array<{ label: string; href: string; external?: boolean }> = [
    { label: "View pending payments", href: "/admin/orders?payment=submitted" },
    { label: "View new orders", href: "/admin/orders?status=confirmed" },
    { label: "View dispatch queue", href: "/admin/orders?status=ready_for_dispatch" },
    { label: "Add product", href: "/admin/products/new" },
    { label: "Import products", href: "/admin/products" },
    { label: "Import delivery rates", href: "/admin/delivery" },
    { label: "Export orders", href: "/api/admin/export/orders", external: true },
  ];

  return (
    <AdminShell
      title="Command center"
      subtitle="What needs attention right now"
      actions={
        <form action={signOutAdmin}>
          <button
            type="submit"
            className="inline-flex h-9 cursor-pointer items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Sign out
          </button>
        </form>
      }
    >
      {loadError || !data ? (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-5">
          <p className="font-bold text-red-800">Dashboard unavailable</p>
          <p className="mt-1 text-sm text-red-700">
            Could not load live data. Check the Supabase configuration and try again.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* ── Needs attention ─────────────────────────────────────── */}
          <section aria-label="Needs attention">
            <h2 className="mb-1 text-base font-bold text-zinc-900">
              Needs attention
              {attentionTotal > 0 ? (
                <span className="ml-2 rounded bg-red-100 px-2 py-0.5 align-middle text-xs font-bold text-red-900">
                  {attentionTotal} open {attentionTotal === 1 ? "item" : "items"}
                </span>
              ) : (
                <span className="ml-2 align-middle text-xs font-semibold text-emerald-700">
                  All clear
                </span>
              )}
            </h2>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {queues.map((queue) => {
                const busy = queue.count > 0;
                return (
                  <div
                    key={queue.key}
                    className={`flex flex-col rounded-lg border bg-white p-4 ${
                      busy
                        ? queue.tone === "danger"
                          ? "border-red-300"
                          : queue.tone === "warning"
                            ? "border-amber-300"
                            : "border-zinc-300"
                        : "border-zinc-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">
                        {queue.label}
                      </p>
                      <span
                        className={`rounded px-2 py-0.5 text-sm font-extrabold ${
                          busy
                            ? queue.tone === "danger"
                              ? "bg-red-100 text-red-900"
                              : queue.tone === "warning"
                                ? "bg-amber-100 text-amber-900"
                                : "bg-zinc-100 text-zinc-900"
                            : "bg-zinc-50 text-zinc-400"
                        }`}
                      >
                        {queue.count}
                      </span>
                    </div>
                    {busy ? (
                      <Link
                        href={queue.href}
                        className="mt-3 text-sm font-bold text-brand-800 hover:text-brand-600 hover:underline"
                      >
                        Open queue →
                      </Link>
                    ) : (
                      <p className="mt-3 text-xs text-zinc-500">{queue.empty}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Queue detail: claims + delayed shipments ─────────────── */}
          <section
            aria-label="Payment claims awaiting verification"
            className="rounded-lg border border-amber-300 bg-white p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-zinc-900">
                Payment claims awaiting verification{" "}
                <span className="ml-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                  {claims.count}
                </span>
              </h2>
              <Link
                href="/admin/orders?payment=submitted"
                className="text-sm font-bold text-brand-800 hover:text-brand-600 hover:underline"
              >
                View all →
              </Link>
            </div>
            {claims.items.length === 0 ? (
              <EmptyState
                title="All caught up"
                message="No payment claims require review."
              />
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {claims.items.map((c) => (
                  <li
                    key={`${c.order_id}-${c.reference ?? "noref"}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-zinc-900">
                        <Link href={`/admin/orders/${c.order_id}`} className="hover:text-brand-700 hover:underline">
                          {c.order_number}
                        </Link>{" "}
                        <span className="font-normal text-zinc-500">· {c.customer_name}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        UTR <span className="font-mono font-semibold">{c.reference ?? "—"}</span>
                        {" · "}
                        {new Date(c.submitted_at).toLocaleString("en-IN", TIME_FMT)}
                      </p>
                    </div>
                    <PriceDisplay amountPaise={priceToPaise(c.amount)} size="sm" />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {q && q.delayed_shipments.items.length > 0 ? (
            <section
              aria-label="Delayed shipments"
              className="rounded-lg border border-red-300 bg-white p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold text-zinc-900">
                  Delayed shipments{" "}
                  <span className="ml-1 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-900">
                    {q.delayed_shipments.count}
                  </span>
                </h2>
                <Link
                  href="/admin/shipments"
                  className="text-sm font-bold text-brand-800 hover:text-brand-600 hover:underline"
                >
                  All shipments →
                </Link>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {q.delayed_shipments.items.map((s) => (
                  <li
                    key={s.shipment_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-zinc-900">
                        <Link href={`/admin/shipments/${s.shipment_id}`} className="hover:text-brand-700 hover:underline">
                          {s.order_number}
                        </Link>{" "}
                        <span className="font-normal text-zinc-500">· {s.customer_name}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Expected{" "}
                        {s.expected_delivery_date
                          ? new Date(s.expected_delivery_date).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })
                          : "—"}
                        {" · "}
                        {DISPATCH_LABELS[s.dispatch_status] ?? s.dispatch_status}
                      </p>
                    </div>
                    <Badge tone="danger">Overdue</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {q && q.low_stock.items.length > 0 ? (
            <section
              aria-label="Low stock products"
              className="rounded-lg border border-amber-300 bg-white p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold text-zinc-900">
                  Low stock{" "}
                  <span className="ml-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                    {q.low_stock.count}
                  </span>
                </h2>
                <Link
                  href="/admin/products"
                  className="text-sm font-bold text-brand-800 hover:text-brand-600 hover:underline"
                >
                  Products →
                </Link>
              </div>
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {q.low_stock.items.map((p) => (
                  <li
                    key={p.product_id}
                    className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm"
                  >
                    <Link
                      href={`/admin/products/${p.product_id}`}
                      className="min-w-0 truncate font-bold text-zinc-900 hover:text-brand-700 hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.stock_quantity <= 0 ? (
                      <Badge tone="danger">Out of stock</Badge>
                    ) : (
                      <span className="shrink-0 text-xs font-semibold text-amber-800">
                        {p.stock_quantity} left (min {p.low_stock_threshold})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ── Today's operations ───────────────────────────────────── */}
          <section aria-label="Today's operations">
            <h2 className="mb-2 text-base font-bold text-zinc-900">Today&apos;s operations</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <StatTile label="Orders created" value={String(today?.orders_created ?? 0)} />
              <StatTile label="Payments verified" value={String(today?.payments_verified ?? 0)} />
              <StatTile label="Orders processed" value={String(today?.orders_processed ?? 0)} />
              <StatTile label="Shipments dispatched" value={String(today?.shipments_dispatched ?? 0)} />
              <StatTile label="Deliveries completed" value={String(today?.deliveries_completed ?? 0)} />
            </div>
          </section>

          {/* ── Business summary ─────────────────────────────────────── */}
          <section aria-label="Business summary">
            <h2 className="mb-2 text-base font-bold text-zinc-900">Business summary</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <StatTile label="Total orders" value={String(summary?.total_orders ?? 0)} />
              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">
                  Paid revenue
                </p>
                <div className="mt-1">
                  <PriceDisplay amountPaise={priceToPaise(summary?.paid_revenue ?? "0")} size="md" />
                </div>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">
                  Avg order value
                </p>
                <div className="mt-1">
                  <PriceDisplay amountPaise={priceToPaise(summary?.avg_order_value ?? "0")} size="md" />
                </div>
              </div>
              <StatTile label="Cancelled orders" value={String(summary?.cancelled_orders ?? 0)} />
              <StatTile label="Repeat customers" value={String(summary?.repeat_customers ?? 0)} />
              <StatTile
                label="Low stock"
                value={String((summary?.low_stock_count ?? 0) + (summary?.out_of_stock_count ?? 0))}
              />
            </div>
          </section>

          {/* ── Quick actions ────────────────────────────────────────── */}
          <section aria-label="Quick actions">
            <h2 className="mb-2 text-base font-bold text-zinc-900">Quick actions</h2>
            <div className="flex flex-wrap gap-2">
              {quickActions.map((a) =>
                a.external ? (
                  <a
                    key={a.label}
                    href={a.href}
                    download
                    className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                  >
                    {a.label}
                  </a>
                ) : (
                  <Link
                    key={a.label}
                    href={a.href}
                    className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                  >
                    {a.label}
                  </Link>
                ),
              )}
            </div>
          </section>

          {/* ── Recent orders ────────────────────────────────────────── */}
          <section aria-label="Recent orders" className="rounded-lg border border-zinc-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-zinc-900">Recent orders</h2>
              <Link
                href="/admin/orders"
                className="text-sm font-bold text-brand-800 hover:text-brand-600 hover:underline"
              >
                All orders →
              </Link>
            </div>
            {recent && recent.items.length === 0 ? (
              <EmptyState title="No orders yet" message="Orders appear here as customers check out." />
            ) : (
              <>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-xs text-zinc-500 uppercase">
                        <th scope="col" className="py-2 pr-3 font-bold">Order</th>
                        <th scope="col" className="py-2 pr-3 font-bold">Customer</th>
                        <th scope="col" className="py-2 pr-3 font-bold">Amount</th>
                        <th scope="col" className="py-2 pr-3 font-bold">Payment</th>
                        <th scope="col" className="py-2 pr-3 font-bold">Order status</th>
                        <th scope="col" className="py-2 pr-3 font-bold">Shipment</th>
                        <th scope="col" className="py-2 font-bold">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(recent?.items ?? []).map((o) => (
                        <tr key={o.order_id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                          <td className="py-2.5 pr-3 font-bold text-zinc-900">
                            <Link href={`/admin/orders/${o.order_id}`} className="hover:text-brand-700 hover:underline">
                              {o.order_number}
                            </Link>
                          </td>
                          <td className="py-2.5 pr-3 text-zinc-700">{o.customer_name}</td>
                          <td className="py-2.5 pr-3 font-semibold whitespace-nowrap text-zinc-900">
                            <PriceDisplay amountPaise={priceToPaise(o.total_amount)} size="sm" />
                          </td>
                          <td className="py-2.5 pr-3">
                            {isPaymentStatus(o.payment_status) ? (
                              <PaymentStatusBadge status={o.payment_status} />
                            ) : (
                              <Badge tone="neutral">{o.payment_status}</Badge>
                            )}
                          </td>
                          <td className="py-2.5 pr-3">
                            {isOrderStatus(o.order_status) ? (
                              <OrderStatusBadge status={o.order_status} />
                            ) : (
                              <Badge tone="neutral">{o.order_status}</Badge>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 text-zinc-700">
                            {o.dispatch_status
                              ? (DISPATCH_LABELS[o.dispatch_status] ?? o.dispatch_status)
                              : "—"}
                          </td>
                          <td className="py-2.5 text-xs whitespace-nowrap text-zinc-500">
                            {new Date(o.created_at).toLocaleString("en-IN", TIME_FMT)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {recent && totalPages > 1 ? (
                  <nav aria-label="Recent order pages" className="mt-4 flex items-center justify-center gap-3">
                    {recent.page > 1 ? (
                      <Link
                        href={`/admin?page=${recent.page - 1}`}
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
                      Page {recent.page} of {totalPages} · {recent.total} orders
                    </p>
                    {recent.page < totalPages ? (
                      <Link
                        href={`/admin?page=${recent.page + 1}`}
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
          </section>
        </div>
      )}
    </AdminShell>
  );
}

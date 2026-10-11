import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { EmptyState } from "@/components/ui/States";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/StatusBadge";
import { CustomerForm } from "@/components/admin/CustomerForm";
import { getAdminCustomer } from "@/lib/admin/customers";
import { listStaffNotes } from "@/lib/admin/notes";
import { NotesSection } from "@/components/admin/NotesSection";
import { formatMoney } from "@/lib/orders/pricing";
import { Badge } from "@/components/ui/Badge";
import type { OrderStatus, PaymentStatus } from "@/types";

const ORDER_STATUSES: ReadonlyArray<string> = [
  "draft", "pending_payment", "payment_submitted", "paid", "confirmed",
  "processing", "shipped", "dispatched", "delivered", "cancelled",
];
const PAYMENT_STATUSES: ReadonlyArray<string> = [
  "pending", "submitted", "paid", "failed", "cancelled", "refunded",
];

function asOrderStatus(s: string): OrderStatus | null {
  return (ORDER_STATUSES as ReadonlyArray<OrderStatus>).includes(s as OrderStatus)
    ? (s as OrderStatus)
    : null;
}

function asPaymentStatus(s: string): PaymentStatus | null {
  return (PAYMENT_STATUSES as ReadonlyArray<PaymentStatus>).includes(s as PaymentStatus)
    ? (s as PaymentStatus)
    : null;
}

function PaymentPill({ status }: { status: string }) {
  const s = asPaymentStatus(status);
  return s ? <PaymentStatusBadge status={s} /> : <Badge tone="neutral">{status}</Badge>;
}

function OrderPill({ status }: { status: string }) {
  const s = asOrderStatus(status);
  return s ? <OrderStatusBadge status={s} /> : <Badge tone="neutral">{status}</Badge>;
}

export const metadata: Metadata = {
  title: "Customer detail",
  robots: { index: false, follow: false },
};

/** Customer profile + lifetime summary + snapshot-based order history. */
export default async function AdminCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let detail = null;
  try {
    detail = await getAdminCustomer(id);
  } catch {
    detail = null;
  }
  let notes: Awaited<ReturnType<typeof listStaffNotes>> = [];
  try {
    notes = await listStaffNotes("customer", id);
  } catch {
    notes = [];
  }

  return (
    <AdminShell title="Customer detail" subtitle="Profile, value and order history">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/admin" },
          { label: "Customers", href: "/admin/customers" },
          { label: detail ? detail.customer.name : "Detail" },
        ]}
      />
      {!detail ? (
        <div className="mt-4">
          <EmptyState
            title="Customer not found"
            message="The customer may have been removed, or the link is wrong."
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <section aria-label="Lifetime summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Orders", String(detail.summary.orderCount)],
              ["Paid", String(detail.summary.paidCount)],
              ["Cancelled", String(detail.summary.cancelledCount)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 bg-white p-4">
                <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">{label}</p>
                <p className="mt-1 text-2xl font-extrabold text-zinc-900">{value}</p>
              </div>
            ))}
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">Lifetime paid</p>
              <div className="mt-1">
                <PriceDisplay amountPaise={detail.summary.paidTotalPaise} size="md" />
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {detail.summary.firstOrderAt
                  ? `Since ${new Date(detail.summary.firstOrderAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}`
                  : "No orders yet"}
              </p>
            </div>
          </section>

          <section aria-label="Customer profile" className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-bold text-zinc-900">Current profile</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Editing updates future orders only — historical snapshots stay frozen.
              {detail.customer.gstin ? " GSTIN below is customer-provided, not government-verified." : ""}
            </p>
            <div className="mt-3">
              <CustomerForm
                customerId={detail.customer.id}
                initial={{
                  name: detail.customer.name,
                  phone: detail.customer.phone,
                  email: detail.customer.email ?? "",
                  gstin: detail.customer.gstin ?? "",
                  billing: {
                    name: detail.customer.billing.name ?? "",
                    addressLine: detail.customer.billing.addressLine ?? "",
                    city: detail.customer.billing.city ?? "",
                    stateCode: detail.customer.billing.stateCode ?? "",
                    pincode: detail.customer.billing.pincode ?? "",
                  },
                }}
              />
            </div>
          </section>

          <section aria-label="Order history" className="rounded-lg border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-bold text-zinc-900">
              Order history
              <span className="ml-2 text-xs font-normal text-zinc-500">
                stored snapshots — current catalogue prices never apply here
              </span>
            </h2>
            {detail.orders.length === 0 ? (
              <EmptyState title="No orders yet" message="Orders appear here after checkout." />
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs text-zinc-500 uppercase">
                      <th scope="col" className="py-2 pr-3 font-bold">Order</th>
                      <th scope="col" className="py-2 pr-3 font-bold">Date</th>
                      <th scope="col" className="py-2 pr-3 font-bold">Amount</th>
                      <th scope="col" className="py-2 pr-3 font-bold">Payment</th>
                      <th scope="col" className="py-2 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.orders.map((o) => (
                      <tr key={o.orderId} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                        <td className="py-2.5 pr-3 font-bold text-zinc-900">
                          <Link href={`/admin/orders/${o.orderId}`} className="hover:text-brand-700 hover:underline">
                            {o.orderNumber}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap text-zinc-600">
                          {new Date(o.createdAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td className="py-2.5 pr-3 font-semibold whitespace-nowrap text-zinc-900">
                          {formatMoney({ amountPaise: o.totalPaise, currency: "INR" })}
                        </td>
                        <td className="py-2.5 pr-3">
                          <PaymentPill status={o.paymentStatus} />
                        </td>
                        <td className="py-2.5">
                          <OrderPill status={o.orderStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {detail ? (
            <NotesSection
              entityType="customer"
              entityId={detail.customer.id}
              initialNotes={notes}
            />
          ) : null}
        </div>
      )}
    </AdminShell>
  );
}

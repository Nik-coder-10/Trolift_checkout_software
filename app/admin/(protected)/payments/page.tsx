import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { PaymentActions } from "@/components/admin/PaymentActions";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { EmptyState } from "@/components/ui/States";
import { listPaymentClaims } from "@/lib/admin/orders";

export const metadata: Metadata = {
  title: "Payments",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;

/**
 * Payment-verification inbox: every UTR claim still awaiting review,
 * newest first, with the customer's screenshot inline and the same
 * approve/reject actions as the order detail page. Approving here
 * consumes stock and confirms the order; rejecting returns it to
 * pending_payment — both emit their canonical order_events.
 */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rawPage = Number(Array.isArray(sp["page"]) ? sp["page"][0] : sp["page"]);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  let result: Awaited<ReturnType<typeof listPaymentClaims>> | null = null;
  try {
    result = await listPaymentClaims(page, PAGE_SIZE);
  } catch {
    result = null;
  }

  return (
    <AdminShell
      title="Payments"
      subtitle="UPI claims awaiting verification"
    >
      {result === null ? (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-5">
          <p className="font-bold text-red-800">Couldn&apos;t load payment claims.</p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-zinc-600">
            {result.total === 0
              ? "No claims are waiting."
              : `${result.total} claim${result.total === 1 ? "" : "s"} awaiting verification.`}
          </p>
          {result.claims.length === 0 ? (
            <EmptyState
              title="All caught up"
              message="No payment claims require review."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {result.claims.map((c) => (
                <li
                  key={c.orderId}
                  className="flex flex-wrap items-start gap-4 rounded-lg border border-zinc-200 bg-white p-4"
                >
                  {c.proofPath ? (
                    <a
                      href={`/api/admin/payments/proof?path=${encodeURIComponent(c.proofPath)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/admin/payments/proof?path=${encodeURIComponent(c.proofPath)}`}
                        alt={`Payment screenshot for ${c.orderNumber}`}
                        loading="lazy"
                        className="h-24 w-28 rounded-md border border-zinc-200 object-cover"
                      />
                    </a>
                  ) : (
                    <div
                      aria-label="No screenshot attached"
                      className="flex h-24 w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 text-center text-xs text-zinc-400"
                    >
                      No screenshot
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <Link
                        href={`/admin/orders/${c.orderId}`}
                        className="font-bold text-zinc-900 hover:text-brand-700 hover:underline"
                      >
                        {c.orderNumber}
                      </Link>
                      <span className="text-sm text-zinc-600">
                        {c.customerName} · {c.customerPhone}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-sm font-semibold text-zinc-900">
                      {c.reference !== null
                        ? `UTR: ${c.reference}`
                        : "No UTR — screenshot only"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Submitted {new Date(c.createdAt).toLocaleString("en-IN", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <p className="mt-1">
                      <PriceDisplay amountPaise={c.totalPaise} size="sm" />
                    </p>
                  </div>
                  <div className="shrink-0">
                    <PaymentActions orderId={c.orderId} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {result.totalPages > 1 ? (
            <nav aria-label="Payment claim pages" className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {result.page > 1 ? (
                <Link
                  href={`/admin/payments?page=${result.page - 1}`}
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
                  href={`/admin/payments?page=${result.page + 1}`}
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
    </AdminShell>
  );
}

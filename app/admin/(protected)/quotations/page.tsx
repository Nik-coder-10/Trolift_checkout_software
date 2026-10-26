import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import {
  listManualQuotations,
  type ManualQuotationSummary,
} from "@/lib/quotations/manual-service";
import { formatMoney } from "@/lib/orders/pricing";

export const metadata: Metadata = {
  title: "Quotations",
  robots: { index: false, follow: false },
};

const PARTY_LABEL: Record<ManualQuotationSummary["partyType"], string> = {
  dealer: "Dealer",
  distributor: "Distributor",
  customer: "Customer",
};

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

/** Quotation maker index: issued manual quotations, newest first. */
export default async function AdminQuotationsPage() {
  const quotations = await listManualQuotations().catch((): null => null);

  return (
    <AdminShell
      title="Quotations"
      subtitle="Hand-made offers for dealers, distributors and customers"
      actions={
        <Link
          href="/admin/quotations/new"
          className="inline-flex h-9 items-center rounded-md bg-brand-800 px-3 text-sm font-bold text-white hover:bg-brand-700"
        >
          + New quotation
        </Link>
      }
    >
      <div className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
        {quotations === null ? (
          <div role="alert">
            <p className="font-bold text-red-800">Couldn&apos;t load quotations.</p>
          </div>
        ) : quotations.length === 0 ? (
          <EmptyState
            title="No quotations yet"
            message="Use the quotation maker to prepare an offer at your own prices for a dealer, distributor or customer."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 uppercase">
                  <th scope="col" className="py-2 pr-3 font-bold">Quote no</th>
                  <th scope="col" className="py-2 pr-3 font-bold">Party</th>
                  <th scope="col" className="py-2 pr-3 font-bold">Date</th>
                  <th scope="col" className="py-2 pr-3 font-bold">Valid till</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Total</th>
                  <th scope="col" className="py-2 font-bold">PDF</th>
                </tr>
              </thead>
              <tbody>
                {quotations.map((q) => (
                  <tr
                    key={q.id}
                    className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="py-2.5 pr-3 font-mono text-xs whitespace-nowrap">
                      <Link
                        href={`/admin/quotations/${q.id}`}
                        className="font-bold text-brand-700 hover:underline"
                      >
                        {q.quotationNumber}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <Link
                          href={`/admin/quotations/${q.id}`}
                          className="font-bold text-zinc-900 hover:text-brand-700 hover:underline"
                        >
                          {q.partyName}
                        </Link>
                        <Badge tone="neutral">{PARTY_LABEL[q.partyType]}</Badge>
                      </span>
                      {q.partyPhone ? (
                        <span className="block text-xs text-zinc-500">
                          {q.partyPhone}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-zinc-700">
                      {shortDate(q.quotationDate)}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-zinc-700">
                      {shortDate(q.validTill)}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold whitespace-nowrap">
                      {formatMoney({ amountPaise: q.totalPaise, currency: "INR" })}
                    </td>
                    <td className="py-2.5 whitespace-nowrap">
                      <a
                        href={`/api/admin/quotations/${q.id}/pdf`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

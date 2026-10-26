import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { Badge } from "@/components/ui/Badge";
import { AppError } from "@/lib/api/errors";
import { getManualQuotation } from "@/lib/quotations/manual-service";
import { formatMoney } from "@/lib/orders/pricing";

export const metadata: Metadata = {
  title: "Quotation",
  robots: { index: false, follow: false },
};

const money = (paise: number) => formatMoney({ amountPaise: paise, currency: "INR" });

const PARTY_LABEL: Record<string, string> = {
  dealer: "Dealer",
  distributor: "Distributor",
  customer: "Customer",
};

function day(iso: string): string {
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

/**
 * One manual quotation, rendered from its frozen document. Reprints and
 * this page always show the same figures: the stored JSON is immutable.
 */
export default async function ManualQuotationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let loaded;
  try {
    loaded = await getManualQuotation(id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  const { summary, data } = loaded;

  return (
    <AdminShell
      title={summary.quotationNumber}
      subtitle={`${PARTY_LABEL[summary.partyType] ?? "Party"} quotation · ${day(
        summary.quotationDate,
      )}`}
      activeHref="/admin/quotations"
      actions={
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/admin/quotations/${summary.id}/pdf`}
            className="inline-flex h-9 items-center rounded-md bg-brand-800 px-3 text-sm font-bold text-white hover:bg-brand-700"
          >
            Download PDF
          </a>
          <a
            href={`/api/admin/quotations/${summary.id}/pdf?disposition=inline`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Open in browser
          </a>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <section className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-bold tracking-wide text-zinc-500 uppercase">
                Prepared for
              </p>
              <p className="text-lg font-extrabold text-zinc-900">{summary.partyName}</p>
              <p className="text-sm text-zinc-600">
                {summary.partyPhone ?? "—"}
                {data.customer.email ? ` · ${data.customer.email}` : ""}
              </p>
              {summary.partyGstin ? (
                <p className="font-mono text-xs text-zinc-500">
                  GSTIN {summary.partyGstin}
                </p>
              ) : null}
            </div>
            <div className="text-sm text-zinc-600">
              <p>
                <Badge tone="neutral">
                  {PARTY_LABEL[summary.partyType] ?? "Party"}
                </Badge>
              </p>
              <p className="mt-2">
                Issued on <strong>{day(summary.quotationDate)}</strong>
              </p>
              <p>
                Valid till <strong>{day(summary.validTill)}</strong>
              </p>
              <p>
                Place of supply <strong>{data.placeOfSupply ?? "—"}</strong>
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
          <h2 className="text-base font-bold text-zinc-900">Items</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 uppercase">
                  <th scope="col" className="py-2 pr-3 font-bold">#</th>
                  <th scope="col" className="py-2 pr-3 font-bold">Item</th>
                  <th scope="col" className="py-2 pr-3 font-bold">HSN</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Qty</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">Rate</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">GST %</th>
                  <th scope="col" className="py-2 pr-3 text-right font-bold">GST</th>
                  <th scope="col" className="py-2 text-right font-bold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.serial} className="border-b border-zinc-100">
                    <td className="py-2 pr-3 text-zinc-500">{item.serial}</td>
                    <td className="py-2 pr-3">
                      <span className="font-semibold text-zinc-900">{item.name}</span>
                      {item.description ? (
                        <span className="block text-xs text-zinc-500">
                          {item.description}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-zinc-600">
                      {item.hsn ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right">{item.quantity}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {money(item.unitPricePaise)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {item.gstRate === null ? "—" : `${item.gstRate}%`}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {money(item.taxPaise)}
                    </td>
                    <td className="py-2 text-right font-semibold whitespace-nowrap">
                      {money(item.lineTotalPaise)}
                    </td>
                  </tr>
                ))}
                <tr className="border-b border-zinc-100">
                  <td className="py-2 pr-3 text-zinc-500">—</td>
                  <td className="py-2 pr-3">
                    <span className="font-semibold text-zinc-900">
                      {data.cartage.name}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {data.cartage.description}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-zinc-600">
                    {data.cartage.sac ?? "—"}
                  </td>
                  <td className="py-2 pr-3 text-right">1</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    {money(data.cartage.chargePaise)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {data.cartage.gstRate === null ? "—" : `${data.cartage.gstRate}%`}
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    {money(data.cartage.taxPaise)}
                  </td>
                  <td className="py-2 text-right font-semibold whitespace-nowrap">
                    {money(data.cartage.lineTotalPaise)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <dl className="mt-4 ml-auto flex max-w-sm flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-600">Taxable value</dt>
              <dd>{money(data.totals.taxablePaise)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-600">Delivery</dt>
              <dd>{money(data.totals.deliveryPaise)}</dd>
            </div>
            {data.totals.cgstPaise > 0 || data.totals.sgstPaise > 0 ? (
              <>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">CGST</dt>
                  <dd>{money(data.totals.cgstPaise)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">SGST</dt>
                  <dd>{money(data.totals.sgstPaise)}</dd>
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <dt className="text-zinc-600">IGST</dt>
                <dd>{money(data.totals.igstPaise)}</dd>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-zinc-200 pt-1.5 text-base">
              <dt className="font-bold text-zinc-900">Total</dt>
              <dd className="font-extrabold text-zinc-900">
                {money(data.totals.grandTotalPaise)}
              </dd>
            </div>
          </dl>
        </section>

        <p className="text-sm">
          <Link
            href="/admin/quotations"
            className="font-semibold text-brand-700 hover:underline"
          >
            ← All quotations
          </Link>
          <span className="text-zinc-500">
            {" "}
            · This quotation is frozen: reprints always match what was issued.
          </span>
        </p>
      </div>
    </AdminShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/layout/admin/AdminShell";
import { QuotationMaker } from "@/components/admin/QuotationMaker";
import { INDIAN_STATES, getBusinessStateCode } from "@/lib/tax/india";
import {
  getDeliveryGstRate,
  getQuotationValidityDays,
} from "@/lib/quotations/config";

export const metadata: Metadata = {
  title: "Quotation maker",
  robots: { index: false, follow: false },
};

/**
 * Admin quotation maker: type the party, the prices and the delivery
 * charge yourself, get the same quotation PDF the store issues for an
 * order. Server component — it only wires configuration into the form.
 */
export default async function NewQuotationPage() {
  const stateNames = INDIAN_STATES.map((s) => s.name);
  const validityDays = await getQuotationValidityDays();

  return (
    <AdminShell
      title="Quotation maker"
      subtitle="Dealer, distributor or customer quotes at your own prices"
      activeHref="/admin/quotations"
      actions={
        <Link
          href="/admin/quotations"
          className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          All quotations
        </Link>
      }
    >
      <QuotationMaker
        stateNames={stateNames}
        deliveryGstRate={getDeliveryGstRate()}
        businessStateCode={getBusinessStateCode()}
        defaultValidityDays={validityDays}
      />
    </AdminShell>
  );
}

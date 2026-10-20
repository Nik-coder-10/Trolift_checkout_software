import { Fragment } from "react";
import { DiyaIcon } from "@/components/ui/DiyaIcon";
import { getActiveOffers, type ActiveOffer } from "@/lib/coupons/active";

function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

function isFestive(offer: ActiveOffer): boolean {
  return /DUSSHERA|DIWALI|NAVRATRI|FESTIVE/i.test(offer.code);
}

function displayOrder(offers: ActiveOffer[]): ActiveOffer[] {
  return [...offers]
    .sort(
      (a, b) =>
        Number(isFestive(b)) - Number(isFestive(a)) ||
        Number(a.firstOrderOnly) - Number(b.firstOrderOnly),
    )
    .slice(0, 3);
}

export async function FestiveBanner() {
  let offers: ActiveOffer[] = [];
  try {
    offers = await getActiveOffers();
  } catch {
    offers = [];
  }
  const shown = displayOrder(offers);

  return (
    <aside
      aria-label="Active offers"
      className="relative overflow-hidden bg-brand-950 text-brand-100 print:hidden"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(160px_48px_at_0%_50%,rgba(251,191,36,0.18),transparent),radial-gradient(160px_48px_at_100%_50%,rgba(251,191,36,0.18),transparent)]"
      />
      <div className="relative mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-1.5 text-center text-xs">
        <span className="inline-flex items-center gap-1.5 font-bold text-amber-300">
          <DiyaIcon className="text-amber-400" />
          Active offers
        </span>
        {shown.length > 0 ? (
          <Fragment>
            <span aria-hidden className="text-brand-500">
              ·
            </span>
            {shown.map((offer, i) => (
              <Fragment key={offer.code}>
                {i > 0 ? (
                  <span aria-hidden className="hidden text-brand-500 sm:inline">
                    |
                  </span>
                ) : null}
                <span>
                  {offer.label} — use code{" "}
                  <b className="font-bold text-amber-300">{offer.code}</b> for{" "}
                  {rupees(offer.discountPaise)} off
                  {offer.firstOrderOnly ? " (first order only)" : ""}
                </span>
              </Fragment>
            ))}
          </Fragment>
        ) : (
          <span>
            Dussehra &amp; Early Diwali — transparent pricing &amp; GST invoices on
            every order
          </span>
        )}
      </div>
      <div
        aria-hidden
        className="h-px bg-gradient-to-r from-transparent via-amber-400/45 to-transparent"
      />
    </aside>
  );
}

import Image from "next/image";
import Link from "next/link";
import { Fragment } from "react";
import { DiyaIcon } from "@/components/ui/DiyaIcon";
import { getActiveOffers, type ActiveOffer } from "@/lib/coupons/active";

const STEPS: [string, string][] = [
  ["Pick equipment", "Browse the catalogue with clear, all-inclusive pricing."],
  ["Enter delivery pincode", "We confirm serviceability before you pay."],
  ["Pay on UPI", "Pay the owner directly; every payment is verified."],
  ["Get GST invoice", "Proper billing with your GSTIN on every order."],
] as const;

/**
 * Homepage hero: dimmed warehouse photo behind layered glass panels —
 * proposition card left, ordering steps right, CTAs, ordering facts
 * in the overlapping ProofBand below.
 */
export async function Hero() {
  let offers: ActiveOffer[] = [];
  try {
    offers = await getActiveOffers();
  } catch {
    offers = [];
  }
  const shown = offers.slice(0, 3);
  const festive = shown.some((o) => /DUSSHERA|DIWALI|NAVRATRI|FESTIVE/i.test(o.code));
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative isolate overflow-hidden bg-brand-950 text-cream"
    >
      <Image
        src="/images/home-hero.jpg"
        alt=""
        aria-hidden
        fill
        priority
        sizes="100vw"
        quality={80}
        className="object-cover object-[70%_35%]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-brand-950/90 via-brand-950/80 to-brand-950/95"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -left-16 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl"
      />
      <div className="relative mx-auto grid w-full max-w-6xl gap-6 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[1.35fr_1fr] lg:items-start lg:gap-8 lg:py-20">
        <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-6 shadow-2xl shadow-brand-950/40 backdrop-blur-md sm:p-8">
          <p className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold tracking-[0.14em] text-amber-300 uppercase">
            B2B Industrial Equipment
          </p>
          <h1
            id="hero-heading"
            className="mt-4 text-3xl font-extrabold tracking-tight text-cream drop-shadow-sm sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]"
          >
            Material-handling equipment your shop floor can rely on.
          </h1>
          <div aria-hidden className="mt-3 flex items-center gap-1.5">
            <span className="h-0.5 w-24 rounded-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-400/40 shadow-[0_0_10px_rgba(251,191,36,0.45)]" />
            <span className="diya-flame h-1.5 w-1.5 rounded-full bg-amber-200 shadow-[0_0_8px_rgba(253,230,138,0.9)]" />
            <span
              className="diya-flame h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
              style={{ animationDelay: "0.9s" }}
            />
            <span
              className="diya-flame h-1.5 w-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.7)]"
              style={{ animationDelay: "1.7s" }}
            />
          </div>
          <p className="mt-4 max-w-xl text-base leading-7 text-brand-100">
            Telescopic and A-type ladders, platform trolleys and more —
            with transparent pricing, GST invoicing and delivery verified
            by pincode before you pay.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/products"
              className="inline-flex h-12 cursor-pointer items-center justify-center rounded-md border border-amber-500/0 bg-amber-400 px-6 text-base font-bold text-brand-950 shadow-lg shadow-amber-400/20 transition-colors hover:border-amber-500/70 hover:bg-amber-300"
            >
              Browse products
            </Link>
            <Link
              href="#contact"
              className="inline-flex h-12 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 px-6 text-base font-bold text-cream backdrop-blur-sm transition-colors hover:border-amber-300/50 hover:bg-amber-400/10"
            >
              Talk to sales
            </Link>
          </div>
          {shown.length > 0 ? (
            <p className="mt-4 inline-flex w-fit flex-wrap items-center gap-2 rounded-md border border-amber-300/25 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200">
              <DiyaIcon size={12} className="text-amber-300" />
              {festive ? "Festive pricing live" : "Active offers"} — apply{" "}
              {shown.map((offer, i) => (
                <Fragment key={offer.code}>
                  {i > 0 ? <span className="text-amber-300/70">or</span> : null}
                  <b className="font-bold text-amber-300">{offer.code}</b>
                </Fragment>
              ))}{" "}
              at checkout
            </p>
          ) : null}
        </div>
        <aside
          aria-label="How ordering works"
          className="rounded-2xl border border-white/15 bg-white/[0.08] p-6 shadow-2xl shadow-brand-950/40 backdrop-blur-md"
        >
          <p className="border-b border-white/15 pb-3 text-xs font-bold tracking-[0.14em] text-brand-100 uppercase">
            How ordering works
          </p>
          <ol className="mt-4 flex flex-col gap-4">
            {STEPS.map(([title, desc], i) => (
              <li key={title} className="flex gap-3">
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-brand-950 shadow-[0_0_10px_rgba(251,191,36,0.55)]"
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-bold text-cream">{title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-brand-100">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}

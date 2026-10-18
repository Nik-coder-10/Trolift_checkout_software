import Image from "next/image";
import Link from "next/link";

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
export function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative isolate overflow-hidden bg-brand-950 text-white"
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
      <div className="relative mx-auto grid w-full max-w-6xl gap-6 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[1.35fr_1fr] lg:items-start lg:gap-8 lg:py-20">
        <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-6 shadow-2xl shadow-brand-950/40 backdrop-blur-md sm:p-8">
          <p className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold tracking-[0.14em] text-amber-300 uppercase">
            B2B Industrial Equipment
          </p>
          <h1
            id="hero-heading"
            className="mt-4 text-3xl font-extrabold tracking-tight text-white drop-shadow-sm sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]"
          >
            Material-handling equipment your shop floor can rely on.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-brand-100">
            Telescopic and A-type ladders, platform trolleys and more —
            with transparent pricing, GST invoicing and delivery verified
            by pincode before you pay.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/products"
              className="inline-flex h-12 cursor-pointer items-center justify-center rounded-md bg-amber-400 px-6 text-base font-bold text-brand-950 shadow-lg shadow-amber-400/20 transition-colors hover:bg-amber-300"
            >
              Browse products
            </Link>
            <Link
              href="#contact"
              className="inline-flex h-12 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 px-6 text-base font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
            >
              Talk to sales
            </Link>
          </div>
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
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-brand-950"
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-bold text-white">{title}</p>
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

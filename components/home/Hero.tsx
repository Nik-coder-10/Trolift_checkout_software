import Link from "next/link";

/**
 * Homepage hero: flat navy panel, amber rule, proposition + CTAs +
 * at-a-glance buying facts. No gradients, no animation.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="bg-brand-900 text-white">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <p className="inline-flex items-center gap-2 rounded border border-brand-700 bg-brand-800 px-3 py-1 text-xs font-bold tracking-[0.14em] text-amber-400 uppercase">
            B2B Industrial Equipment
          </p>
          <h1 id="hero-heading" className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
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
              className="inline-flex h-12 items-center justify-center rounded-md bg-amber-400 px-6 text-base font-bold text-brand-950 hover:bg-amber-300"
            >
              Browse products
            </Link>
            <Link
              href="#contact"
              className="inline-flex h-12 items-center justify-center rounded-md border border-brand-600 bg-transparent px-6 text-base font-bold text-white hover:bg-brand-800"
            >
              Talk to sales
            </Link>
          </div>
          <dl className="mt-8 grid max-w-xl grid-cols-1 gap-3 border-t border-brand-800 pt-6 sm:grid-cols-3 sm:gap-4">
            {(
              [
                ["GST invoice", "on every order"],
                ["Pincode-checked", "delivery verified pre-payment"],
                ["Volume pricing", "available on request"],
              ] as [string, string][]
            ).map(([term, desc]) => (
              <div key={term}>
                <dt className="text-sm font-bold text-white">{term}</dt>
                <dd className="mt-0.5 text-xs leading-5 text-brand-200">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>
        <aside aria-label="Ordering snapshot" className="rounded-lg bg-white p-5 text-zinc-900">
          <p className="border-b-2 border-amber-400 pb-2 text-xs font-bold tracking-[0.14em] text-zinc-500 uppercase">
            How ordering works
          </p>
          <ol className="mt-3 flex flex-col gap-3">
            {(
              [
                ["Pick equipment", "Browse the catalogue with clear, GST-exclusive pricing."],
                ["Enter delivery pincode", "We check serviceability and freight before you pay."],
              ["Pay on UPI", "Pay the owner directly; every payment is verified."],
              ["Get GST invoice", "Proper billing with your GSTIN on every order."],
              ] as [string, string][]
            ).map(([title, desc], i) => (
              <li key={title} className="flex gap-3">
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-brand-800 text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-bold">{title}</p>
                  <p className="text-xs leading-5 text-zinc-600">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}

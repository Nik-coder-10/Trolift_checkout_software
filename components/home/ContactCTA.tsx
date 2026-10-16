import Link from "next/link";

/**
 * Contact CTA band: what to share for a fast quote (equipment,
 * quantity, delivery pincode, optional GSTIN) plus catalogue links.
 * No messaging integrations — sales contact details are configured
 * at checkout/admin time in later phases.
 */
export function ContactCTA() {
  return (
    <section aria-labelledby="contact-heading" id="contact" className="scroll-mt-20 rounded-lg bg-brand-800 p-6 text-white sm:p-8">
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-amber-400 uppercase">Contact sales</p>
          <h2 id="contact-heading" className="mt-1 text-2xl font-extrabold tracking-tight">
            Get a quote for your site
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-brand-100">
            Share the equipment, quantity and delivery pincode — add your
            GSTIN if you need a GST invoice. We reply with price and
            delivery time.
          </p>
          <ul className="mt-4 grid gap-2 text-sm text-brand-100 sm:grid-cols-3">
            <li className="rounded-md bg-brand-900 px-3 py-2">1. Equipment + quantity</li>
            <li className="rounded-md bg-brand-900 px-3 py-2">2. Delivery pincode</li>
            <li className="rounded-md bg-brand-900 px-3 py-2">3. GSTIN (optional)</li>
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <Link
            href="/products"
            className="inline-flex h-12 items-center justify-center rounded-md bg-amber-400 px-6 text-base font-bold text-brand-950 hover:bg-amber-300"
          >
            Browse the catalogue
          </Link>
          <Link
            href="#featured"
            className="inline-flex h-12 items-center justify-center rounded-md border border-brand-500 px-6 text-base font-bold text-white hover:bg-brand-700"
          >
            Review featured products
          </Link>
        </div>
      </div>
    </section>
  );
}

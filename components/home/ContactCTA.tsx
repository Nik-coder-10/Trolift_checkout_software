import Image from "next/image";
import Link from "next/link";

/**
 * Contact CTA band: dimmed jobsite photo behind glass panels — quote
 * checklist chips left, CTAs right. Not a form; sales contact details
 * are configured at checkout/admin time in later phases.
 */
export function ContactCTA() {
  return (
    <section
      aria-labelledby="contact-heading"
      id="contact"
      className="relative isolate scroll-mt-24 overflow-hidden rounded-2xl bg-brand-950 text-white shadow-xl"
    >
      <Image
        src="/images/home-cta.jpg"
        alt=""
        aria-hidden
        fill
        sizes="(max-width: 1152px) 100vw, 1152px"
        className="object-cover object-[center_30%]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-brand-950/95 via-brand-950/85 to-brand-950/70"
      />
      <div className="relative grid gap-6 p-7 sm:p-9 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-amber-400 uppercase">Contact sales</p>
          <h2 id="contact-heading" className="mt-1 text-2xl font-extrabold tracking-tight text-cream">
            Get a quote for your site
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-brand-100">
            Share the equipment, quantity and delivery pincode — add your
            GSTIN if you need a GST invoice. We reply with price and
            delivery time.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-brand-100">
            {["1. Equipment + quantity", "2. Delivery pincode", "3. GSTIN (optional)"].map(
              (step) => (
                <li
                  key={step}
                  className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 backdrop-blur-sm"
                >
                  {step}
                </li>
              ),
            )}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <Link
            href="/products"
            className="inline-flex h-12 cursor-pointer items-center justify-center rounded-md bg-amber-400 px-6 text-base font-bold text-brand-950 transition-colors hover:bg-amber-300"
          >
            Browse the catalogue
          </Link>
          <Link
            href="#featured"
            className="inline-flex h-12 cursor-pointer items-center justify-center rounded-md border border-white/25 bg-white/10 px-6 text-base font-bold text-cream backdrop-blur-sm transition-colors hover:border-amber-300/50 hover:bg-amber-400/10"
          >
            Review featured products
          </Link>
        </div>
      </div>
    </section>
  );
}

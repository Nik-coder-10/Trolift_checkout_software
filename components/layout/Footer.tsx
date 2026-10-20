import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { slugifyCategory } from "@/lib/catalog/products";

/**
 * Public footer: brand + catalogue + company + buying-info columns,
 * collapsing to one column on mobile. No hard-coded contact details —
 * buying flows route through the contact page.
 */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-brand-950 text-brand-100 print:hidden">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <div className="mb-3 inline-flex items-center rounded-lg bg-white px-2.5 py-1 shadow-xs">
            <Image
              src="/images/logo.png"
              alt={siteConfig.name}
              width={130}
              height={40}
              className="h-8.5 w-auto object-contain"
            />
          </div>
          <p className="mt-2 max-w-xs text-sm leading-6 text-brand-200">
            Industrial material-handling equipment for Indian warehouses,
            plants and workshops — with GST invoicing and pan-India
            delivery.
          </p>
        </div>
        <nav aria-label="Products">
          <p className="text-sm font-bold tracking-wide text-cream uppercase">Equipment</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {["Ladders", "Trolleys"].map((label) => (
              <li key={label}>
                <Link
                  href={`/products?category=${slugifyCategory(label)}`}
                  className="text-brand-200 hover:text-cream hover:underline"
                >
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/products" className="text-brand-200 hover:text-cream hover:underline">
                All products
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Company">
          <p className="text-sm font-bold tracking-wide text-cream uppercase">Company</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {(
              [
                ["Featured products", "/#featured"],
                ["Why Trolift", "/#trust"],
                ["Contact sales", "/contact"],
                ["API health", "/api/health"],
              ] as [string, string][]
            ).map(([label, href]) => (
              <li key={label}>
                <Link href={href} className="text-brand-200 hover:text-cream hover:underline">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="text-sm font-bold tracking-wide text-cream uppercase">Buying info</p>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-brand-200">
            <li>
              <Link href="/orders" className="font-semibold text-amber-400 hover:text-amber-300 hover:underline">
                My orders →
              </Link>
            </li>
            <li>GST invoice on every order</li>
            <li>
              <Link href="/resellers" className="font-semibold text-amber-400 hover:text-amber-300 hover:underline">
                Reseller? Volume pricing on request →
              </Link>
            </li>
            <li>Delivery across India by pincode</li>
            <li>
              <Link href="/contact" className="font-semibold text-amber-400 hover:text-amber-300 hover:underline">
                Request a callback →
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-amber-400/15 bg-amber-400/[0.06]">
        <p className="mx-auto w-full max-w-6xl px-4 py-2 text-center text-xs font-semibold text-amber-200 sm:px-6">
          Celebrate Dussehra &amp; Early Diwali with transparent pricing &amp; GST
          invoices
        </p>
      </div>
      <div className="border-t border-brand-800">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-5 text-xs text-brand-300 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {year} {siteConfig.name}. All rights reserved.
          </p>
          <p>B2B material-handling equipment — {siteConfig.tagline}</p>
        </div>
      </div>
    </footer>
  );
}

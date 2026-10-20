import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { ResellerForm } from "@/components/resellers/ResellerForm";
import { contactConfig } from "@/config/contact";

export const metadata: Metadata = {
  title: "Are you a reseller?",
  description:
    "Reseller and dealer enquiries for Trolift ladders, trolleys and material-handling equipment — share your volumes and cities, our sales team calls back with trade rates.",
};

const WHAT_TO_SEND = [
  "Equipment types + monthly quantities",
  "Delivery cities / pincodes",
  "GSTIN (for GST trade invoices)",
] as const;

const NEXT_STEPS = [
  ["Send your requirements", "Equipment, volumes, cities — in your own words."],
  ["We call you back", "Our sales team discusses fit and trade rates on the phone."],
  ["Tailored quote", "A proper quotation for your volumes, with GST invoicing."],
] as const;

function PhoneIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z" />
    </svg>
  );
}

/**
 * /resellers — the trade door. Resellers do not get a rate card: we
 * do not publish absolute per-item trade prices on the site, so this
 * page collects their requirements and the sales team calls back with
 * tailored rates. Same no-email, callback-first pattern as /contact;
 * the form posts to /api/resellers with its own inbox subject.
 */
export default function ResellersPage() {
  return (
    <Container className="py-10 sm:py-14">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Are you a reseller?" }]} />

      <header className="mt-5 max-w-2xl">
        <p className="text-xs font-bold tracking-[0.14em] text-brand-700 uppercase">
          Resellers &amp; dealers
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
          Are you a reseller?
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          We do not publish trade rates item-by-item on this site — catalogue
          prices are our standard all-inclusive rates. If you buy in volume or
          resell Trolift equipment, share your requirements and our sales team
          will call you back with tailored pricing.
        </p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div className="flex flex-col gap-6">
          <section
            aria-labelledby="reseller-steps-heading"
            className="rounded-lg border border-zinc-200 bg-white p-6"
          >
            <h2
              id="reseller-steps-heading"
              className="text-xl font-extrabold tracking-tight text-zinc-900"
            >
              How it works
            </h2>
            <ol className="mt-4 flex flex-col gap-4">
              {NEXT_STEPS.map(([title, desc], i) => (
                <li key={title} className="flex gap-3">
                  <span
                    aria-hidden
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-brand-950"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-zinc-600">{desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section
            aria-labelledby="reseller-send-heading"
            className="rounded-lg bg-brand-800 p-6 text-white"
          >
            <p className="text-xs font-bold tracking-[0.14em] text-amber-400 uppercase">
              For a faster quote
            </p>
            <h2
              id="reseller-send-heading"
              className="mt-1 text-lg font-extrabold tracking-tight"
            >
              Include these three things
            </h2>
            <ul className="mt-3 grid gap-2 text-sm text-brand-100 sm:grid-cols-3">
              {WHAT_TO_SEND.map((tip) => (
                <li key={tip} className="rounded-md bg-brand-900 px-3 py-2">
                  {tip}
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby="reseller-call-heading"
            className="rounded-lg border border-zinc-200 bg-white p-6"
          >
            <h2
              id="reseller-call-heading"
              className="text-xl font-extrabold tracking-tight text-zinc-900"
            >
              Prefer to call?
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-zinc-600">
              Tap a number to dial straight from your phone.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {contactConfig.phones.map((line) => (
                <a
                  key={line.tel}
                  href={`tel:${line.tel}`}
                  aria-label={`Call Trolift on ${line.display}`}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-brand-900 px-5 text-base font-bold text-white shadow-xs transition-transform hover:scale-[1.01] hover:bg-brand-800"
                >
                  <PhoneIcon />
                  {line.display}
                </a>
              ))}
            </div>
          </section>
        </div>

        <ResellerForm />
      </div>
    </Container>
  );
}

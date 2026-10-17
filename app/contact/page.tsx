import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { QueryForm } from "@/components/contact/QueryForm";
import { contactConfig } from "@/config/contact";

export const metadata: Metadata = {
  title: "Contact",
  description: `Call Trolift Solutions on ${contactConfig.phones
    .map((p) => p.display)
    .join(", ")} or send your query to ${contactConfig.email} — sales and support for ladders, trolleys and material-handling equipment.`,
};

const QUOTE_TIPS = [
  "Equipment + quantity",
  "Delivery pincode",
  "GSTIN (if you need a GST invoice)",
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
 * /contact — the direct line: tap-to-call numbers, the ops inbox, and
 * the query form whose submissions are emailed to us (the visitor
 * never supplies an address). The form column is the client component;
 * everything here renders server-side.
 */
export default function ContactPage() {
  return (
    <Container className="py-10 sm:py-14">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Contact" }]} />

      <header className="mt-5 max-w-2xl">
        <p className="text-xs font-bold tracking-[0.14em] text-brand-700 uppercase">
          Contact
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
          Talk to Trolift
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          Call us and you are connected in one tap, or send your query with the
          form — it goes straight to our inbox, no email address required.
        </p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div className="flex flex-col gap-6">
          <section
            aria-labelledby="contact-call-heading"
            className="rounded-lg border border-zinc-200 bg-white p-6"
          >
            <h2
              id="contact-call-heading"
              className="text-xl font-extrabold tracking-tight text-zinc-900"
            >
              Call us — one tap connects you
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

          <section
            aria-labelledby="contact-mail-heading"
            className="rounded-lg border border-zinc-200 bg-white p-6"
          >
            <h2
              id="contact-mail-heading"
              className="text-xl font-extrabold tracking-tight text-zinc-900"
            >
              Email us
            </h2>
            <a
              href={`mailto:${contactConfig.email}`}
              className="mt-2 inline-block text-base font-bold text-brand-700 hover:underline"
            >
              {contactConfig.email}
            </a>
            <p className="mt-1.5 text-sm leading-6 text-zinc-600">
              Queries sent with the form on this page arrive in this same inbox,
              so either route reaches the team.
            </p>
          </section>

          <section
            aria-labelledby="contact-quote-heading"
            className="rounded-lg bg-brand-800 p-6 text-white"
          >
            <p className="text-xs font-bold tracking-[0.14em] text-amber-400 uppercase">
              For a fast quote
            </p>
            <h2
              id="contact-quote-heading"
              className="mt-1 text-lg font-extrabold tracking-tight"
            >
              Share these three things
            </h2>
            <ul className="mt-3 grid gap-2 text-sm text-brand-100 sm:grid-cols-3">
              {QUOTE_TIPS.map((tip) => (
                <li key={tip} className="rounded-md bg-brand-900 px-3 py-2">
                  {tip}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <QueryForm />
      </div>
    </Container>
  );
}

const PILLARS = [
  {
    title: "Built for industry",
    desc: "Published load ratings and spec sheets up front — compare capacities before you talk to sales.",
  },
  {
    title: "Honest B2B pricing",
    desc: "Published prices incl. GST & delivery, volume pricing on request, and a serviceability check up front by pincode.",
  },
  {
    title: "Delivery you can plan around",
    desc: "Serviceability checked before payment across a multi-partner freight network, with status updates as your order moves.",
  },
  {
    title: "Support after dispatch",
    desc: "Installation guidance, spares and service support on every machine we sell — not just the invoice.",
  },
] as const;

/** Trust/proof band: introductory rail beside four numbered pillar cards. */
export function TrustSection() {
  return (
    <section aria-labelledby="trust-heading" id="trust" className="scroll-mt-24">
      <div className="grid gap-8 lg:grid-cols-[1fr_2fr] lg:items-start">
        <div className="rounded-2xl bg-brand-950 p-7 text-white shadow-lg">
          <p className="text-xs font-bold tracking-[0.14em] text-amber-400 uppercase">Why Trolift</p>
          <h2 id="trust-heading" className="mt-2 text-2xl font-extrabold tracking-tight text-white">
            A supplier that behaves like a partner
          </h2>
          <p className="mt-3 text-sm leading-6 text-brand-100">
            One point of contact from quote to invoice — the same standards
            your shop floor holds, applied to your supplier.
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {PILLARS.map((p, i) => (
            <li
              key={p.title}
              className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <p aria-hidden className="text-xs font-bold text-amber-500">0{i + 1}</p>
              <h3 className="mt-1 text-base font-bold text-zinc-900">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-zinc-600">{p.desc}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

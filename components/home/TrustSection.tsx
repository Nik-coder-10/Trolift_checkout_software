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

/** Trust/proof band: flat white cards on paper background. */
export function TrustSection() {
  return (
    <section aria-labelledby="trust-heading" id="trust" className="scroll-mt-20 rounded-lg bg-white p-6 sm:p-8">
      <p className="text-xs font-bold tracking-[0.14em] text-brand-700 uppercase">Why Trolift</p>
      <h2 id="trust-heading" className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
        A supplier that behaves like a partner
      </h2>
      <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {PILLARS.map((p, i) => (
          <li key={p.title} className="border-t-2 border-amber-400 pt-3">
            <p className="text-xs font-bold text-zinc-400">0{i + 1}</p>
            <h3 className="mt-1 text-base font-bold text-zinc-900">{p.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-zinc-600">{p.desc}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FACTS: [string, string][] = [
  ["GST invoice", "on every order"],
  ["Pincode-checked", "delivery verified pre-payment"],
  ["Volume pricing", "available on request"],
] as const;

/**
 * Ordering-facts band floated up over the hero's dimmed photo:
 * light glass card overlapping a dark section, shadowed for lift.
 */
export function ProofBand() {
  return (
    <section
      aria-label="Buying facts"
      className="relative z-10 mx-auto -mt-12 w-full max-w-6xl px-4 sm:px-6"
    >
      <dl className="grid gap-4 rounded-2xl border border-white/70 bg-white/75 p-6 shadow-xl shadow-brand-950/20 backdrop-blur-xl sm:grid-cols-3 sm:p-7">
        {FACTS.map(([term, desc]) => (
          <div
            key={term}
            className="rounded-xl border-l-[3px] border-amber-400 py-1 pl-3 sm:py-0.5"
          >
            <dt className="text-sm font-bold text-zinc-900">{term}</dt>
            <dd className="mt-0.5 text-xs leading-5 text-zinc-600">{desc}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

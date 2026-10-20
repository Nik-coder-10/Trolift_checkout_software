/** Minimal line-art diya for the festive strip. */
function DiyaIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-amber-400/90"
    >
      <path d="M12 3c1.6 1.9 2.4 3.4 2.4 4.7A2.4 2.4 0 0 1 12 10a2.4 2.4 0 0 1-2.4-2.3C9.6 6.4 10.4 4.9 12 3Z" />
      <path d="M4.5 14.5h15" />
      <path d="M6.5 14.5c.6 3.3 2.7 5 5.5 5s4.9-1.7 5.5-5" />
    </svg>
  );
}

/**
 * Thin festive offer strip above the sticky header: Dussehra + early
 * Diwali redeem codes only — deep navy body with an almost-unnoticeable
 * marigold gradient edge. Non-sticky so the header keeps its height.
 */
export function FestiveBanner() {
  return (
    <aside
      aria-label="Festive offers"
      className="border-b border-amber-400/10 bg-brand-950 text-brand-100 print:hidden"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-1.5 text-center text-xs">
        <span className="inline-flex items-center gap-1.5">
          <DiyaIcon />
          <span>
            Dussehra Offer — use code{" "}
            <b className="font-bold text-amber-300">DUSSHERA450</b> for ₹450 off
          </span>
        </span>
        <span aria-hidden className="hidden text-brand-500 sm:inline">
          |
        </span>
        <span>
          Early Diwali — code <b className="font-bold text-amber-300">EARLYDIWALI400</b>
        </span>
      </div>
      <div
        aria-hidden
        className="h-px bg-gradient-to-r from-transparent via-amber-400/45 to-transparent"
      />
    </aside>
  );
}

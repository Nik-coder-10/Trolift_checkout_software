const VIDEOS = [
  {
    src: "/videos/telescopic-in-action.mp4",
    poster: "/videos/telescopic-in-action-poster.jpg",
    title: "Telescopic ladder in action",
    desc: "Rung-by-rung extension with lock-secure steps.",
  },
  {
    src: "/videos/finger-protect-guard.mp4",
    poster: "/videos/finger-protect-guard-poster.jpg",
    title: "Finger-protect guards",
    desc: "The anti-pinch design that keeps hands safe.",
  },
  {
    src: "/videos/a-type-quicksetup.mp4",
    poster: "/videos/a-type-quicksetup-poster.jpg",
    title: "A-type ladder, start to finish",
    desc: "Setup, climb and fold — all in one clip.",
  },
  {
    src: "/videos/a-type-second-half.mp4",
    poster: "/videos/a-type-second-half-poster.jpg",
    title: "A-type ladder in two halves",
    desc: "Watch both halves become a full A-frame.",
  },
  {
    src: "/videos/stabilizer-bar.mp4",
    poster: "/videos/stabilizer-bar-poster.jpg",
    title: "Stabilizer bar installed",
    desc: "A wider stance at the feet for a steadier climb.",
  },
  {
    src: "/videos/frp-ladder.mp4",
    poster: "/videos/frp-ladder-poster.jpg",
    title: "FRP ladder on show",
    desc: "Fiberglass build for safe electrical work.",
  },
  {
    src: "/videos/frp-ladder-jobsite.mp4",
    poster: "/videos/frp-ladder-jobsite-poster.jpg",
    title: "FRP ladder on site",
    desc: "Out on a site, handled the way you will use it.",
  },
  {
    src: "/videos/container-unloading.mp4",
    poster: "/videos/container-unloading-poster.jpg",
    title: "Container unloading made easy",
    desc: "Reaching tall vehicles without a fuss.",
  },
  {
    src: "/videos/ms-trolley-load.mp4",
    poster: "/videos/ms-trolley-load-poster.jpg",
    title: "MS platform trolley at work",
    desc: "Heavy loads moved smoothly and safely.",
  },
  {
    src: "/videos/ms-trolley-pallet.mp4",
    poster: "/videos/ms-trolley-pallet-poster.jpg",
    title: "Trolley handles the stack",
    desc: "Floor moves without lifting strain.",
  },
  {
    src: "/videos/ms-trolley-packed-stock.mp4",
    poster: "/videos/ms-trolley-packed-stock-poster.jpg",
    title: "Stock packed and wheeled",
    desc: "Bubble-wrapped consignments ride steady.",
  },
  {
    src: "/videos/pt-trolley-move.mp4",
    poster: "/videos/pt-trolley-move-poster.jpg",
    title: "Plastic platform trolley on the move",
    desc: "Shifting loads on the lighter platform.",
  },
  {
    src: "/videos/trolley-assembly.mp4",
    poster: "/videos/trolley-assembly-poster.jpg",
    title: "Trolley assembly in progress",
    desc: "Casters go on before every dispatch.",
  },
  {
    src: "/videos/trolley-600-unboxing.mp4",
    poster: "/videos/trolley-600-unboxing-poster.jpg",
    title: "600 kg trolley unboxed",
    desc: "Every part in the box, checked before ship.",
  },
  {
    src: "/videos/unbox-and-fold.mp4",
    poster: "/videos/unbox-and-fold-poster.jpg",
    title: "Unboxed, then packed away",
    desc: "What arrives at your door — and how it collapses.",
  },
  {
    src: "/videos/warehouse-stock.mp4",
    poster: "/videos/warehouse-stock-poster.jpg",
    title: "Stocked shelves at Trolift",
    desc: "TALT range ready to dispatch from the warehouse.",
  },
] as const;

/**
 * Video showcase: horizontal snap-scroll strip of shorts-style clips
 * (YouTube-style) so buyers can watch equipment work before they trust
 * it. Videos own their controls (native controls attribute); no client
 * JS needed.
 */
export function VideoShowcase() {
  return (
    <section aria-labelledby="videos-heading" id="videos" className="scroll-mt-24">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-brand-700 uppercase">
            See them work
          </p>
          <h2 id="videos-heading" className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900">
            Equipment in action
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            Real clips of our ladders and trolleys on the job — watch before
            you order.
          </p>
        </div>
        <p aria-hidden className="hidden text-xs font-semibold text-zinc-400 sm:block">
          Scroll →
        </p>
      </div>
      <ul
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-1"
        aria-label="Product videos"
      >
        {VIDEOS.map((v) => (
          <li
            key={v.src}
            className="w-[220px] shrink-0 snap-start sm:w-[250px]"
          >
            <video
              controls
              preload="none"
              playsInline
              poster={v.poster}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-900 shadow-sm"
            >
              <source src={v.src} type="video/mp4" />
              Your browser cannot play this video.
            </video>
            <h3 className="mt-3 text-sm font-bold text-zinc-900">{v.title}</h3>
            <p className="mt-0.5 text-xs leading-5 text-zinc-600">{v.desc}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

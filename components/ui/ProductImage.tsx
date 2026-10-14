"use client";

import Image from "next/image";
import { useState } from "react";
import {
  fallbackImageSrc,
  normalizeImageSrc,
  PRODUCT_IMAGE_PLACEHOLDER,
} from "@/lib/storage/images";

/**
 * Product image with a reliable fallback (client component).
 *
 * Two failure modes are covered:
 *   1. An unusable src (blank/malformed/unsafe) is normalized to the
 *      branded placeholder BEFORE any request — no broken request at all.
 *   2. A well-formed src whose asset is missing or fails to load (local
 *      404, remote error) swaps to the placeholder on the `onError`
 *      event.
 *
 * Loop safety: the failure is tracked by src VALUE, and the handler only
 * updates state when the next src differs from the current one. A
 * placeholder that itself fails therefore sets nothing and the browser
 * shows the alt text instead of an endless retry storm. Changing the
 * `src` prop (e.g. a gallery thumbnail) clears the failed state for that
 * image only.
 *
 * Remote (https) sources render `unoptimized`: next/image throws during
 * render for any hostname missing from `images.remotePatterns` (which
 * would take down the whole page — a cart/listing error boundary), and
 * proxying third-party images through our optimizer is neither needed
 * nor desirable. The placeholder is an SVG, which the default loader
 * already serves as-is.
 *
 * Layout: width/height are required and every call site keeps the same
 * fixed aspect box, so swapping in the 4:3 placeholder never shifts
 * layout. Alt text describes what is actually shown: decorative usages
 * pass alt="" (the surrounding link already carries the label), and a
 * fallback can supply its own wording via `fallbackAlt`.
 */
export function ProductImage({
  src,
  alt,
  fallbackAlt,
  width,
  height,
  className,
  sizes,
  priority = false,
  loading,
}: {
  src: string;
  alt: string;
  /** Alt shown while the placeholder is displayed (defaults to `alt`). */
  fallbackAlt?: string;
  width: number;
  height: number;
  className?: string;
  sizes?: string;
  priority?: boolean;
  loading?: "eager" | "lazy";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const normalized = normalizeImageSrc(src);
  const isFallback = failedSrc === normalized;
  const current = isFallback ? PRODUCT_IMAGE_PLACEHOLDER : normalized;
  // Never hand an unconfigured remote host to the default loader.
  const isRemote = /^https?:\/\//i.test(current);
  // Decorative images stay decorative even when the placeholder shows.
  const shownAlt =
    isFallback && alt !== "" ? (fallbackAlt ?? `${alt} — image unavailable`) : alt;

  return (
    <Image
      src={current}
      alt={shownAlt}
      width={width}
      height={height}
      className={className}
      data-fallback={isFallback ? "true" : undefined}
      unoptimized={isRemote}
      {...(sizes ? { sizes } : {})}
      {...(priority ? { priority } : {})}
      {...(loading ? { loading } : {})}
      onError={() => {
        // The decision (and the loop guard) lives in the pure helper: it
        // returns the placeholder for a real src and null once the
        // placeholder itself has failed — so no further state update is
        // possible and the fallback cannot retry forever.
        if (fallbackImageSrc(current) !== null) setFailedSrc(current);
      }}
    />
  );
}

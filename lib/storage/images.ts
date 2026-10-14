/**
 * Product image handling.
 *
 * There is no storage bucket yet: `products.images` holds display paths
 * (local `/images/…` or https URLs). This module is the single place
 * that validates and resolves them, so a future Supabase Storage
 * integration only changes code here:
 *   - uploads go through a signed-URL flow (never an open file POST),
 *   - `resolveProductImage()` gains bucket-URL resolution.
 */

export const PRODUCT_IMAGE_PLACEHOLDER = "/images/products/placeholder.svg";
export const MAX_PRODUCT_IMAGES = 10;

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".svg", ".avif"];

/** Path without its query string or fragment (for extension checks). */
function stripQueryFragment(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

/** Safe display path: site-relative /images path or https URL. */
export function isValidImageSrc(value: string): boolean {
  const v = value.trim();
  if (v === "" || v.length > 500) return false;
  // A raw space can never be part of a valid src (local path or URL).
  if (/\s/.test(v)) return false;
  // Signed/optimizer URLs carry `?token=…` / `#…` after the file name —
  // the extension check applies to the path itself, not the parameters.
  const base = stripQueryFragment(v);
  if (base === "") return false;
  const lower = base.toLowerCase();
  if (!IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return false;
  if (lower.startsWith("/images/")) {
    return !lower.includes("..");
  }
  try {
    // The full value (parameters included) must still parse as https —
    // so `javascript:…`, `data:…`, `ftp:…` and scheme-relative URLs fail
    // here even when their tail happens to end with an image extension.
    const url = new URL(v);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateImageList(images: string[]): string | null {
  if (images.length > MAX_PRODUCT_IMAGES) {
    return `At most ${MAX_PRODUCT_IMAGES} images per product.`;
  }
  const bad = images.find((src) => !isValidImageSrc(src));
  return bad ? `Invalid image path: ${bad}` : null;
}

/** First image, or the branded placeholder when none is set. */
export function resolveProductImage(images: string[]): string {
  const first = images.find((src) => isValidImageSrc(src));
  return first ?? PRODUCT_IMAGE_PLACEHOLDER;
}

/**
 * Normalize ONE display src: a valid path/URL as-is, anything else
 * (blank, malformed, unsafe) → the branded placeholder. Used before a
 * request is ever made, so a typo'd path cannot produce a broken-image
 * request at all.
 *
 * Note this validates the SHAPE of the path, not that the file exists:
 * a well-formed path whose asset is simply not shipped yet still loads
 * (and falls back on error — see fallbackImageSrc()).
 */
export function normalizeImageSrc(src: string | null | undefined): string {
  return typeof src === "string" && isValidImageSrc(src)
    ? src.trim()
    : PRODUCT_IMAGE_PLACEHOLDER;
}

/**
 * Next src to try after a load error, or null when nothing is left.
 *
 * Returning null for the placeholder (or anything that normalizes to
 * it) is what makes a failing placeholder terminate: the caller must
 * only swap when the result is non-null, so the fallback can never
 * re-trigger itself in a loop.
 */
export function fallbackImageSrc(
  currentSrc: string | null | undefined,
): string | null {
  return normalizeImageSrc(currentSrc) === PRODUCT_IMAGE_PLACEHOLDER
    ? null
    : PRODUCT_IMAGE_PLACEHOLDER;
}

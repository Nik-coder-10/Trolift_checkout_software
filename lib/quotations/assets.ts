import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  getQuotationLogoPath,
  getSignatorySignPath,
} from "@/lib/quotations/config";
import { LOGO_PNG_B64, SIGN_PNG_B64 } from "@/lib/quotations/embedded";

/**
 * Quotation artwork loader (server-only).
 *
 * pdfkit draws the header logo and the signature strip from raw image
 * BYTES. The bytes come from ``public/<configured path>`` when the file
 * is readable on disk (dev, self-hosted, bundles that ship static
 * files) and from the identical embedded copies otherwise (serverless
 * bundles without ``public/``) — either way the same image is drawn, so
 * a frozen quotation still renders byte-identical PDFs. A configured
 * path that cannot be read falls back to the default artwork rather
 * than dropping the logo/signature from the document.
 */

const PUBLIC_DIR = path.join(process.cwd(), "public");

async function loadArtwork(relative: string, fallback: Buffer): Promise<Buffer> {
  try {
    const full = path.join(PUBLIC_DIR, relative);
    // Defense in depth: the resolved path must stay inside public/
    // (config already rejects traversal, this catches odd joins).
    if (!full.startsWith(PUBLIC_DIR + path.sep)) return fallback;
    return await readFile(full);
  } catch {
    return fallback;
  }
}

/** Header logo bytes (falls back to the embedded default logo). */
export function loadQuotationLogo(): Promise<Buffer> {
  return loadArtwork(getQuotationLogoPath(), Buffer.from(LOGO_PNG_B64, "base64"));
}

/** Signature strip bytes (falls back to the embedded default signature). */
export function loadQuotationSign(): Promise<Buffer> {
  return loadArtwork(getSignatorySignPath(), Buffer.from(SIGN_PNG_B64, "base64"));
}

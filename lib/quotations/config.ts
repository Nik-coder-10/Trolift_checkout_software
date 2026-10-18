import { parseGstRate } from "@/lib/tax/india";
import { getSetting } from "@/lib/settings/server";

/**
 * Quotation/proforma configuration (server configuration, not DB).
 *
 * Quotations are provisional working documents: their number, validity
 * window, cartage line, terms, bank block and signatory all come from
 * THESE values plus frozen order snapshots — never from live
 * product/customer master rows. Optional blocks are omitted from the
 * document when unconfigured rather than rendered as blanks.
 */

export interface BankDetails {
  bankName: string | null;
  accountName: string | null;
  accountNumber: string;
  ifsc: string | null;
  accountType: string | null;
}

export interface Signatory {
  name: string;
  title: string | null;
}

/** Days a quotation stays valid (default 7, matching current practice). */
export async function getQuotationValidityDays(): Promise<number> {
  const override = await getSetting("quotation_validity_days");
  const raw = Number(override ?? process.env.QUOTATION_VALIDITY_DAYS ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 7;
}

/**
 * GST percent applied to the cartage (delivery) line on quotations
 * and to the delivery charge on live orders. Quoted freight is a
 * taxable service; on orders the delivery GST is folded into the
 * CGST/SGST or IGST split. Default 18.00; an invalid value fails
 * safe to 18.00 rather than silently zero-rating freight.
 */
export function getDeliveryGstRate(): string {
  const raw = (process.env.TROLIFT_DELIVERY_GST_RATE ?? "18.00").trim();
  if (/^0+(\.0+)?$/.test(raw)) return "0";
  return parseGstRate(raw) > 0 ? raw : "18.00";
}

/** SAC for the cartage line (6 digits); null renders the cell blank. */
export function getDeliverySac(): string | null {
  const raw = (process.env.TROLIFT_DELIVERY_SAC ?? "").trim();
  return /^[0-9]{6}$/.test(raw) ? raw : null;
}

/** Cartage line copy (defaults match current quotation practice). */
export function getDeliveryLineCopy(): { name: string; description: string } {
  const name = (process.env.TROLIFT_DELIVERY_LINE_NAME ?? "").trim();
  const description = (process.env.TROLIFT_DELIVERY_LINE_DESC ?? "").trim();
  return {
    name: name === "" ? "Cartage - delivery charge" : name,
    description:
      description === ""
        ? "Delivery Fees through Our Designated Delivery Partners"
        : description,
  };
}

/**
 * Bank block. Returned only when an account number is configured —
 * without it there is nothing to pay into, so the block is omitted
 * rather than rendered half-headed. Values are display-only.
 */
export function getBankDetails(): BankDetails | null {
  const accountNumber = (process.env.TROLIFT_BANK_ACCOUNT_NO ?? "").trim();
  if (accountNumber === "") return null;
  const orNull = (v: string): string | null => {
    const t = (process.env[v] ?? "").trim();
    return t === "" ? null : t;
  };
  return {
    bankName: orNull("TROLIFT_BANK_NAME"),
    accountName: orNull("TROLIFT_BANK_ACCOUNT_NAME"),
    accountNumber,
    ifsc: orNull("TROLIFT_BANK_IFSC"),
    accountType: orNull("TROLIFT_BANK_ACCOUNT_TYPE"),
  };
}

/** Signatory block. Omitted when no name is configured. */
export function getSignatory(): Signatory | null {
  const name = (process.env.TROLIFT_SIGNATORY_NAME ?? "").trim();
  if (name === "") return null;
  const title = (process.env.TROLIFT_SIGNATORY_TITLE ?? "").trim();
  return { name, title: title === "" ? null : title };
}

/**
 * Public-relative artwork paths for the quotation header logo and the
 * signatory's signature strip. Server-only consumers read the bytes
 * from ``public/`` (falling back to the embedded copies in
 * embedded.ts when the bundle has no files on disk). Overrides must
 * stay inside ``public/`` — absolute paths and ``..`` traversal are
 * rejected back to the defaults.
 */
function envPublicPath(key: string, fallback: string): string {
  const raw = (process.env[key] ?? "").trim().replace(/\\/g, "/");
  if (raw === "") return fallback;
  const rel = raw.replace(/^\/+/, "");
  if (
    rel === ".." ||
    rel.startsWith("../") ||
    rel.includes("/../") ||
    rel.endsWith("/..")
  ) {
    return fallback;
  }
  return rel;
}

/** Header logo on quotations (public/-relative; default images/logo.png). */
export function getQuotationLogoPath(): string {
  return envPublicPath("TROLIFT_QUOTATION_LOGO_PATH", "images/logo.png");
}

/**
 * Signature strip drawn above the signatory name
 * (public/-relative; default images/proprietor-sign.png).
 */
export function getSignatorySignPath(): string {
  return envPublicPath("TROLIFT_SIGNATORY_SIGN_PATH", "images/proprietor-sign.png");
}

/**
 * "About Trolift Solutions" copy frozen into new quotations. One
 * paragraph per line in the override (joined with spaces); unconfigured
 * uses the standard description.
 */
const DEFAULT_ABOUT =
  "Trolift Solutions is a Jaipur-based manufacturer and supplier of aluminium telescopic ladders, step ladders, trolleys and material-handling equipment. Every product is built from quality aluminium, load-tested for safety and shipped across India with warranty-backed support.";

export function getQuotationAbout(): string {
  const text = (process.env.TROLIFT_QUOTATION_ABOUT ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join(" ");
  return text === "" ? DEFAULT_ABOUT : text;
}

/**
 * Quotation terms, one per line. Newline-separated override; defaults
 * are the current standard terms. The owner edits these (env) when
 * rates or policy change — they are frozen into each document.
 */
const DEFAULT_TERMS = [
  "Above quoted prices are Inclusive of GST @18% on Ladder and 5 % On Trolley",
  "Freight and Delivery Charges are Included in the Quoted Prices",
  "Payment Terms:- 100% Advance along with the Order Confirmation",
  "Delivery Terms:- 2-5 days after confirmation of payment in bank account",
  "Quotation is valid only for 7 Days from the date.",
];

export function getQuotationTerms(): string[] {
  const raw = process.env.TROLIFT_QUOTATION_TERMS ?? "";
  const lines = raw
    .split("\n")
    .map((l) => l.trim().replace(/^(\d+[.)]\s*)/, ""))
    .filter((l) => l !== "");
  return lines.length > 0 ? lines : [...DEFAULT_TERMS];
}

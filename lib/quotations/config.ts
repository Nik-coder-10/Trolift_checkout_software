import { parseGstRate } from "@/lib/tax/india";

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
export function getQuotationValidityDays(): number {
  const raw = Number(process.env.QUOTATION_VALIDITY_DAYS ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 7;
}

/**
 * GST percent applied to the cartage (delivery) line on quotations.
 * Quoted freight is a taxable service; the goods-delivery charge stored
 * on the order itself stays untaxed (third-party freight). Default
 * 18.00; an invalid value fails safe to 18.00 rather than silently
 * zero-rating quoted freight.
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
 * Quotation terms, one per line. Newline-separated override; defaults
 * are the current standard terms. The owner edits these (env) when
 * rates or policy change — they are frozen into each document.
 */
const DEFAULT_TERMS = [
  "Above quoted prices are Exclusive of GST @18% on Ladder and 5 % On Trolley",
  "Freight Charges Shall be Extra as Actual",
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

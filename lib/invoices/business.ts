import { getSetting } from "@/lib/settings/server";

/**
 * Trolift business identity for invoices (server configuration).
 *
 * The seller block on every invoice comes from THESE values — never
 * from product/customer rows — so catalogue edits cannot alter who
 * issued a historical invoice. Phone/email accept an admin Settings
 * override; name, address and GSTIN stay environment-only (they bind
 * the registered identity). Optional fields are omitted from the
 * document when unconfigured rather than rendered as blanks.
 */

export interface BusinessDetails {
  name: string;
  address: string;
  phone: string | null;
  email: string | null;
  /** Seller GSTIN (display only — format-checked, never verified). */
  gstin: string | null;
}

/** Uppercase-letter prefix for invoice numbers (default INV). */
export async function getInvoicePrefix(): Promise<string> {
  const raw = ((await getSetting("invoice_prefix")) ??
    (process.env.TROLIFT_INVOICE_PREFIX ?? "INV")).trim().toUpperCase();
  if (!/^[A-Z]{2,10}$/.test(raw)) {
    throw new Error(
      "[invoices] TROLIFT_INVOICE_PREFIX must be 2–10 uppercase letters.",
    );
  }
  return raw;
}

/**
 * Read + validate the seller block. Name and address are required —
 * invoicing without them is a configuration error (500, never a
 * half-headed PDF). GSTIN here is display-only.
 */
export async function getBusinessDetails(): Promise<BusinessDetails> {
  const name = (process.env.TROLIFT_BUSINESS_NAME ?? "").trim();
  const address = (process.env.TROLIFT_BUSINESS_ADDRESS ?? "").trim();
  if (name === "" || address === "") {
    throw new Error(
      "[invoices] TROLIFT_BUSINESS_NAME and TROLIFT_BUSINESS_ADDRESS are required.",
    );
  }
  const phone = ((await getSetting("business_phone")) ??
    (process.env.TROLIFT_BUSINESS_PHONE ?? "")).trim();
  const email = ((await getSetting("business_email")) ??
    (process.env.TROLIFT_BUSINESS_EMAIL ?? "")).trim();
  const gstin = (process.env.TROLIFT_BUSINESS_GSTIN ?? "").trim().toUpperCase();
  return {
    name,
    address,
    phone: phone === "" ? null : phone,
    email: email === "" ? null : email,
    gstin: gstin === "" ? null : gstin,
  };
}

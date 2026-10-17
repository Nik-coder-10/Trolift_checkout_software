/**
 * Public sales contact details (safe for server and client).
 *
 * One source of truth for the numbers rendered on /contact, the
 * `tel:` links, and the fallback copy the query form shows when an
 * email cannot be delivered.
 */
export interface ContactLine {
  /** Display form exactly as published, e.g. "+91 9119185993". */
  display: string;
  /** Dialable form used by the tel: href, e.g. "+919119185993". */
  tel: string;
}

export const contactConfig = {
  /** Inbox every contact-form query is delivered to. */
  email: "bizwise.ops@gmail.com",
  phones: [
    { display: "+91 9119185993", tel: "+919119185993" },
    { display: "+91 8690870788", tel: "+918690870788" },
    { display: "+91 8690800788", tel: "+918690800788" },
  ] as ContactLine[],
} as const;

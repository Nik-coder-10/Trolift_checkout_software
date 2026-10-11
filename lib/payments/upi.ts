import "server-only";

/**
 * Owner UPI payment config (server-only).
 *
 * Customers pay to the owner's UPI id; verification happens server-side
 * (reference/UTR reconciliation in the admin dashboard). Never accept a
 * "payment successful" flag from the browser as proof of payment.
 */

export interface UpiPaymentInfo {
  payeeVpa: string;
  payeeName: string;
}

/** UPI VPA shape: user@bank (2+ chars each side, no spaces). */
export function isValidUpiVpa(value: string): boolean {
  return /^[A-Za-z0-9._-]{2,}@[A-Za-z0-9._-]{2,}$/.test(value.trim());
}

export function getOwnerUpi(): UpiPaymentInfo {
  const payeeVpa = (process.env.OWNER_UPI_ID ?? "").trim();
  const payeeName = (process.env.OWNER_UPI_PAYEE_NAME ?? "").trim() || "Trolift Solutions";
  if (payeeVpa === "") {
    throw new Error("[payments] OWNER_UPI_ID is not configured. See .env.example.");
  }
  if (!isValidUpiVpa(payeeVpa)) {
    // Fail closed: a malformed VPA renders a QR no UPI app can pay
    // to. Never emit payment instructions with a broken payee.
    throw new Error("[payments] OWNER_UPI_ID is not a valid UPI VPA (expected user@bank).");
  }
  return { payeeVpa, payeeName };
}

/** UPI deep-link for QR/intent (amount in rupees, VPA validated). */
export function buildUpiIntent(
  info: UpiPaymentInfo,
  amountRupees: number,
  note: string,
  transactionRef?: string,
): string {
  if (!isValidUpiVpa(info.payeeVpa)) {
    throw new Error("[payments] Refusing to encode a UPI intent with an invalid payee VPA.");
  }
  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    throw new Error("[payments] Refusing to encode a UPI intent with a non-positive amount.");
  }
  const params = new URLSearchParams({
    pa: info.payeeVpa,
    pn: info.payeeName,
    am: amountRupees.toFixed(2),
    cu: "INR",
    tn: note.slice(0, 80),
  });
  if (transactionRef) params.set("tr", transactionRef.slice(0, 64));
  return `upi://pay?${params.toString()}`;
}

/** Payment window: how long an order stays payable (informational). */
export function getPaymentWindowHours(): number {
  const raw = Number(process.env.PAYMENT_WINDOW_HOURS ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 48;
}

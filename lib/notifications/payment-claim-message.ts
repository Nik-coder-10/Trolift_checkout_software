/**
 * "Payment submitted" owner email (pure builder, unit-tested).
 *
 * Sent the moment a customer clicks "I Have Paid" with a UTR and a
 * payment screenshot. Carries the client's details, the payment
 * reference and the order total; the screenshot rides along as an
 * attachment (wired by the notification sender, not this builder).
 */

export interface PaymentClaimMessageInput {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  /** UPI UTR / bank reference as submitted by the customer. */
  reference: string;
  /** Order total in paise — the amount the customer claims to have paid. */
  totalPaise: number;
  hasScreenshot: boolean;
}

const formatRupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function buildPaymentClaimMessage(input: PaymentClaimMessageInput): string {
  const lines: string[] = [];
  lines.push(`Payment submitted — ${input.orderNumber}`);
  lines.push("");
  lines.push("A customer claims to have paid. Verify the UTR against your");
  lines.push("bank/UPI history and the attached screenshot, then mark the");
  lines.push("payment as received (or reject the claim) in the admin panel.");
  lines.push("");
  lines.push("Client");
  lines.push(`  Name:  ${input.customerName}`);
  lines.push(`  Phone: ${input.customerPhone}`);
  if (input.customerEmail !== null && input.customerEmail.trim() !== "") {
    lines.push(`  Email: ${input.customerEmail}`);
  }
  lines.push("");
  lines.push("Payment");
  lines.push(`  UPI reference (UTR): ${input.reference}`);
  lines.push(`  Amount claimed paid: ${formatRupees(input.totalPaise)}`);
  lines.push("");
  lines.push(
    input.hasScreenshot
      ? "The payment screenshot submitted by the client is attached."
      : "NOTE: the payment screenshot could not be attached to this email —" +
          " fetch it from storage (payments.proof_path) before verifying.",
  );
  lines.push("");
  lines.push("— Trolift Solutions");
  return lines.join("\n");
}

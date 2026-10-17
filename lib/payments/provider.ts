import "server-only";
import { AppError } from "@/lib/api/errors";
import { buildUpiIntent, getOwnerUpi } from "@/lib/payments/upi";

/**
 * Payment provider abstraction (server-only).
 *
 * Active provider: UPI_MANUAL — dynamic QR against the owner's UPI id,
 * customer claims payment with a UTR, admin verifies out-of-band.
 * Future providers (RAZORPAY, …) implement this interface without
 * touching orders: create → verify → webhook.
 */

export type PaymentProviderName = "upi_manual";

export interface UpiPaymentIntent {
  provider: PaymentProviderName;
  payeeVpa: string;
  payeeName: string;
  amountPaise: number;
  orderNumber: string;
  /** UPI deep-link encoded in the QR (never a placeholder). */
  intentUri: string;
  /** PNG data-URL QR rendered server-side from the real URI. */
  qrDataUrl: string;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createPaymentIntent(input: {
    orderId: string;
    orderNumber: string;
    amountPaise: number;
  }): Promise<UpiPaymentIntent>;
  verifyPayment(_input: { orderId: string }): Promise<never>;
  handleWebhook(_raw: unknown): Promise<never>;
}

export const upiManualProvider: PaymentProvider = {
  name: "upi_manual",

  async createPaymentIntent(input) {
    // Amount comes from the authoritative order total (paise integer);
    // UPI takes rupees with exactly 2 decimals — division is exact here
    // because paise values originating from NUMERIC(12,2) are multiples
    // of 1 with at most 2 decimal places in rupees.
    const { payeeVpa, payeeName } = await getOwnerUpi();
    const amountRupees = input.amountPaise / 100;
    const intentUri = buildUpiIntent(
      { payeeVpa, payeeName },
      amountRupees,
      `Trolift order ${input.orderNumber}`,
      input.orderNumber,
    );
    const { toDataURL } = await import("qrcode");
    const qrDataUrl = await toDataURL(intentUri, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
    });
    return {
      provider: "upi_manual",
      payeeVpa,
      payeeName,
      amountPaise: input.amountPaise,
      orderNumber: input.orderNumber,
      intentUri,
      qrDataUrl,
    };
  },

  verifyPayment(): Promise<never> {
    // Manual UPI has no automatic verification: the admin reconciles
    // the UTR in the dashboard (next phase), which flips SUBMITTED→PAID.
    return Promise.reject(
      new AppError(
        "BAD_REQUEST",
        "Automatic verification is not available for manual UPI payments.",
        400,
      ),
    );
  },

  handleWebhook(): Promise<never> {
    return Promise.reject(
      new AppError(
        "BAD_REQUEST",
        "Webhook handling is not available for manual UPI payments.",
        400,
      ),
    );
  },
};

export function getPaymentProvider(): PaymentProvider {
  return upiManualProvider;
}

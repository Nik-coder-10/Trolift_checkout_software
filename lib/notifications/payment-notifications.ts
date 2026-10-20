import "server-only";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { buildPaymentClaimMessage } from "@/lib/notifications/payment-claim-message";
import { downloadPaymentProof } from "@/lib/storage/payment-proofs";
import {
  emailConfigured,
  getOrderNotificationRecipient,
  sendEmailMessages,
  type EmailAttachment,
} from "@/lib/notifications/email";

/**
 * "Payment submitted" notifications: the owner's verification alert,
 * over email, with the customer's payment screenshot attached.
 *
 * Called from the claim route through Next's `after()` so the
 * customer's response never waits on SMTP or storage. Every outcome
 * is logged with the order number; failures are reported, never
 * retried in a loop. A storage outage degrades to an email WITHOUT
 * the attachment (the claim details still reach the owner, and the
 * note in the body says the screenshot must be fetched manually).
 */

export interface PaymentClaimNotificationInput {
  orderNumber: string;
  customer: { name: string; phone: string; email: string | null };
  /** UPI reference as submitted — null when the customer omitted it. */
  reference: string | null;
  totalPaise: number;
  proofPath: string;
}

const PROOF_CONTENT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

async function loadProofAttachment(
  proofPath: string,
  orderNumber: string,
): Promise<EmailAttachment | null> {
  try {
    const stored = await downloadPaymentProof(proofPath);
    if (stored === null) return null;
    const ext = PROOF_CONTENT_TYPES[stored.contentType] ?? "png";
    return {
      filename: `payment-proof-${orderNumber}.${ext}`,
      content: stored.bytes,
      contentType: stored.contentType,
      cid: "payment-proof@trolift",
    };
  } catch {
    logWarn("Payment proof download failed — email sent without attachment.", {
      category: "email",
      operation: "payment-claim-notification",
      orderNumber,
    });
    return null;
  }
}

interface NotifyDeps {
  sendMail?: (msg: {
    from: string;
    to: string;
    subject: string;
    text: string;
    attachments?: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
      cid?: string;
    }>;
  }) => Promise<unknown>;
}

export async function notifyPaymentClaimSubmitted(
  input: PaymentClaimNotificationInput,
  deps?: NotifyDeps,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const recipient = getOrderNotificationRecipient();
  if (recipient === null) {
    logWarn("Payment claim without email notification — ORDER_NOTIFICATION_EMAIL unset.", {
      category: "email",
      operation: "payment-claim-notification",
      orderNumber: input.orderNumber,
      hint: "Set ORDER_NOTIFICATION_EMAIL to receive payment verification alerts.",
    });
    return { sent: 0, failed: 0, skipped: 1 };
  }
  if (!emailConfigured()) {
    logWarn("Payment claim without email notification — provider not configured.", {
      category: "email",
      operation: "payment-claim-notification",
      orderNumber: input.orderNumber,
      hint: "Set SMTP_USER/SMTP_PASS and ORDER_NOTIFICATION_EMAIL.",
    });
    return { sent: 0, failed: 0, skipped: 1 };
  }

  const attachment = await loadProofAttachment(input.proofPath, input.orderNumber);
  const body = buildPaymentClaimMessage({
    orderNumber: input.orderNumber,
    customerName: input.customer.name,
    customerPhone: input.customer.phone,
    customerEmail: input.customer.email,
    reference: input.reference,
    totalPaise: input.totalPaise,
    hasScreenshot: attachment !== null,
  });

  const outcomes = await sendEmailMessages(
    [
      {
        to: recipient,
        subject:
          input.reference === null
            ? `Payment submitted — ${input.orderNumber}`
            : `Payment submitted — ${input.orderNumber} (UTR ${input.reference})`,
        body,
        ...(attachment ? { attachments: [attachment] } : {}),
      },
    ],
    deps,
  );

  const outcome = outcomes[0];
  if (outcome?.status === "sent") {
    logInfo("Payment claim email sent.", {
      category: "email",
      operation: "payment-claim-notification",
      orderNumber: input.orderNumber,
      withScreenshot: attachment !== null,
    });
    return { sent: 1, failed: 0, skipped: 0 };
  }
  if (outcome?.status === "failed") {
    logWarn("Payment claim email failed.", {
      category: "email",
      operation: "payment-claim-notification",
      orderNumber: input.orderNumber,
      reason: outcome.detail ?? "unknown",
    });
    return { sent: 0, failed: 1, skipped: 0 };
  }
  return { sent: 0, failed: 0, skipped: 1 };
}

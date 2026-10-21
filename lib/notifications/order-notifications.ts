import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { siteConfig } from "@/config/site";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { getPaymentWindowHours } from "@/lib/payments/upi";
import {
  buildCustomerOrderMessage,
  buildOwnerOrderMessage,
  type NotificationLine,
  type OrderMessageInput,
} from "@/lib/notifications/order-message";
import {
  emailConfigured,
  getOrderNotificationRecipient,
  sendEmailMessages,
  type EmailAttachment,
  type EmailMessage,
} from "@/lib/notifications/email";

/**
 * "An order was placed" notifications: the customer's own copy plus the
 * owner's alert, over email.
 *
 * Called from the order route through Next's `after()` so the customer
 * gets their confirmation response first — a slow or rejected message
 * never delays or fails a placed order. Every outcome is logged with
 * the order number; failures are reported, never retried in a loop.
 */

export interface OrderNotificationInput {
  orderNumber: string;
  customer: { name: string; phone: string; email: string | null };
  billing: {
    gstin: string | null;
    name: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  } | null;
  lines: NotificationLine[];
  taxPaise: number;
  /** GST split carried by the order — names the component in the email. */
  taxType: "igst" | "cgst_sgst";
  deliveryPartnerName: string | null;
  /** Flat ODA door-delivery BASE charge in paise (0 on all-inclusive orders). */
  deliveryChargePaise: number;
  /** GST folded into the tax split on that charge (0 when none was broken out). */
  deliveryTaxPaise: number;
  etaDays: { min: number; max: number } | null;
  totalPaise: number;
  /** Rupees knocked off by the redeem code (0 when no offer applied). */
  discountPaise: number;
  /** Redeem code granted at checkout, or null when none was used. */
  couponCode: string | null;
  pincode: string;
  /** Delivery address as typed at checkout — both copies show it. */
  shippingAddress: string;
  /**
   * The order's frozen quotation PDF. Attached to the customer's copy
   * (they may have missed the pay-page download) AND the owner's copy
   * (their record of what was quoted). Built by the caller so this
   * module stays free of PDF/DB dependencies.
   */
  quotation?: { number: string; content: Buffer } | null;
}

/** "12 MG Road, Pune, Maharashtra 411001" from whatever is present. */
function composeAddress(billing: OrderNotificationInput["billing"]): string | null {
  if (!billing) return null;
  const locality = [billing.city, billing.state].filter(Boolean).join(", ");
  const withPin = [locality, billing.pincode].filter(Boolean).join(" ");
  const parts = [billing.addressLine, withPin].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  return parts.length === 0 ? null : parts.join(", ");
}

/**
 * Load the shop's static UPI QR (PayZapp/HDFC) for email attachment.
 * The path can be overridden with PAYMENT_QR_PATH; the default is
 * public/images/payment-qr.png. Missing file → null (email still sent).
 * Attached to the CUSTOMER's copy only — the owner does not pay
 * themselves, so the owner alert never carries the QR.
 */
async function loadPaymentQrAttachment(): Promise<EmailAttachment | null> {
  const relPath = (process.env.PAYMENT_QR_PATH ?? "").trim() || "images/payment-qr.png";
  const absPath = path.join(process.cwd(), "public", relPath);
  try {
    const content = await readFile(absPath);
    return {
      filename: "trolift-payment-qr.png",
      content,
      contentType: "image/png",
      cid: "payment-qr@trolift",
    };
  } catch {
    logWarn("Payment QR image not found — email sent without attachment.", {
      category: "email",
      operation: "order-notification",
      path: absPath,
      hint: "Place the QR at public/images/payment-qr.png or set PAYMENT_QR_PATH.",
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
    attachments?: Array<{ filename: string; content: Buffer; contentType: string; cid?: string }>;
  }) => Promise<unknown>;
}

export async function notifyOrderPlaced(
  input: OrderNotificationInput,
  deps?: NotifyDeps,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const qrAttachment = await loadPaymentQrAttachment();
  const quotation = input.quotation ?? null;
  const quotationAttachment: EmailAttachment | null =
    quotation === null
      ? null
      : {
          filename: `${quotation.number}.pdf`,
          content: quotation.content,
          contentType: "application/pdf",
        };
  // Per-recipient attachments: the customer pays us (QR + quotation);
  // we never pay ourselves, so the owner's copy carries the quotation
  // only. Built as fresh arrays so neither recipient can see the
  // other's set.
  const customerAttachments = [
    qrAttachment,
    quotationAttachment,
  ].filter((a): a is EmailAttachment => a !== null);
  const ownerAttachments = quotationAttachment ? [quotationAttachment] : undefined;

  const messageInput: OrderMessageInput = {
    orderNumber: input.orderNumber,
    customerName: input.customer.name,
    customerPhone: input.customer.phone,
    customerEmail: input.customer.email,
    businessName: input.billing?.name ?? null,
    billingAddress: composeAddress(input.billing),
    gstin: input.billing?.gstin ?? null,
    lines: input.lines,
    taxPaise: input.taxPaise,
    taxType: input.taxType,
    deliveryPartnerName: input.deliveryPartnerName,
    deliveryChargePaise: input.deliveryChargePaise,
    deliveryTaxPaise: input.deliveryTaxPaise,
    etaDays: input.etaDays,
    totalPaise: input.totalPaise,
    discountPaise: input.discountPaise,
    couponCode: input.couponCode,
    pincode: input.pincode,
    shippingAddress: input.shippingAddress,
    paymentWindowHours: await getPaymentWindowHours(),
    siteUrl: siteConfig.url,
    hasPaymentQr: qrAttachment !== null,
    quotationNumber: quotation?.number ?? null,
  };

  const ownerRecipient = getOrderNotificationRecipient();
  const customerEmail = input.customer.email?.trim() || null;

  const messages: Array<{ role: "customer" | "owner"; message: EmailMessage }> = [];
  // Customer confirmation goes to the customer's own email — never to
  // the owner's inbox. Skipped when the checkout left email blank.
  if (customerEmail !== null) {
    messages.push({
      role: "customer",
      message: {
        to: customerEmail,
        subject: `Order Confirmation — ${input.orderNumber}`,
        body: buildCustomerOrderMessage(messageInput),
        attachments:
          customerAttachments.length > 0 ? customerAttachments : undefined,
      },
    });
  }
  // Owner alert goes only to ORDER_NOTIFICATION_EMAIL.
  if (ownerRecipient !== null) {
    messages.push({
      role: "owner",
      message: {
        to: ownerRecipient,
        subject: `New Order — ${input.orderNumber}`,
        body: buildOwnerOrderMessage(messageInput),
        attachments: ownerAttachments,
      },
    });
  }

  if (!emailConfigured()) {
    logWarn("Order placed without email notification — provider not configured.", {
      category: "email",
      orderNumber: input.orderNumber,
      operation: "order-notification",
      hint: "Set SMTP_USER/SMTP_PASS and ORDER_NOTIFICATION_EMAIL.",
    });
    return { sent: 0, failed: 0, skipped: messages.length };
  }

  if (messages.length === 0) {
    logWarn("Order placed with no email recipients — customer email blank and ORDER_NOTIFICATION_EMAIL unset.", {
      category: "email",
      orderNumber: input.orderNumber,
      operation: "order-notification",
    });
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const outcomes = await sendEmailMessages(
    messages.map((m) => m.message),
    deps,
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  outcomes.forEach((outcome, index) => {
    const role = messages[index]?.role ?? "customer";
    if (outcome.status === "sent") {
      sent += 1;
      logInfo("Email notification sent.", {
        category: "email",
        operation: "order-notification",
        orderNumber: input.orderNumber,
        recipient: role,
      });
    } else if (outcome.status === "failed") {
      failed += 1;
      logWarn("Email notification failed.", {
        category: "email",
        operation: "order-notification",
        orderNumber: input.orderNumber,
        recipient: role,
        reason: outcome.detail ?? "unknown",
      });
    } else {
      skipped += 1;
    }
  });
  if (ownerRecipient === null) {
    logWarn("ORDER_NOTIFICATION_EMAIL is unset — owner alert not sent.", {
      category: "email",
      operation: "order-notification",
      orderNumber: input.orderNumber,
    });
  }
  return { sent, failed, skipped };
}

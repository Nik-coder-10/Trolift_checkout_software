import "server-only";
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
  type EmailMessage,
} from "@/lib/notifications/whatsapp";

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
  customer: { name: string; phone: string };
  billing: {
    gstin: string | null;
    name: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  } | null;
  lines: NotificationLine[];
  subtotalPaise: number;
  taxPaise: number;
  deliveryChargePaise: number;
  deliveryPartnerName: string | null;
  etaDays: { min: number; max: number } | null;
  totalPaise: number;
  pincode: string;
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

export async function notifyOrderPlaced(
  input: OrderNotificationInput,
  deps?: { sendMail?: (msg: { from: string; to: string; subject: string; text: string }) => Promise<unknown> },
): Promise<{ sent: number; failed: number; skipped: number }> {
  const messageInput: OrderMessageInput = {
    orderNumber: input.orderNumber,
    customerName: input.customer.name,
    customerPhone: input.customer.phone,
    businessName: input.billing?.name ?? null,
    billingAddress: composeAddress(input.billing),
    gstin: input.billing?.gstin ?? null,
    lines: input.lines,
    subtotalPaise: input.subtotalPaise,
    taxPaise: input.taxPaise,
    deliveryChargePaise: input.deliveryChargePaise,
    deliveryPartnerName: input.deliveryPartnerName,
    etaDays: input.etaDays,
    totalPaise: input.totalPaise,
    pincode: input.pincode,
    paymentWindowHours: getPaymentWindowHours(),
    siteUrl: siteConfig.url,
  };

  const recipient = getOrderNotificationRecipient();
  const messages: Array<{ role: "customer" | "owner"; message: EmailMessage }> = [
    {
      role: "customer",
      message: {
        to: recipient ?? "",
        subject: `Order Confirmation — ${input.orderNumber}`,
        body: buildCustomerOrderMessage(messageInput),
      },
    },
    ...(recipient === null
      ? []
      : [
          {
            role: "owner" as const,
            message: {
              to: recipient,
              subject: `New Order — ${input.orderNumber}`,
              body: buildOwnerOrderMessage(messageInput),
            },
          },
        ]),
  ];

  if (!emailConfigured()) {
    logWarn("Order placed without email notification — provider not configured.", {
      category: "email",
      orderNumber: input.orderNumber,
      operation: "order-notification",
      hint: "Set SMTP_USER/SMTP_PASS and ORDER_NOTIFICATION_EMAIL.",
    });
    return { sent: 0, failed: 0, skipped: messages.length };
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
  if (recipient === null) {
    logWarn("ORDER_NOTIFICATION_EMAIL is unset — notifications not sent.", {
      category: "email",
      operation: "order-notification",
      orderNumber: input.orderNumber,
    });
  }
  return { sent, failed, skipped };
}

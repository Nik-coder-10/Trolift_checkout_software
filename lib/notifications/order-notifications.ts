import "server-only";
import { siteConfig } from "@/config/site";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { getPaymentWindowHours } from "@/lib/payments/upi";
import {
  buildCustomerOrderMessage,
  buildOwnerOrderMessage,
  orderMessageTemplateVariables,
  type NotificationLine,
  type OrderMessageInput,
} from "@/lib/notifications/order-message";
import {
  ownerWhatsAppNumber,
  sendWhatsAppMessages,
  whatsappConfigured,
  type WhatsAppMessage,
} from "@/lib/notifications/whatsapp";

/**
 * "An order was placed" notifications: the customer's own copy plus the
 * owner's alert, over WhatsApp.
 *
 * Called from the order route through Next's `after()` so the customer
 * gets their confirmation response first — a slow or rejected message
 * never delays or fails a placed order. Every outcome is logged with
 * the order number; failures are reported, never retried in a loop
 * (a wrong number or an unapproved template must not hammer Twilio).
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
  deps?: { fetchImpl?: typeof fetch },
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

  const templateVariables = orderMessageTemplateVariables(messageInput);
  const owner = ownerWhatsAppNumber();
  const messages: Array<{ role: "customer" | "owner"; message: WhatsAppMessage }> = [
    {
      role: "customer",
      message: {
        to: input.customer.phone,
        body: buildCustomerOrderMessage(messageInput),
        templateVariables,
      },
    },
    ...(owner === null
      ? []
      : [
          {
            role: "owner" as const,
            message: {
              to: owner,
              body: buildOwnerOrderMessage(messageInput),
              templateVariables,
            },
          },
        ]),
  ];

  if (!whatsappConfigured()) {
    logWarn("Order placed without WhatsApp notification — provider not configured.", {
      category: "whatsapp",
      orderNumber: input.orderNumber,
      operation: "order-notification",
      hint: "Set META_WHATSAPP_ACCESS_TOKEN/META_WHATSAPP_PHONE_NUMBER_ID/META_WHATSAPP_TEMPLATE_NAME and WHATSAPP_OWNER_PHONE.",
    });
    return { sent: 0, failed: 0, skipped: messages.length };
  }

  const outcomes = await sendWhatsAppMessages(
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
      logInfo("WhatsApp notification sent.", {
        category: "whatsapp",
        operation: "order-notification",
        orderNumber: input.orderNumber,
        recipient: role,
      });
    } else if (outcome.status === "failed") {
      failed += 1;
      logWarn("WhatsApp notification failed.", {
        category: "whatsapp",
        operation: "order-notification",
        orderNumber: input.orderNumber,
        recipient: role,
        // Reason only — never the number itself.
        reason: outcome.detail ?? "unknown",
      });
    } else {
      skipped += 1;
    }
  });
  if (owner === null) {
    logWarn("WHATSAPP_OWNER_PHONE is unset — owner copy not sent.", {
      category: "whatsapp",
      operation: "order-notification",
      orderNumber: input.orderNumber,
    });
  }
  return { sent, failed, skipped };
}

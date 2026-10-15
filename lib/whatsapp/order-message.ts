import { formatMoney } from "@/lib/orders/pricing";

/**
 * WhatsApp click-to-chat helpers (no API, no secrets).
 *
 * Order details are composed into a plain-text message and turned into
 * `wa.me` deep links the customer taps after placing an order — one to
 * Trolift's number and one to their own. This is deliberately a
 * client-side, human-in-the-loop flow: nothing is sent automatically,
 * so there is no messaging-provider account to provision or leak.
 */

export interface OrderMessageItem {
  name: string;
  quantity: number;
  lineTotalPaise: number;
}

export interface OrderMessageInput {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  gstin?: string | null;
  /** Legal / business name (business orders only). */
  businessName?: string | null;
  /** Full billing address, single line (business orders only). */
  address?: string | null;
  pincode: string;
  /** Human delivery verdict, e.g. "Serviceable" / "Not serviceable". */
  deliveryStatus: string;
  /** Partner, charge, ETA, weight — optional detail line. */
  deliveryDetails?: string | null;
  items: OrderMessageItem[];
  subtotalPaise: number;
  deliveryChargePaise?: number | null;
  totalPaise: number;
  /** Canonical origin, appended so staff can jump to the order. */
  siteUrl?: string | null;
}

const money = (paise: number): string =>
  formatMoney({ amountPaise: paise, currency: "INR" });

/**
 * Normalize a phone to the digits-only, country-coded form `wa.me`
 * expects: "9876543210", "09876543210", "+91 98765 43210" and
 * "+919876543210" all become "919876543210". Empty stays empty.
 */
export function toWaNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits === "") return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

function pushIf(lines: string[], label: string, value?: string | null): void {
  const v = (value ?? "").trim();
  if (v !== "") lines.push(`${label}: ${v}`);
}

/** Compose the plain-text order summary shared over WhatsApp. */
export function buildOrderMessage(input: OrderMessageInput): string {
  const lines: string[] = [];
  lines.push(`New order ${input.orderNumber}`);
  lines.push("");

  pushIf(lines, "Name", input.customerName);
  pushIf(lines, "Business", input.businessName);
  pushIf(lines, "Address", input.address);
  pushIf(lines, "Pincode", input.pincode);
  pushIf(lines, "GSTIN", input.gstin);
  pushIf(lines, "Phone", input.customerPhone);
  pushIf(lines, "Email", input.customerEmail);

  lines.push("");
  lines.push(`Delivery (pincode ${input.pincode}): ${input.deliveryStatus}`);
  pushIf(lines, "Details", input.deliveryDetails);

  lines.push("");
  lines.push("Items:");
  for (const item of input.items) {
    lines.push(`- ${item.name} x ${item.quantity} = ${money(item.lineTotalPaise)}`);
  }

  lines.push("");
  lines.push(`Subtotal: ${money(input.subtotalPaise)}`);
  if (input.deliveryChargePaise !== null && input.deliveryChargePaise !== undefined) {
    lines.push(`Delivery: ${money(input.deliveryChargePaise)}`);
  }
  lines.push(`Total: ${money(input.totalPaise)}`);

  if ((input.siteUrl ?? "").trim() !== "") {
    lines.push("");
    lines.push(`Placed via ${input.siteUrl}`);
  }

  return lines.join("\n");
}

/**
 * Build a `wa.me` click-to-chat URL prefilled with `text`. An empty
 * number yields the WhatsApp share picker (`wa.me/?text=…`).
 */
export function whatsAppLink(phone: string, text: string): string {
  const number = toWaNumber(phone);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/**
 * Trolift's WhatsApp number for click-to-chat. Public by design — it is
 * embedded in links the customer's own browser opens.
 */
export function businessWhatsAppNumber(): string {
  return (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "").trim();
}

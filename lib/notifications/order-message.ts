/**
 * Order-notification copy (pure, unit-tested).
 *
 * One order in, two plain-text messages out: the customer's copy and
 * the owner's copy. Text is deliberately plain so every email client
 * renders it identically — no markdown, no HTML.
 *
 * Nothing here talks to a network or a database: delivery status comes
 * from the shipped Delhivery coverage list, money from the caller's
 * frozen order figures.
 */

import { lookupDelhiveryPincode } from "@/lib/delivery/delhivery-pincodes";
import { DELIVERY_TIMEFRAME } from "@/lib/delivery/timeframe";

export interface NotificationLine {
  productName: string;
  quantity: number;
  lineTotalPaise: number;
}

export interface OrderMessageInput {
  orderNumber: string;
  customerName: string;
  /** E.164 as stored by checkout, e.g. "+919876543210". */
  customerPhone: string;
  /** Customer email as collected at checkout; null when not provided. */
  customerEmail: string | null;
  businessName: string | null;
  /** Composed billing address line, or null for individual orders. */
  billingAddress: string | null;
  gstin: string | null;
  lines: NotificationLine[];
  taxPaise: number;
  /** Which GST split the order carries — names the component in the copy. */
  taxType: "igst" | "cgst_sgst";
  deliveryPartnerName: string | null;
  etaDays: { min: number; max: number } | null;
  totalPaise: number;
  /** Rupees knocked off by the redeem code (0 when no offer applied). */
  discountPaise: number;
  /** Redeem code granted at checkout, or null when none was used. */
  couponCode: string | null;
  pincode: string;
  /** Delivery address as typed at checkout (required for new orders). */
  shippingAddress: string;
  paymentWindowHours: number;
  siteUrl: string;
  /** True when a UPI QR image is attached to the email. */
  hasPaymentQr: boolean;
  /** QTN number when the quotation PDF is attached; null otherwise. */
  quotationNumber: string | null;
}

/** Indian-grouped rupees with paise, e.g. 316298000 → "31,62,980.00". */
export function rupees(paise: number): string {
  const value = Number.isFinite(paise) ? paise / 100 : 0;
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Delivery status for the order's pincode: the Delhivery list verdict
 * plus the frozen partner the order was placed with. Delivery is
 * included in every catalogue price, so the line reports the partner
 * and ETA when known — never a charge.
 */
export function deliveryStatusLine(input: OrderMessageInput): string {
  const coverage = lookupDelhiveryPincode(input.pincode);
  const where = coverage.state ? ` (${coverage.state})` : "";
  if (!coverage.deliverable) {
    return `Pincode ${input.pincode}${where}: not deliverable — ${coverage.reason ?? "outside our delivery area."}`;
  }
  const eta = `, ETA ${DELIVERY_TIMEFRAME}`;
  if (input.deliveryPartnerName === null) {
    return `Pincode ${input.pincode}${where}: serviceable on the Delhivery list — delivery included.`;
  }
  return (
    `Pincode ${input.pincode}${where}: serviceable — ` +
    `${input.deliveryPartnerName}${eta}, delivery included.`
  );
}

/** Money summary block shared by the customer and owner copies. */
function summaryLines(input: OrderMessageInput): string[] {
  const lines: string[] = [];
  if (input.taxPaise > 0) {
    const component = input.taxType === "cgst_sgst" ? "CGST + SGST" : "IGST";
    lines.push(`GST included: ₹${rupees(input.taxPaise)} (${component})`);
  }
  lines.push("Delivery: Included");
  if (input.discountPaise > 0) {
    lines.push(
      `Discount${input.couponCode ? ` (${input.couponCode})` : ""}: -₹${rupees(input.discountPaise)}`,
    );
  }
  lines.push(`Total: ₹${rupees(input.totalPaise)}`);
  return lines;
}

function itemLines(lines: NotificationLine[]): string[] {
  return lines.map(
    (line) =>
      `${line.productName} x${line.quantity} - ₹${rupees(line.lineTotalPaise)} (incl. GST & delivery)`,
  );
}

function identityLines(
  input: OrderMessageInput,
  opts: { phone?: boolean; email?: boolean } = {},
): string[] {
  const lines = [`Name: ${input.customerName}`];
  if (opts.phone) lines.push(`Mobile: ${input.customerPhone}`);
  if (opts.email && input.customerEmail) lines.push(`Email: ${input.customerEmail}`);
  if (input.shippingAddress) lines.push(`Shipping: ${input.shippingAddress}`);
  if (input.businessName) lines.push(`Business: ${input.businessName}`);
  if (input.billingAddress) lines.push(`Address: ${input.billingAddress}`);
  if (input.gstin) lines.push(`GSTIN: ${input.gstin}`);
  return lines;
}

/** Customer-facing confirmation with payment QR instructions. */
export function buildCustomerOrderMessage(input: OrderMessageInput): string {
  const parts: string[] = [
    `Thanks ${input.customerName} — we received your order ${input.orderNumber}.`,
    "",
    ...identityLines(input, { phone: true, email: true }),
    "",
    "Order:",
    ...itemLines(input.lines),
    "",
    ...summaryLines(input),
    "",
    `Delivery status — ${deliveryStatusLine(input)}`,
    "",
    `To confirm this order, please pay ₹${rupees(input.totalPaise)} within ${input.paymentWindowHours} hours ${payVia(input)}.`,
    `My orders (status, payment & quotations): ${input.siteUrl}/orders`,
    ...(input.quotationNumber
      ? [`Quotation ${input.quotationNumber} is attached to this email.`]
      : []),
    "",
    "After paying, reply to this email with the payment screenshot (or the UTR/reference number) so we can verify and confirm your order.",
    "",
    "Reply STOP to opt out of order updates.",
  ];
  return parts.join("\n");
}

function payVia(input: OrderMessageInput): string {
  return input.hasPaymentQr
    ? "using the UPI QR attached to this email (or the payment link on the order status page)"
    : "using the payment link on the order status page";
}

/** Owner-facing alert with the customer's contact and the order facts. */
export function buildOwnerOrderMessage(input: OrderMessageInput): string {
  return [
    `New order ${input.orderNumber} — ₹${rupees(input.totalPaise)} (payment pending)`,
    "",
    ...identityLines(input, { phone: true, email: true }),
    "",
    "Order:",
    ...itemLines(input.lines),
    "",
    ...summaryLines(input),
    "",
    `Delivery status — ${deliveryStatusLine(input)}`,
    "",
    `Payable within ${input.paymentWindowHours} hours.`,
    "Customer has been asked to reply with the payment screenshot/UTR.",
    ...(input.quotationNumber
      ? [`Quotation ${input.quotationNumber} is attached.`]
      : []),
  ].join("\n");
}

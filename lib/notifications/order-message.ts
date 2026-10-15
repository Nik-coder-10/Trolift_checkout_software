/**
 * Order-notification copy (pure, unit-tested).
 *
 * One order in, two plain-text messages out: the customer's copy and
 * the owner's copy. Text is deliberately plain (no markdown): WhatsApp
 * renders `*bold*` only in some clients and an approved utility
 * template needs stable, variable-free wording — so sentences stay
 * fixed and the values live in the variable list
 * (`orderMessageTemplateVariables`), which operators map to their
 * template's {{1}}, {{2}}, … placeholders.
 *
 * Nothing here talks to a network or a database: delivery status comes
 * from the shipped Delhivery coverage list, money from the caller's
 * frozen order figures.
 */

import { lookupDelhiveryPincode } from "@/lib/delivery/delhivery-pincodes";

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
  businessName: string | null;
  /** Composed billing address line, or null for individual orders. */
  billingAddress: string | null;
  gstin: string | null;
  lines: NotificationLine[];
  subtotalPaise: number;
  taxPaise: number;
  deliveryChargePaise: number;
  deliveryPartnerName: string | null;
  etaDays: { min: number; max: number } | null;
  totalPaise: number;
  pincode: string;
  paymentWindowHours: number;
  siteUrl: string;
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
 * plus the frozen partner/charge the order was placed with. Orders are
 * only accepted for a priced, serviceable pincode, so the "to be
 * confirmed" branch is a safety net rather than the normal path.
 */
export function deliveryStatusLine(input: OrderMessageInput): string {
  const coverage = lookupDelhiveryPincode(input.pincode);
  const where = coverage.state ? ` (${coverage.state})` : "";
  if (!coverage.deliverable) {
    return `Pincode ${input.pincode}${where}: not deliverable — ${coverage.reason ?? "outside our delivery area."}`;
  }
  if (input.deliveryPartnerName === null || input.deliveryChargePaise <= 0) {
    return `Pincode ${input.pincode}${where}: serviceable on the Delhivery list — delivery charge to be confirmed.`;
  }
  const eta = input.etaDays
    ? `, ETA ${input.etaDays.min}–${input.etaDays.max} days`
    : "";
  return (
    `Pincode ${input.pincode}${where}: serviceable on the Delhivery list — ` +
    `${input.deliveryPartnerName} at ₹${rupees(input.deliveryChargePaise)}${eta}.`
  );
}

function itemLines(lines: NotificationLine[]): string[] {
  return lines.map(
    (line) =>
      `${line.productName} x${line.quantity} - ₹${rupees(line.lineTotalPaise)}`,
  );
}

function identityLines(input: OrderMessageInput, phone: string | null): string[] {
  const lines = [`Name: ${input.customerName}`];
  if (phone !== null) lines.push(`Mobile: ${phone}`);
  if (input.businessName) lines.push(`Business: ${input.businessName}`);
  if (input.billingAddress) lines.push(`Address: ${input.billingAddress}`);
  if (input.gstin) lines.push(`GSTIN: ${input.gstin}`);
  return lines;
}

/** Customer-facing confirmation. */
export function buildCustomerOrderMessage(input: OrderMessageInput): string {
  const parts: string[] = [
    `Thanks ${input.customerName} — we received your order ${input.orderNumber}.`,
    "",
    ...identityLines(input, null),
    "",
    "Order:",
    ...itemLines(input.lines),
    "",
  ];
  parts.push(`Subtotal: ₹${rupees(input.subtotalPaise)}`);
  if (input.taxPaise > 0) parts.push(`GST: ₹${rupees(input.taxPaise)}`);
  if (input.deliveryChargePaise > 0) {
    parts.push(`Delivery: ₹${rupees(input.deliveryChargePaise)}`);
  }
  parts.push(
    `Total: ₹${rupees(input.totalPaise)}`,
    "",
    `Delivery status — ${deliveryStatusLine(input)}`,
    "",
    `Please complete the payment within ${input.paymentWindowHours} hours to confirm the order.`,
    `Order status: ${input.siteUrl}`,
    "",
    "Reply STOP to opt out of order updates.",
  );
  return parts.join("\n");
}

/** Owner-facing alert with the customer's contact and the order facts. */
export function buildOwnerOrderMessage(input: OrderMessageInput): string {
  return [
    `New order ${input.orderNumber} — ₹${rupees(input.totalPaise)} (payment pending)`,
    "",
    ...identityLines(input, input.customerPhone),
    "",
    "Order:",
    ...itemLines(input.lines),
    "",
    `Subtotal: ₹${rupees(input.subtotalPaise)}`,
    `GST: ₹${rupees(input.taxPaise)}`,
    `Delivery: ₹${rupees(input.deliveryChargePaise)}`,
    `Total: ₹${rupees(input.totalPaise)}`,
    "",
    `Delivery status — ${deliveryStatusLine(input)}`,
    "",
    `Payable within ${input.paymentWindowHours} hours.`,
  ].join("\n");
}

/**
 * Ordered values for an approved WhatsApp utility template
 * ({{1}} … {{6}} in the order below). Kept in one place so the template
 * and the code cannot drift apart silently.
 */
export function orderMessageTemplateVariables(input: OrderMessageInput): string[] {
  return [
    input.customerName,
    input.orderNumber,
    input.lines
      .map((line) => `${line.productName} x${line.quantity}`)
      .join(", "),
    `₹${rupees(input.totalPaise)}`,
    deliveryStatusLine(input),
    `${input.paymentWindowHours} hours`,
  ];
}

/**
 * Editable store-setting definitions (shared: server forms + the
 * admin client form import this module, so nothing server-only here).
 *
 * Keys are the whole contract: the server loader validates each stored
 * value against its own rules and silently ignores anything invalid
 * (falling back to the environment default — a bad row can never break
 * invoicing or payments).
 */

export type SettingKey =
  | "upi_id"
  | "upi_payee_name"
  | "payment_window_hours"
  | "invoice_prefix"
  | "quotation_validity_days"
  | "business_phone"
  | "business_email"
  | "default_low_stock_threshold";

export interface SettingDefinition {
  key: SettingKey;
  label: string;
  hint: string;
  type: "text" | "number" | "email";
  minLength: number;
  maxLength: number;
  min?: number;
  max?: number;
  placeholder: string;
}

export const SETTING_KEYS: readonly SettingKey[] = [
  "upi_id",
  "upi_payee_name",
  "payment_window_hours",
  "invoice_prefix",
  "quotation_validity_days",
  "business_phone",
  "business_email",
  "default_low_stock_threshold",
];

export function isSettingKey(value: string): value is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(value);
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: "upi_id",
    label: "UPI ID (VPA)",
    hint: "Customers pay orders to this VPA. Must look like user@bank.",
    type: "text",
    minLength: 5,
    maxLength: 100,
    placeholder: "trolift@upi",
  },
  {
    key: "upi_payee_name",
    label: "UPI payee name",
    hint: "The name shown in the payer's UPI app.",
    type: "text",
    minLength: 2,
    maxLength: 80,
    placeholder: "Trolift Solutions",
  },
  {
    key: "payment_window_hours",
    label: "Payment window (hours)",
    hint: "How long an order stays payable after it is placed.",
    type: "number",
    minLength: 1,
    maxLength: 4,
    min: 1,
    max: 720,
    placeholder: "24",
  },
  {
    key: "invoice_prefix",
    label: "Invoice prefix",
    hint: "2–10 uppercase letters, e.g. INV. Applies to newly issued invoices.",
    type: "text",
    minLength: 2,
    maxLength: 10,
    placeholder: "INV",
  },
  {
    key: "quotation_validity_days",
    label: "Quotation validity (days)",
    hint: "Days a new quotation stays valid from its issue date.",
    type: "number",
    minLength: 1,
    maxLength: 3,
    min: 1,
    max: 365,
    placeholder: "7",
  },
  {
    key: "business_phone",
    label: "Business phone",
    hint: "Printed on invoices and quotations.",
    type: "text",
    minLength: 8,
    maxLength: 16,
    placeholder: "+919876543210",
  },
  {
    key: "business_email",
    label: "Business email",
    hint: "Printed on invoices and quotations.",
    type: "email",
    minLength: 5,
    maxLength: 120,
    placeholder: "sales@example.com",
  },
  {
    key: "default_low_stock_threshold",
    label: "Default low-stock threshold",
    hint: "Prefilled on the new-product form. Per-product thresholds stay editable there.",
    type: "number",
    minLength: 1,
    maxLength: 4,
    min: 0,
    max: 1000,
    placeholder: "5",
  },
];

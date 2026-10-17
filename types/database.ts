/**
 * Database row types mirror the Supabase/Postgres schema.
 *
 * Conventions:
 * - Column names stay snake_case (1:1 with SQL).
 * - `uuid`, `timestamptz` and `numeric` arrive as `string`
 *   (PostgREST serialises NUMERIC as string to avoid float loss —
 *   parse to integer paise app-side, never via floats for math that
 *   matters; NUMERIC(12,2) has at most 2 decimals so
 *   Math.round(Number(x) * 100) is exact).
 * - Keep in sync with `supabase/migrations/`. Once a remote project
 *   exists, prefer `supabase gen types typescript` output.
 */
import type {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from "@/types";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export interface ProfileRow {
  id: string;
  email: string | null;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  gstin: string | null;
  /** Latest delivery address supplied at checkout (0037). */
  shipping_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  specifications: Json;
  /** Rupees as decimal string (NUMERIC(12,2)). */
  price: string;
  /** GST percent as decimal string (NUMERIC(5,2)); NULL = not configured. */
  gst_rate: string | null;
  /** Per-unit shipping weight in kg (NUMERIC(10,3)); NULL = unknown. */
  weight_kg: string | null;
  stock_quantity: number;
  /** Low-stock threshold (units); availability status derives from it. */
  low_stock_threshold: number;
  images: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeliveryPartnerRow {
  id: string;
  name: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PincodeRateRow {
  id: string;
  /** 6-digit Indian PIN code. */
  pincode: string;
  delivery_partner_id: string;
  serviceable: boolean;
  /** Rupees as decimal string (NUMERIC(12,2)). */
  delivery_charge: string;
  min_order_amount: string | null;
  max_order_amount: string | null;
  eta_min_days: number | null;
  eta_max_days: number | null;
  created_at: string;
  updated_at: string;
}

/** Pincode rate joined with its partner (checkout serviceability read). */
export interface PincodeRateWithPartner extends PincodeRateRow {
  delivery_partners: {
    name: string;
    is_active: boolean;
  } | null;
}

export interface OrderRow {
  id: string;
  order_number: string;
  customer_id: string;
  /** Snapshots in rupees (decimal strings) — never recomputed. */
  subtotal: string;
  delivery_charge: string;
  total_amount: string;
  delivery_pincode: string;
  delivery_partner_id: string | null;
  /** Partner name snapshot (FK may be nulled later). */
  delivery_partner_name: string;
  /** Delivery address as typed at checkout (0037; null on legacy rows). */
  shipping_address: string | null;
  /** GSTIN snapshot (customer master may change later). */
  gstin_snapshot: string | null;
  /** Order-time customer identity (frozen for invoices). */
  customer_name_snapshot: string;
  customer_phone_snapshot: string;
  customer_email_snapshot: string | null;
  payment_status: PaymentStatus;
  order_status: OrderStatus;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  order_id: string;
  invoice_number: string;
  invoice_date: string;
  /** Frozen canonical InvoiceData (null only before first freeze). */
  data: Json;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  /** Product-name snapshot at purchase time. */
  product_name: string;
  quantity: number;
  /** Unit-price snapshot in rupees (decimal string). */
  unit_price: string;
  line_total: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentRow {
  id: string;
  order_id: string;
  /** Rupees as decimal string; always > 0. */
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  transaction_reference: string | null;
  /** Non-secret context only — never credentials. */
  metadata: Json;
  created_at: string;
  updated_at: string;
}

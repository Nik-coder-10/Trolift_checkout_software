import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { AppError } from "@/lib/api/errors";

/**
 * Admin command center data (server-only, admins only).
 *
 * ONE RPC round-trip (get_admin_command_center) per render: queue
 * counts + top items, today's operations, business summary and a
 * paginated recent-orders table. The RPC re-checks is_admin(), so a
 * non-admin caller gets an error, never data. Amounts arrive as
 * NUMERIC decimal strings; the UI converts to integer paise. No PII
 * beyond the customer display name leaves the database.
 */

export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Kolkata";
const RECENT_ORDERS_PAGE_SIZE = 20;

export function businessTimezone(): string {
  const tz = (process.env.BUSINESS_TIMEZONE ?? "").trim();
  return tz !== "" ? tz : DEFAULT_BUSINESS_TIMEZONE;
}

export interface QueueOrderItem {
  order_id: string;
  order_number: string;
  customer_name: string;
  total_amount: string;
  payment_status: string;
  order_status: string;
  created_at: string;
}

export interface ClaimItem {
  order_id: string;
  order_number: string;
  amount: string;
  customer_name: string;
  reference: string | null;
  submitted_at: string;
}

export interface DelayedShipmentItem {
  shipment_id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  dispatch_status: string;
  expected_delivery_date: string | null;
  dispatched_at: string | null;
}

export interface LowStockItem {
  product_id: string;
  name: string;
  stock_quantity: number;
  low_stock_threshold: number;
}

export interface FailedPaymentItem {
  order_id: string;
  order_number: string;
  customer_name: string;
  amount: string;
  payment_status: string;
  updated_at: string;
}

export interface TodayOps {
  orders_created: number;
  payments_verified: number;
  orders_processed: number;
  shipments_dispatched: number;
  deliveries_completed: number;
}

export interface BusinessSummary {
  total_orders: number;
  paid_orders: number;
  paid_revenue: string;
  avg_order_value: string;
  cancelled_orders: number;
  repeat_customers: number;
  low_stock_count: number;
  out_of_stock_count: number;
}

export interface Queue<T> {
  count: number;
  items: T[];
}

export interface RecentOrderItem extends QueueOrderItem {
  dispatch_status: string | null;
}

export interface CommandCenterData {
  today: TodayOps;
  summary: BusinessSummary;
  queues: {
    claims: Queue<ClaimItem>;
    confirmed: Queue<QueueOrderItem>;
    paid: Queue<QueueOrderItem>;
    processing: Queue<QueueOrderItem>;
    packed: Queue<QueueOrderItem>;
    ready_for_dispatch: Queue<QueueOrderItem>;
    delayed_shipments: Queue<DelayedShipmentItem>;
    low_stock: Queue<LowStockItem>;
    failed_payments: Queue<FailedPaymentItem>;
  };
  recent_orders: {
    total: number;
    page: number;
    page_size: number;
    items: RecentOrderItem[];
  };
}

function asQueue<T>(value: unknown): Queue<T> {
  const q = (value ?? {}) as { count?: unknown; items?: unknown };
  return {
    count: typeof q.count === "number" && Number.isFinite(q.count) ? q.count : 0,
    items: Array.isArray(q.items) ? (q.items as T[]) : [],
  };
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function getCommandCenterData(
  page = 1,
): Promise<CommandCenterData> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_command_center", {
    p_timezone: businessTimezone(),
    p_page: page,
    p_page_size: RECENT_ORDERS_PAGE_SIZE,
  });
  if (error) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Dashboard query failed. Check the Supabase configuration.",
      500,
    );
  }
  const d = (data ?? {}) as unknown as CommandCenterData;
  const recent = d.recent_orders ?? {
    total: 0,
    page: 1,
    page_size: RECENT_ORDERS_PAGE_SIZE,
    items: [],
  };
  return {
    today: {
      orders_created: asNumber(d.today?.orders_created),
      payments_verified: asNumber(d.today?.payments_verified),
      orders_processed: asNumber(d.today?.orders_processed),
      shipments_dispatched: asNumber(d.today?.shipments_dispatched),
      deliveries_completed: asNumber(d.today?.deliveries_completed),
    },
    summary: {
      total_orders: asNumber(d.summary?.total_orders),
      paid_orders: asNumber(d.summary?.paid_orders),
      paid_revenue: String(d.summary?.paid_revenue ?? "0"),
      avg_order_value: String(d.summary?.avg_order_value ?? "0"),
      cancelled_orders: asNumber(d.summary?.cancelled_orders),
      repeat_customers: asNumber(d.summary?.repeat_customers),
      low_stock_count: asNumber(d.summary?.low_stock_count),
      out_of_stock_count: asNumber(d.summary?.out_of_stock_count),
    },
    queues: {
      claims: asQueue<ClaimItem>(d.queues?.claims),
      confirmed: asQueue<QueueOrderItem>(d.queues?.confirmed),
      paid: asQueue<QueueOrderItem>(d.queues?.paid),
      processing: asQueue<QueueOrderItem>(d.queues?.processing),
      packed: asQueue<QueueOrderItem>(d.queues?.packed),
      ready_for_dispatch: asQueue<QueueOrderItem>(d.queues?.ready_for_dispatch),
      delayed_shipments: asQueue<DelayedShipmentItem>(d.queues?.delayed_shipments),
      low_stock: asQueue<LowStockItem>(d.queues?.low_stock),
      failed_payments: asQueue<FailedPaymentItem>(d.queues?.failed_payments),
    },
    recent_orders: {
      total: asNumber(recent.total),
      page: asNumber(recent.page) || 1,
      page_size: asNumber(recent.page_size) || RECENT_ORDERS_PAGE_SIZE,
      items: Array.isArray(recent.items) ? recent.items : [],
    },
  };
}

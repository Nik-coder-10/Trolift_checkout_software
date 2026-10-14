import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { AppError } from "@/lib/api/errors";
import {
  canTransition,
  canTransitionPayment,
} from "@/lib/orders/transitions";
import type { OrderStatus, PaymentStatus } from "@/types";
import {
  LEGACY_ACTION,
  assertEventMetadata,
  eventTypeForTransition,
  type ActorType,
  type OrderEventType,
} from "@/lib/orders/events";

/**
 * Admin order management (server-only, admins only).
 *
 * Every public function starts with requireAdmin() — pages and API
 * routes share the same gate, so authorization never depends on which
 * entry point called. All reads/writes use the RLS-respecting server
 * client (admin policies apply); the service role is never needed here.
 * Mutations append to order_events via logOrderEvent() — one audit
 * helper, not scattered logging.
 */

const ORDER_STATUSES: ReadonlyArray<OrderStatus> = [
  "draft", "pending_payment", "payment_submitted", "paid", "confirmed",
  "processing", "packed", "ready_for_dispatch", "shipped", "dispatched",
  "delivered", "cancelled",
];
const PAYMENT_STATUSES: ReadonlyArray<PaymentStatus> = [
  "pending", "submitted", "paid", "failed", "cancelled", "refunded",
];

export type AdminOrderSort = "newest" | "oldest" | "total_desc" | "total_asc";

export interface AdminOrderQuery {
  q?: string;
  paymentStatus?: PaymentStatus;
  orderStatus?: OrderStatus;
  from?: string;
  to?: string;
  sort: AdminOrderSort;
  page: number;
  pageSize: number;
}

export const ADMIN_ORDER_PAGE_SIZE = 15;

/** Strip postgrest or() metacharacters so search text stays literal. */
export function sanitizeSearch(value: string): string {
  return value.replace(/[,()]/g, "").trim().slice(0, 60);
}

/**
 * Escape SQL LIKE wildcards so admin search text matches literally.
 * PostgREST passes ilike patterns straight to Postgres LIKE, where
 * backslash is the default escape character — without this, a user
 * typing "%" would match every row and "_" would match any character.
 * Unlike sanitizeSearch (which deletes characters), escaping preserves
 * the user's literal input.
 */
export function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function parseAdminOrderQuery(
  sp: Record<string, string | string[] | undefined>,
): AdminOrderQuery {
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const q = sanitizeSearch(first(sp["q"]));
  const payment = first(sp["payment"]);
  const status = first(sp["status"]);
  const sortRaw = first(sp["sort"]);
  const page = Number(first(sp["page"]));
  return {
    ...(q === "" ? {} : { q }),
    ...(PAYMENT_STATUSES as ReadonlyArray<string>).includes(payment)
      ? { paymentStatus: payment as PaymentStatus }
      : {},
    ...(ORDER_STATUSES as ReadonlyArray<string>).includes(status)
      ? { orderStatus: status as OrderStatus }
      : {},
    ...(parseDate(first(sp["from"])) ? { from: parseDate(first(sp["from"])) } : {}),
    ...(parseDate(first(sp["to"])) ? { to: parseDate(first(sp["to"])) } : {}),
    sort:
      sortRaw === "oldest" || sortRaw === "total_desc" || sortRaw === "total_asc"
        ? sortRaw
        : "newest",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: ADMIN_ORDER_PAGE_SIZE,
  };
}

export interface AdminOrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  subtotalPaise: number;
  deliveryChargePaise: number;
  totalPaise: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
}

const toPaise = (decimal: string): number =>
  Math.round(Number(decimal) * 100);

type AdminClient = Awaited<ReturnType<typeof createClient>>;

async function customerIdsForSearch(
  client: AdminClient,
  q: string,
): Promise<string[]> {
  const pattern = `%${escapeLikeWildcards(q)}%`;
  const { data, error } = await client
    .from("customers")
    .select("id")
    .or(`name.ilike.${pattern},phone.ilike.${pattern}`)
    .limit(100);
  if (error) return [];
  return ((data ?? []) as unknown as Array<{ id: string }>).map((r) => r.id);
}

export async function listAdminOrders(
  query: AdminOrderQuery,
): Promise<{
  orders: AdminOrderRow[];
  total: number;
  page: number;
  totalPages: number;
}> {
  await requireAdmin();
  const client = await createClient();

  let ids: string[] = [];
  if (query.q) {
    ids = await customerIdsForSearch(client, query.q);
  }

  let builder = client
    .from("orders")
    .select(
      "id,order_number,created_at,subtotal,delivery_charge,total_amount," +
        "payment_status,order_status,customer_id," +
        "customers!inner(name,phone)",
      { count: "exact" },
    );
  if (query.q) {
    const pattern = `%${escapeLikeWildcards(query.q)}%`;
    builder =
      ids.length > 0
        ? builder.or(`order_number.ilike.${pattern},customer_id.in.(${ids.join(",")})`)
        : builder.ilike("order_number", pattern);
  }
  if (query.paymentStatus) builder = builder.eq("payment_status", query.paymentStatus);
  if (query.orderStatus) builder = builder.eq("order_status", query.orderStatus);
  if (query.from) builder = builder.gte("created_at", query.from);
  if (query.to) builder = builder.lte("created_at", query.to);
  switch (query.sort) {
    case "oldest":
      builder = builder.order("created_at", { ascending: true });
      break;
    case "total_desc":
      builder = builder.order("total_amount", { ascending: false });
      break;
    case "total_asc":
      builder = builder.order("total_amount", { ascending: true });
      break;
    case "newest":
    default:
      builder = builder.order("created_at", { ascending: false });
      break;
  }
  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load orders.", 500);
  }
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    order_number: string;
    created_at: string;
    subtotal: string;
    delivery_charge: string;
    total_amount: string;
    payment_status: PaymentStatus;
    order_status: OrderStatus;
    customers: { name: string; phone: string } | null;
  }>;
  const total = count ?? 0;
  return {
    orders: rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      customerName: r.customers?.name ?? "—",
      customerPhone: r.customers?.phone ?? "—",
      createdAt: r.created_at,
      subtotalPaise: toPaise(r.subtotal),
      deliveryChargePaise: toPaise(r.delivery_charge),
      totalPaise: toPaise(r.total_amount),
      paymentStatus: r.payment_status,
      orderStatus: r.order_status,
    })),
    total,
    page: query.page,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  };
}

export interface AdminOrderBilling {
  name: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
}

export interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  createdAt: string;
  customer: { name: string; phone: string; email: string | null; gstin: string | null };
  /** Frozen order-time billing snapshot (null fields when non-GST). */
  billing: AdminOrderBilling;
  items: Array<{
    name: string;
    quantity: number;
    unitPricePaise: number;
    lineTotalPaise: number;
    gstRate: string | null;
    lineTaxPaise: number;
  }>;
  subtotalPaise: number;
  taxTreatment: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Inventory position: none (pre-inventory) / reserved / consumed / restored. */
  stockState: string;
  deliveryChargePaise: number;
  totalPaise: number;
  deliveryPincode: string;
  deliveryPartnerName: string;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  paymentReference: string | null;
  paymentUpdatedAt: string | null;
  events: Array<{
    eventType: string;
    actorType: string;
    actorId: string | null;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    note: string | null;
    metadata: Record<string, string | number | boolean>;
    createdAt: string;
  }>;
}

export async function getAdminOrderDetail(
  orderId: string,
): Promise<AdminOrderDetail | null> {
  await requireAdmin();
  const client = await createClient();
  const { data: order, error } = await client
    .from("orders")
    .select(
      "id,order_number,created_at,subtotal,delivery_charge,total_amount," +
        "delivery_pincode,delivery_partner_name,gstin_snapshot," +
        "tax_treatment,taxable_amount,cgst_amount,sgst_amount,igst_amount," +
        "billing_name,billing_address_line,billing_city,billing_state," +
        "billing_state_code,billing_pincode," +
        "payment_status,order_status,stock_state,customer_id," +
        "customers!inner(name,phone,email,gstin)",
    )
    .eq("id", orderId)
    .maybeSingle();
  const o = order as unknown as {
    id: string;
    order_number: string;
    created_at: string;
    subtotal: string;
    delivery_charge: string;
    total_amount: string;
    delivery_pincode: string;
    delivery_partner_name: string;
    gstin_snapshot: string | null;
    tax_treatment: string;
    taxable_amount: string;
    cgst_amount: string;
    sgst_amount: string;
    igst_amount: string;
    billing_name: string | null;
    billing_address_line: string | null;
    billing_city: string | null;
    billing_state: string | null;
    billing_state_code: string | null;
    billing_pincode: string | null;
    payment_status: PaymentStatus;
    order_status: OrderStatus;
    stock_state: string;
    customers: { name: string; phone: string; email: string | null; gstin: string | null } | null;
  } | null;
  if (error || !o) return null;

  const [{ data: items }, { data: payment }, { data: events }] = await Promise.all([
    client
      .from("order_items")
      .select("product_name,quantity,unit_price,line_total,gst_rate_percent,line_tax_amount")
      .eq("order_id", o.id)
      .order("product_name"),
    client
      .from("payments")
      .select("transaction_reference,updated_at")
      .eq("order_id", o.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("order_events")
      .select(
        "event_type,actor_type,actor_user_id,action,from_status," +
          "to_status,note,metadata,created_at",
      )
      .eq("order_id", o.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const itemRows = (items ?? []) as unknown as Array<{
    product_name: string;
    quantity: number;
    unit_price: string;
    line_total: string;
    gst_rate_percent: string | null;
    line_tax_amount: string;
  }>;
  const payRow = payment as unknown as {
    transaction_reference: string | null;
    updated_at: string;
  } | null;
  const eventRows = (events ?? []) as unknown as Array<{
    event_type: string;
    actor_type: string;
    actor_user_id: string | null;
    action: string;
    from_status: string | null;
    to_status: string | null;
    note: string | null;
    metadata: Record<string, string | number | boolean> | null;
    created_at: string;
  }>;
  return {
    id: o.id,
    orderNumber: o.order_number,
    createdAt: o.created_at,
    customer: {
      name: o.customers?.name ?? "—",
      phone: o.customers?.phone ?? "—",
      email: o.customers?.email ?? null,
      gstin: o.gstin_snapshot,
    },
    billing: {
      name: o.billing_name,
      addressLine: o.billing_address_line,
      city: o.billing_city,
      state: o.billing_state,
      stateCode: o.billing_state_code,
      pincode: o.billing_pincode,
    },
    items: itemRows.map((r) => ({
      name: r.product_name,
      quantity: r.quantity,
      unitPricePaise: toPaise(r.unit_price),
      lineTotalPaise: toPaise(r.line_total),
      gstRate: r.gst_rate_percent,
      lineTaxPaise: toPaise(r.line_tax_amount),
    })),
    subtotalPaise: toPaise(o.subtotal),
    taxTreatment: o.tax_treatment,
    taxablePaise: toPaise(o.taxable_amount),
    cgstPaise: toPaise(o.cgst_amount),
    sgstPaise: toPaise(o.sgst_amount),
    igstPaise: toPaise(o.igst_amount),
    deliveryChargePaise: toPaise(o.delivery_charge),
    totalPaise: toPaise(o.total_amount),
    deliveryPincode: o.delivery_pincode,
    deliveryPartnerName: o.delivery_partner_name,
    paymentStatus: o.payment_status,
    orderStatus: o.order_status,
    stockState: o.stock_state,
    paymentReference: payRow?.transaction_reference ?? null,
    paymentUpdatedAt: payRow?.updated_at ?? null,
    events: eventRows.map((e) => ({
      eventType: e.event_type,
      actorType: e.actor_type,
      actorId: e.actor_user_id,
      action: e.action,
      fromStatus: e.from_status,
      toStatus: e.to_status,
      note: e.note,
      metadata: e.metadata ?? {},
      createdAt: e.created_at,
    })),
  };
}

/**
 * Single audit helper for every order mutation (append-only).
 *
 * The event type comes from the closed catalog — callers cannot invent
 * types, and neither can clients (no API accepts one). Failures THROW
 * instead of logging to console: a swallowed audit write is how an
 * order ends up PAID with no corresponding event. Callers perform the
 * state change first, then log; a thrown audit error surfaces as a 500
 * the operator retries (all mutations here are idempotent-safe via
 * guarded updates and transition validation).
 *
 * Pass an explicit client when there is no user session (guest claim
 * path, invoice service) — those callers hold the service-role client.
 */
export async function logOrderEvent(input: {
  orderId: string;
  eventType: OrderEventType;
  actorType: ActorType;
  actorUserId: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  metadata?: unknown;
  client?: AdminClient;
}): Promise<void> {
  const metadata =
    input.metadata === undefined ? {} : assertEventMetadata(input.metadata);
  const client = input.client ?? (await createClient());
  const { error } = await client.from("order_events").insert({
    order_id: input.orderId,
    event_type: input.eventType,
    actor_type: input.actorType,
    actor_user_id: input.actorUserId,
    action: LEGACY_ACTION[input.eventType],
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    note: input.note?.slice(0, 500) ?? null,
    metadata,
  });
  if (error) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not record the order event. Reload and retry.",
      500,
    );
  }
}

async function loadForMutation(orderId: string) {
  const admin = await requireAdmin();
  const client = await createClient();
  const { data, error } = await client
    .from("orders")
    .select("id,order_number,payment_status,order_status")
    .eq("id", orderId)
    .maybeSingle();
  const row = data as unknown as {
    id: string;
    order_number: string;
    payment_status: PaymentStatus;
    order_status: OrderStatus;
  } | null;
  if (error || !row) {
    throw new AppError("NOT_FOUND", "Order not found.", 404);
  }
  return { admin, client, row };
}

async function guardedUpdate(
  client: Awaited<ReturnType<typeof createClient>>,
  table: "orders" | "payments",
  id: string,
  values: Record<string, string>,
  guardCol: string,
  guardVal: string,
): Promise<boolean> {
  const { data, error } = await client
    .from(table)
    .update(values)
    .eq("id", id)
    .eq(guardCol, guardVal)
    .select("id");
  if (error) return false;
  return ((data ?? []) as unknown as Array<unknown>).length > 0;
}

/** Approve (→paid/confirmed) or reject (→failed/pending_payment) a claim. */
export async function verifyPaymentClaim(
  orderId: string,
  decision: "approve" | "reject",
  note?: string,
): Promise<{ paymentStatus: PaymentStatus; orderStatus: OrderStatus }> {
  const { admin, client, row } = await loadForMutation(orderId);
  const { data: payment } = await client
    .from("payments")
    .select("id,status")
    .eq("order_id", row.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pay = payment as unknown as { id: string; status: PaymentStatus } | null;
  if (!pay) {
    throw new AppError("NOT_FOUND", "No payment found for this order.", 404);
  }
  const targetPayment: PaymentStatus = decision === "approve" ? "paid" : "failed";
  const targetOrder: OrderStatus =
    decision === "approve" ? "confirmed" : "pending_payment";
  if (!canTransitionPayment(pay.status, targetPayment)) {
    throw new AppError("BAD_REQUEST", "Payment is not awaiting verification.", 409);
  }
  if (!canTransition(row.order_status, targetOrder)) {
    throw new AppError("BAD_REQUEST", "Order cannot move to the target state.", 409);
  }
  if (decision === "approve") {
    // Money is verified: convert this order's holds into real decrements
    // BEFORE the status moves. Idempotent (reserved→consumed only), so a
    // retry after a crashed approve safely converges instead of
    // double-selling. A shortfall here means an admin reduced on-hand
    // stock below live holds — the approval must stop, holds intact.
    const { error: consumeError } = await client.rpc("consume_reservation", {
      p_order_id: row.id,
    });
    if (consumeError) {
      throw mapStockError(consumeError, "Stock cannot cover this order.");
    }
  }
  const payOk = await guardedUpdate(
    client, "payments", pay.id, { status: targetPayment }, "status", pay.status,
  );
  if (!payOk) {
    throw new AppError("BAD_REQUEST", "Payment changed state. Reload and retry.", 409);
  }
  const orderOk = await guardedUpdate(
    client,
    "orders",
    row.id,
    { payment_status: decision === "approve" ? "paid" : row.payment_status, order_status: targetOrder },
    "order_status",
    row.order_status,
  );
  if (!orderOk) {
    throw new AppError("BAD_REQUEST", "Order changed state. Reload and retry.", 409);
  }
  // Approval moves money AND fulfilment state together, so it emits
  // both canonical events (either can be queried independently).
  if (decision === "approve") {
    await logOrderEvent({
      orderId: row.id,
      eventType: "PAYMENT_VERIFIED",
      actorType: "admin",
      actorUserId: admin.id,
      fromStatus: row.payment_status,
      toStatus: targetPayment,
      metadata: { payment_method: "upi" },
    });
  }
  await logOrderEvent({
    orderId: row.id,
    eventType:
      decision === "approve" ? "ORDER_CONFIRMED" : "PAYMENT_REJECTED",
    actorType: "admin",
    actorUserId: admin.id,
    fromStatus: row.order_status,
    toStatus: targetOrder,
    note: note?.trim() || null,
  });
  return { paymentStatus: targetPayment, orderStatus: targetOrder };
}

/**
 * Map a stock-RPC failure to an operator-safe error. Shortfalls are
 * 409s naming the problem; anything else is a 500 (logged by the
 * route boundary, never leaked).
 */
function mapStockError(error: unknown, fallback: string): AppError {
  if (
    typeof error === "object" && error !== null &&
    (error as { code?: string }).code === "P0001" &&
    typeof (error as { message?: string }).message === "string" &&
    (error as { message: string }).message.includes("INSUFFICIENT_STOCK:")
  ) {
    return new AppError(
      "INSUFFICIENT_STOCK",
      (error as { message: string }).message
        .replace("INSUFFICIENT_STOCK:", "")
        .trim() || fallback,
      409,
    );
  }
  return new AppError("INTERNAL_ERROR", "Stock update failed. Try again.", 500);
}

/** Advance (or cancel) an order through valid transitions only. */
export async function transitionOrderStatus(
  orderId: string,
  toStatus: OrderStatus,
): Promise<{ orderStatus: OrderStatus }> {
  const { admin, client, row } = await loadForMutation(orderId);
  if (!canTransition(row.order_status, toStatus)) {
    throw new AppError(
      "BAD_REQUEST",
      `Cannot move order from ${row.order_status} to ${toStatus}.`,
      409,
    );
  }
  if (toStatus === "cancelled") {
    // Restore BEFORE the status moves: held units are released (or sold
    // units returned) exactly once via the stock_state gate, so a crash
    // between restore and status update retries cleanly instead of
    // restoring twice.
    const { error: restoreError } = await client.rpc("restore_reservation", {
      p_order_id: row.id,
      p_reason: `order cancelled from ${row.order_status}`,
    });
    if (restoreError) {
      throw mapStockError(restoreError, "Stock could not be restored.");
    }
  }
  const ok = await guardedUpdate(
    client, "orders", row.id, { order_status: toStatus }, "order_status", row.order_status,
  );
  if (!ok) {
    throw new AppError("BAD_REQUEST", "Order changed state. Reload and retry.", 409);
  }
  await logOrderEvent({
    orderId: row.id,
    eventType: eventTypeForTransition(row.order_status, toStatus),
    actorType: "admin",
    actorUserId: admin.id,
    fromStatus: row.order_status,
    toStatus,
  });
  return { orderStatus: toStatus };
}

/**
 * Fulfilment milestones are now part of the order status lifecycle.
 * PACKED and READY_FOR_DISPATCH are order statuses, not event-only milestones.
 * The transitionOrderStatus function handles them via the state machine.
 * This function is kept for backward compatibility but delegates to
 * transitionOrderStatus.
 */
export async function markFulfillmentStep(
  orderId: string,
  step: "packed" | "ready_for_dispatch",
): Promise<{ eventType: OrderEventType }> {
  await transitionOrderStatus(orderId, step);
  return {
    eventType: step === "packed" ? "PACKED" : "READY_FOR_DISPATCH",
  };
}
